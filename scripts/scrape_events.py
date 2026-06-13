#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
県南中央交通圏（さいたま市・川口・蕨・戸田・上尾・桶川・北本・鴻巣・伊奈・蓮田）の
タクシー需要に効くイベント情報を収集し data/events.json を更新する。

データ源:
  Walkerplus 埼玉県イベント一覧（https://www.walkerplus.com/event_list/ar0311/）
  - 各イベントに「市区町村・会場・開催期間・ジャンル」が構造化されており、
    エリア絞り込みと需要レベル判定が確実に行える。
  ※ じゃらん/各観光協会は URL 変更・接続不可で安定取得できなかったため Walkerplus を採用。

方針:
  - 対象10市町のイベントのみ採用。
  - 直近 RANGE_DAYS 日以内に開催されるものに限定し、長期開催（ビアガーデン等）の
    ノイズは需要キーワードが無ければ除外。
  - 会場住所は geopy + Nominatim(無料) で緯度経度へ。失敗時は市の中心座標へフォールバック
    （ジオコーディング失敗だけでイベントを取りこぼさない）。
  - スクレイプが0件（サイト障害等）の場合は、前回取得できた自動データを残す（空にしない）。
  - id が "manual-" で始まる手動登録は常に保持。架空サンプル("sample-")は破棄。
"""

from __future__ import annotations

import json
import re
import sys
import time
import datetime as dt
from pathlib import Path

import requests
from bs4 import BeautifulSoup
from geopy.geocoders import Nominatim
from geopy.extra.rate_limiter import RateLimiter

ROOT = Path(__file__).resolve().parents[1]
DATA_FILE = ROOT / "data" / "events.json"

JST = dt.timezone(dt.timedelta(hours=9))
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)
GEO_UA = "taxi-hotspot-map/1.0 (kennan-chuo taxi event collector)"
LIST_URL = "https://www.walkerplus.com/event_list/ar0311/"
SITE = "https://www.walkerplus.com"
REQUEST_TIMEOUT = 20
MAX_PAGES = 25
RANGE_DAYS = 14  # 今日からこの日数以内に開催されるものを採用

# 県南中央交通圏の対象市町（Walkerplus の市区町村表記に含まれる文字列）
TARGET_CITIES = [
    "さいたま市", "川口市", "蕨市", "戸田市", "上尾市",
    "桶川市", "北本市", "鴻巣市", "伊奈町", "蓮田市",
]

# ジオコーディング失敗時のフォールバック中心座標（区→市の順で部分一致）
CITY_CENTROIDS: list[tuple[str, float, float]] = [
    ("さいたま市大宮区", 35.9067, 139.6238),
    ("さいたま市浦和区", 35.8617, 139.6573),
    ("さいたま市中央区", 35.8889, 139.6300),
    ("さいたま市北区", 35.9300, 139.6200),
    ("さいたま市見沼区", 35.9300, 139.6600),
    ("さいたま市緑区", 35.8900, 139.7100),
    ("さいたま市南区", 35.8500, 139.6500),
    ("さいたま市西区", 35.9300, 139.5700),
    ("さいたま市桜区", 35.8600, 139.6100),
    ("さいたま市岩槻区", 35.9500, 139.6900),
    ("さいたま市", 35.8617, 139.6455),
    ("川口市", 35.8078, 139.7240),
    ("蕨市", 35.8255, 139.6797),
    ("戸田市", 35.8175, 139.6779),
    ("上尾市", 35.9776, 139.5933),
    ("桶川市", 36.0015, 139.5586),
    ("北本市", 36.0268, 139.5301),
    ("鴻巣市", 36.0660, 139.5150),
    ("伊奈町", 35.9990, 139.6210),
    ("蓮田市", 35.9920, 139.6620),
]

# 需要がほぼ見込めない参加型・小規模イベントは収集対象から除外（タイトルで判定）
EXCLUDE_KW = ["教室", "もくもく", "体験", "絵付け", "づくり", "ワークショップ",
              "勉強会", "講習会", "セミナー", "相談会", "親子で"]
# 需要レベル判定（ジャンルタグは誤判定が多いのでタイトルと会場名のみで判定）
LOW_KW = ["講座", "講習", "講演", "上映", "独演会", "個展",
          "原画展", "童画展", "写真展", "作品展", "展示会", "原画"]
HIGH_TITLE = ["花火", "マラソン", "万灯", "大花火"]
HIGH_VENUE = ["スーパーアリーナ", "スタジアム", "大宮公園", "ソニックシティ",
              "けやきひろば", "新都心", "NACK5", "駒場"]
MED_KW = ["まつり", "祭", "マルシェ", "フェア", "マーケット", "盆踊", "縁日",
          "フェス", "FES", "コンサート", "ライブ", "ショー", "POP", "物産",
          "即売", "ビアガーデン", "屋台", "夜市", "ナイトマーケット"]
# 中規模の会場（大ホール・市民会館など）での公演は中需要扱い
MED_VENUE = ["芸術劇場", "音楽ホール", "埼玉会館", "市民会館", "文化会館",
             "文化ホール", "リリア", "大ホール", "市民会館うらわ"]


def log(msg: str) -> None:
    print(f"[scrape] {msg}", file=sys.stderr)


# --------------------------------------------------------------------------- #
# 取得・パース
# --------------------------------------------------------------------------- #
def fetch_page(session: requests.Session, page: int) -> BeautifulSoup | None:
    url = LIST_URL if page == 1 else f"{LIST_URL}{page}.html"
    try:
        r = session.get(url, timeout=REQUEST_TIMEOUT)
        if r.status_code != 200:
            return None
        r.encoding = "utf-8"
        return BeautifulSoup(r.text, "html.parser")
    except requests.RequestException as exc:
        log(f"page{page} 取得失敗: {exc}")
        return None


_FULL_YEAR = dt.datetime.now(JST).year


def parse_period(period: str) -> tuple[dt.date, dt.date] | None:
    """「2026年5月30日(土)〜6月21日(日)」等から開始・終了日を返す。"""
    last_year, last_month = _FULL_YEAR, None
    dates: list[dt.date] = []
    for y, m, d in re.findall(r"(?:(\d{4})年)?(?:(\d{1,2})月)?(\d{1,2})日", period):
        year = int(y) if y else last_year
        month = int(m) if m else last_month
        if month is None:
            continue
        try:
            dates.append(dt.date(year, month, int(d)))
        except ValueError:
            continue
        last_year, last_month = year, month
    if not dates:
        return None
    return dates[0], dates[-1]


def classify(title: str, venue: str) -> str:
    """需要レベルを判定。講演・展示は小、大型会場や花火は大、祭・市・ライブは中。"""
    if any(k in title for k in LOW_KW):
        return "low"
    if any(k in venue for k in HIGH_VENUE) or any(k in title for k in HIGH_TITLE):
        return "high"
    if any(k in title for k in MED_KW) or any(k in venue for k in MED_VENUE):
        return "medium"
    return "low"


def demand_comment(level: str, station: str) -> str:
    near = f"最寄り：{station}。" if station else ""
    return {
        "high": f"{near}大規模イベント。終了時間帯に会場周辺で需要集中の可能性。早めの待機を推奨。",
        "medium": f"{near}中規模イベント。来場者の行き帰りで駅・会場周辺に需要が見込まれます。",
        "low": f"{near}小規模・長期開催など。需要は限定的。近くを通る際の参考に。",
    }[level]


def clean_city(city: str) -> str:
    return city.replace("埼玉県", "").strip()


def centroid_for(city: str) -> tuple[float, float]:
    for key, lat, lng in CITY_CENTROIDS:
        if key in city:
            return lat, lng
    return 35.8617, 139.6455  # さいたま市中心


def event_id(href: str) -> str:
    m = re.search(r"(e\d+)", href)
    return f"wp-{m.group(1)}" if m else f"wp-{abs(hash(href)) % 10**8}"


def scrape(session: requests.Session) -> list[dict]:
    today = dt.datetime.now(JST).date()
    window_end = today + dt.timedelta(days=RANGE_DAYS)
    seen: set[str] = set()
    seen_key: set = set()
    rows: list[dict] = []

    for page in range(1, MAX_PAGES + 1):
        soup = fetch_page(session, page)
        if soup is None:
            break
        items = soup.select(".m-mainlist-item")
        if not items:
            break
        for el in items:
            ttl = el.select_one(".m-mainlist-item__ttl")
            mp = el.select_one(".m-mainlist-item__map")
            if not ttl or not mp:
                continue
            city = mp.get_text(" ", strip=True)
            if not any(c in city for c in TARGET_CITIES):
                continue
            a = el.select_one('a[href^="/event/"]')
            href = a["href"] if a else ""
            if not href or href in seen:
                continue

            per_el = el.select_one(".m-mainlist-item-event__period")
            period = per_el.get_text(" ", strip=True) if per_el else ""
            span = parse_period(period)
            if span is None:
                continue
            start, end = span
            title = ttl.get_text(strip=True)

            # 需要がほぼ無い参加型・小規模（教室/体験/もくもく等）は除外
            if any(k in title for k in EXCLUDE_KW):
                continue
            # 開催期間が窓に重なるか
            if not (start <= window_end and end >= today):
                continue

            place_el = el.select_one(".m-mainlist-item-event__place")
            station_el = el.select_one(".m-mainlist-item__station")
            place = place_el.get_text(strip=True) if place_el else ""
            station = station_el.get_text(strip=True) if station_el else ""

            level = classify(title, place)
            # 長期開催ノイズ（21日超）は大需要以外は除外
            if (end - start).days > 21 and level != "high":
                continue
            # 同一イベント（タイトル・開催日・会場）の重複を排除
            dk = (title, start.isoformat(), place)
            if dk in seen_key:
                continue
            seen_key.add(dk)
            seen.add(href)

            # 開催中（開始日が過去）のものは「本日」として扱い、終了済み表示を防ぐ
            disp = start if start >= today else today
            rows.append({
                "id": event_id(href),
                "title": title,
                "date": disp.isoformat(),
                "date_end": end.isoformat(),
                "venue": f"{place}（{clean_city(city)}）" if place else clean_city(city),
                "category": "",
                "demand_level": level,
                "demand_comment": demand_comment(level, station),
                "source_url": SITE + href,
                "_geo_place": place,
                "_geo_city": clean_city(city),
            })
        time.sleep(0.5)  # サイトへの負荷軽減

    return rows


# --------------------------------------------------------------------------- #
# ジオコーディング
# --------------------------------------------------------------------------- #
class Geocoder:
    def __init__(self, cache: dict[str, tuple[float, float]]):
        nom = Nominatim(user_agent=GEO_UA, timeout=REQUEST_TIMEOUT)
        self._geocode = RateLimiter(nom.geocode, min_delay_seconds=1.1)
        self._cache = cache

    def locate(self, place: str, city: str) -> tuple[float, float]:
        key = f"{place}|{city}"
        if key in self._cache:
            return self._cache[key]
        coord = None
        for q in (f"{place}, {city}, 埼玉県, 日本" if place else None,
                  f"{city}, 埼玉県, 日本"):
            if not q:
                continue
            try:
                loc = self._geocode(q, country_codes="jp")
                if loc:
                    coord = (round(loc.latitude, 5), round(loc.longitude, 5))
                    break
            except Exception as exc:  # noqa: BLE001
                log(f"geocode失敗({q}): {exc}")
        if coord is None:
            coord = centroid_for(city)  # フォールバック：市の中心
        self._cache[key] = coord
        return coord


# --------------------------------------------------------------------------- #
# メイン
# --------------------------------------------------------------------------- #
def load_existing() -> dict:
    if DATA_FILE.exists():
        try:
            return json.loads(DATA_FILE.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as exc:
            log(f"既存JSON読込失敗（無視）: {exc}")
    return {"updated_at": "", "events": []}


def main() -> int:
    session = requests.Session()
    session.headers.update({"User-Agent": UA, "Accept-Language": "ja"})

    existing = load_existing()
    ex_events = existing.get("events", []) if isinstance(existing, dict) else []
    kept_manual = [e for e in ex_events if str(e.get("id", "")).startswith("manual-")]
    prev_auto = [e for e in ex_events if str(e.get("id", "")).startswith("wp-")]

    # 既存座標をキャッシュ（再ジオコーディングを避ける）
    cache: dict[str, tuple[float, float]] = {}
    for e in ex_events:
        p, c = e.get("_geo_key_place"), e.get("_geo_key_city")
        if isinstance(e.get("lat"), (int, float)) and p is not None:
            cache[f"{p}|{c}"] = (e["lat"], e["lng"])

    try:
        scraped = scrape(session)
        log(f"Walkerplus 取得: 対象エリア {len(scraped)} 件")
    except Exception as exc:  # noqa: BLE001 — 全体は落とさない
        log(f"スクレイプ失敗、前回データを維持: {exc}")
        scraped = []

    if not scraped:
        # 取得ゼロ：前回の自動データを温存して空表示を避ける
        events_out = kept_manual + prev_auto
        log("取得0件のため前回の自動データを維持します。")
    else:
        geocoder = Geocoder(cache)
        resolved = []
        for ev in scraped:
            place = ev.pop("_geo_place")
            city = ev.pop("_geo_city")
            lat, lng = geocoder.locate(place, city)
            ev["lat"], ev["lng"] = lat, lng
            ev["_geo_key_place"] = place  # 次回のキャッシュ用
            ev["_geo_key_city"] = city
            resolved.append(ev)
        events_out = kept_manual + resolved

    events_out.sort(key=lambda e: (e.get("date", ""), e.get("title", "")))

    payload = {
        "updated_at": dt.datetime.now(JST).isoformat(timespec="seconds"),
        "events": events_out,
    }
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    DATA_FILE.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    log(f"書き出し完了: {len(events_out)} 件（手動{len(kept_manual)} / 自動{len(events_out)-len(kept_manual)}）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
