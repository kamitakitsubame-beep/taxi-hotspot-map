#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
埼玉県南部（県南中央交通圏）のイベント情報を収集し data/events.json を更新する。

対象サイト:
  1. じゃらんnet イベント（埼玉県）    https://www.jalan.net/event/pref11/
  2. さいたま市観光国際協会            https://www.saitama-kanko.com/
  3. 埼玉県観光情報（県公式）          https://www.pref.saitama.lg.jp/

設計方針:
  - サイトごとに try/except で囲み、エラーが出たサイトはスキップ。
  - 取得できた分だけをマージして書き出す。
  - 住所は geopy + Nominatim(無料) で緯度経度へ変換。1秒以上の間隔を空ける。
  - 既存の手動キュレーション（id が "manual-" / "sample-" で始まる）は保持する。
  - HTML構造はサイト変更で壊れやすいため、抽出失敗時も全体は落とさない。
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
import hashlib
import datetime as dt
from pathlib import Path
from typing import Iterable

import requests
from bs4 import BeautifulSoup
from geopy.geocoders import Nominatim
from geopy.extra.rate_limiter import RateLimiter

ROOT = Path(__file__).resolve().parents[1]
DATA_FILE = ROOT / "data" / "events.json"

JST = dt.timezone(dt.timedelta(hours=9))
USER_AGENT = "taxi-hotspot-map/1.0 (+https://github.com/) event-collector"
REQUEST_TIMEOUT = 20
RANGE_DAYS = 30  # 今日からこの日数以内のイベントのみ採用

# 県南中央交通圏に関連するキーワード（会場名・住所で絞り込み）
SOUTH_SAITAMA_KEYWORDS = [
    "さいたま市", "大宮", "浦和", "与野", "岩槻", "見沼",
    "川口", "蕨", "戸田", "鳩ヶ谷", "朝霞", "和光", "新座",
    "志木", "富士見", "ふじみ野", "上尾", "桶川", "伊奈",
]

# 需要レベル判定のためのキーワード（カテゴリ・タイトルから推定）
HIGH_KEYWORDS = ["花火", "フェス", "ライブ", "コンサート", "祭", "マラソン",
                 "スタジアム", "アリーナ", "万灯", "大会"]
MEDIUM_KEYWORDS = ["コンサート", "公演", "展", "マーケット", "フェア", "市"]


def log(msg: str) -> None:
    print(f"[scrape] {msg}", file=sys.stderr)


# --------------------------------------------------------------------------- #
# 共通ユーティリティ
# --------------------------------------------------------------------------- #
def make_session() -> requests.Session:
    s = requests.Session()
    s.headers.update({"User-Agent": USER_AGENT, "Accept-Language": "ja"})
    return s


def stable_id(prefix: str, *parts: str) -> str:
    h = hashlib.sha1("|".join(parts).encode("utf-8")).hexdigest()[:10]
    return f"{prefix}-{h}"


def in_south_saitama(text: str) -> bool:
    return any(k in text for k in SOUTH_SAITAMA_KEYWORDS)


def guess_demand_level(title: str, category: str) -> str:
    blob = f"{title} {category}"
    if any(k in blob for k in HIGH_KEYWORDS):
        return "high"
    if any(k in blob for k in MEDIUM_KEYWORDS):
        return "medium"
    return "low"


def default_comment(level: str) -> str:
    return {
        "high": "大型イベント。終了時間帯に会場周辺で需要集中の可能性。早めの待機を推奨。",
        "medium": "中規模イベント。終演・解散時に駅周辺で短時間の需要が見込まれます。",
        "low": "小規模・参考情報。需要は限定的。近くを通る際の参考に。",
    }[level]


def parse_date(text: str) -> str | None:
    """日本語の日付表記から最初の YYYY-MM-DD を抽出する。"""
    if not text:
        return None
    # 2026年6月13日 / 2026/6/13 / 6月13日 形式に対応
    m = re.search(r"(\d{4})[年/.\-](\d{1,2})[月/.\-](\d{1,2})", text)
    if m:
        y, mo, d = map(int, m.groups())
    else:
        m = re.search(r"(\d{1,2})月(\d{1,2})日", text)
        if not m:
            return None
        mo, d = map(int, m.groups())
        y = dt.datetime.now(JST).year
    try:
        return dt.date(y, mo, d).isoformat()
    except ValueError:
        return None


def parse_time(text: str) -> tuple[str | None, str | None]:
    if not text:
        return None, None
    times = re.findall(r"(\d{1,2}):(\d{2})", text)
    if not times:
        return None, None
    fmt = lambda hm: f"{int(hm[0]):02d}:{hm[1]}"
    start = fmt(times[0])
    end = fmt(times[1]) if len(times) > 1 else None
    return start, end


def within_range(date_iso: str) -> bool:
    today = dt.datetime.now(JST).date()
    try:
        d = dt.date.fromisoformat(date_iso)
    except ValueError:
        return False
    delta = (d - today).days
    return 0 <= delta <= RANGE_DAYS


# --------------------------------------------------------------------------- #
# Geocoding
# --------------------------------------------------------------------------- #
class Geocoder:
    def __init__(self) -> None:
        self._nom = Nominatim(user_agent=USER_AGENT, timeout=REQUEST_TIMEOUT)
        # Nominatim の利用規約に従い 1 リクエスト/秒 に制限
        self._geocode = RateLimiter(self._nom.geocode, min_delay_seconds=1.1)
        self._cache: dict[str, tuple[float, float] | None] = {}

    def locate(self, query: str) -> tuple[float, float] | None:
        key = query.strip()
        if not key:
            return None
        if key in self._cache:
            return self._cache[key]
        result = None
        try:
            loc = self._geocode(f"{key}, 埼玉県, 日本", country_codes="jp")
            if loc is None:
                loc = self._geocode(f"{key}, 日本", country_codes="jp")
            if loc is not None:
                result = (round(loc.latitude, 5), round(loc.longitude, 5))
        except Exception as exc:  # noqa: BLE001
            log(f"geocode失敗: {key}: {exc}")
            result = None
        self._cache[key] = result
        return result


# --------------------------------------------------------------------------- #
# 各サイトのスクレイパー（戻り値: dict のリスト。lat/lng は未設定でも可）
# --------------------------------------------------------------------------- #
def scrape_jalan(session: requests.Session) -> list[dict]:
    """じゃらんnet イベント（埼玉県）。"""
    url = "https://www.jalan.net/event/pref11/"
    res = session.get(url, timeout=REQUEST_TIMEOUT)
    res.raise_for_status()
    soup = BeautifulSoup(res.text, "html.parser")
    events: list[dict] = []

    # イベントカードを広めに拾う（サイト改装に耐えるため複数セレクタを試す）
    cards = soup.select(".item-event, .p-eventList__item, li.event, .eventListItem")
    if not cards:
        cards = soup.select("article")

    for card in cards:
        title_el = card.select_one("h2, h3, .title, .p-eventList__ttl, a")
        if not title_el:
            continue
        title = title_el.get_text(strip=True)
        body = card.get_text(" ", strip=True)
        if not title or not in_south_saitama(body):
            continue
        date_iso = parse_date(body)
        if not date_iso or not within_range(date_iso):
            continue
        venue_el = card.select_one(".place, .venue, .p-eventList__place, .area")
        venue = venue_el.get_text(strip=True) if venue_el else ""
        start, end = parse_time(body)
        link_el = card.select_one("a[href]")
        href = link_el["href"] if link_el else url
        if href.startswith("/"):
            href = "https://www.jalan.net" + href
        events.append(_make_event("jalan", title, date_iso, start, end, venue, href))
    return events


def scrape_saitama_kanko(session: requests.Session) -> list[dict]:
    """さいたま市観光国際協会。"""
    url = "https://www.saitama-kanko.com/event/"
    res = session.get(url, timeout=REQUEST_TIMEOUT)
    res.raise_for_status()
    soup = BeautifulSoup(res.text, "html.parser")
    events: list[dict] = []

    cards = soup.select(".event-list li, .eventList li, article, .c-card")
    for card in cards:
        title_el = card.select_one("h2, h3, .title, a")
        if not title_el:
            continue
        title = title_el.get_text(strip=True)
        body = card.get_text(" ", strip=True)
        if not title:
            continue
        date_iso = parse_date(body)
        if not date_iso or not within_range(date_iso):
            continue
        start, end = parse_time(body)
        link_el = card.select_one("a[href]")
        href = link_el["href"] if link_el else url
        if href.startswith("/"):
            href = "https://www.saitama-kanko.com" + href
        # さいたま市の協会なので会場はさいたま市内とみなす
        venue = title
        events.append(
            _make_event("kanko", title, date_iso, start, end,
                        venue + "（さいたま市）", href)
        )
    return events


def scrape_pref_saitama(session: requests.Session) -> list[dict]:
    """埼玉県観光情報（県公式トップから関連リンクを軽く拾う）。"""
    url = "https://www.pref.saitama.lg.jp/"
    res = session.get(url, timeout=REQUEST_TIMEOUT)
    res.raise_for_status()
    soup = BeautifulSoup(res.text, "html.parser")
    events: list[dict] = []

    for a in soup.select("a[href]"):
        text = a.get_text(strip=True)
        if not text or "イベント" not in text and "祭" not in text:
            continue
        date_iso = parse_date(text)
        if not date_iso or not within_range(date_iso):
            continue
        if not in_south_saitama(text):
            continue
        href = a["href"]
        if href.startswith("/"):
            href = "https://www.pref.saitama.lg.jp" + href
        start, end = parse_time(text)
        events.append(_make_event("pref", text, date_iso, start, end, text, href))
    return events


def _make_event(src: str, title: str, date_iso: str,
                start: str | None, end: str | None,
                venue: str, href: str) -> dict:
    level = guess_demand_level(title, "")
    ev = {
        "id": stable_id(src, title, date_iso),
        "title": title[:80],
        "date": date_iso,
        "venue": venue[:120],
        "category": "",
        "demand_level": level,
        "demand_comment": default_comment(level),
        "source_url": href,
        "_geocode_query": venue or title,  # 後でgeocode、最後に削除
    }
    if start:
        ev["time_start"] = start
    if end:
        ev["time_end"] = end
    return ev


# --------------------------------------------------------------------------- #
# メイン処理
# --------------------------------------------------------------------------- #
SCRAPERS = [
    ("じゃらんnet", scrape_jalan),
    ("さいたま市観光協会", scrape_saitama_kanko),
    ("埼玉県観光情報", scrape_pref_saitama),
]


def load_existing() -> dict:
    if DATA_FILE.exists():
        try:
            return json.loads(DATA_FILE.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as exc:
            log(f"既存JSON読み込み失敗（無視して新規作成）: {exc}")
    return {"updated_at": "", "events": []}


def main() -> int:
    session = make_session()
    existing = load_existing()
    existing_events = existing.get("events", []) if isinstance(existing, dict) else []

    # 手動キュレーションは保持
    kept = [e for e in existing_events
            if str(e.get("id", "")).startswith(("manual-", "sample-"))]
    # 既存の自動取得分の座標をキャッシュ（再geocodeを避ける）
    coord_cache: dict[str, tuple[float, float]] = {}
    for e in existing_events:
        if isinstance(e.get("lat"), (int, float)) and isinstance(e.get("lng"), (int, float)):
            coord_cache[e.get("venue", "")] = (e["lat"], e["lng"])

    scraped: list[dict] = []
    for name, fn in SCRAPERS:
        try:
            got = fn(session)
            log(f"{name}: {len(got)}件取得")
            scraped.extend(got)
            time.sleep(1.0)  # サイトへの負荷軽減
        except Exception as exc:  # noqa: BLE001 — 1サイトの失敗で全体を止めない
            log(f"{name}: スキップ（{type(exc).__name__}: {exc}）")
            continue

    # geocoding（キャッシュ優先）
    geocoder = Geocoder()
    resolved: list[dict] = []
    for ev in scraped:
        query = ev.pop("_geocode_query", ev.get("venue", ""))
        coord = coord_cache.get(ev.get("venue", "")) or geocoder.locate(query)
        if coord is None:
            log(f"座標解決できずスキップ: {ev['title']}")
            continue
        ev["lat"], ev["lng"] = coord
        resolved.append(ev)

    # マージ＆重複排除（id基準、kept優先）
    merged: dict[str, dict] = {}
    for ev in kept + resolved:
        merged[ev["id"]] = ev

    events_out = sorted(
        merged.values(),
        key=lambda e: (e.get("date", ""), e.get("time_start", "99:99")),
    )

    payload = {
        "updated_at": dt.datetime.now(JST).isoformat(timespec="seconds"),
        "events": events_out,
    }
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    DATA_FILE.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    log(f"書き出し完了: {len(events_out)}件（手動{len(kept)} / 自動{len(resolved)}）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
