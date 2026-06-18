"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { EventsData, TaxiEvent } from "@/lib/types";
import {
  formatDistance,
  googleMapsDirUrl,
  gotoubiInfo,
  haversineKm,
  timelineEvents,
  todaysEvents,
  upcomingEvents,
  type LatLng,
} from "@/lib/utils";
import { getDeviceId } from "@/lib/device";
import {
  deleteHelp,
  fetchHelps,
  formatRetry,
  postHelp,
  type HelpMarker,
} from "@/lib/help";
import { fetchTrain, type TrainLine } from "@/lib/train";
import { LINE_STATIONS } from "@/lib/trainStations";
import EventList from "./EventList";
import EarningsTimeline from "./EarningsTimeline";
import WeatherBanner from "./WeatherBanner";

// Leaflet は window に依存するため SSR を無効化して読み込む
const MapView = dynamic(() => import("./MapView"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-slate-100 text-slate-500">
      地図を読み込み中…
    </div>
  ),
});

interface HotspotAppProps {
  data: EventsData;
}

type LocStatus = "idle" | "loading" | "ok" | "denied";

function formatUpdatedAt(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  // JSTで表示
  const jst = new Date(d.getTime() + (d.getTimezoneOffset() + 540) * 60000);
  const mm = String(jst.getMonth() + 1).padStart(2, "0");
  const dd = String(jst.getDate()).padStart(2, "0");
  const hh = String(jst.getHours()).padStart(2, "0");
  const mi = String(jst.getMinutes()).padStart(2, "0");
  return `${mm}/${dd} ${hh}時${mi}分`;
}

export default function HotspotApp({ data }: HotspotAppProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [userLoc, setUserLoc] = useState<LatLng | null>(null);
  const [locStatus, setLocStatus] = useState<LocStatus>("idle");

  const list = useMemo(() => upcomingEvents(data.events, 7), [data.events]);
  const today = useMemo(() => todaysEvents(data.events), [data.events]);
  const timeline = useMemo(() => timelineEvents(data.events), [data.events]);
  const gotoubi = useMemo(() => gotoubiInfo(), []);

  // 現在地から最も近い「今日〜7日以内」のイベント
  const nearest = useMemo(() => {
    if (!userLoc || list.length === 0) return null;
    let best: { ev: TaxiEvent; km: number } | null = null;
    for (const ev of list) {
      const km = haversineKm(userLoc, { lat: ev.lat, lng: ev.lng });
      if (!best || km < best.km) best = { ev, km };
    }
    return best;
  }, [userLoc, list]);

  const requestLocation = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocStatus("denied");
      return;
    }
    setLocStatus("loading");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocStatus("ok");
      },
      () => setLocStatus("denied"),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
  };

  // --- ヘルプマーク（乗務員間共有） ---
  const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
  const MY_KEY = "my_help_marker";
  const [helps, setHelps] = useState<HelpMarker[]>([]);
  const [placeMode, setPlaceMode] = useState(false);
  const [helpMsg, setHelpMsg] = useState<{ text: string; tone: "ok" | "warn" } | null>(null);
  const [sending, setSending] = useState(false);
  // 自分が登録したマーク（取り消し用）
  const [myHelp, setMyHelp] = useState<{ id: string; ts: number } | null>(null);
  const deviceIdRef = useRef<string>("");

  useEffect(() => {
    deviceIdRef.current = getDeviceId();
    // 自分の登録を復元（2時間以内のみ有効）
    try {
      const raw = localStorage.getItem(MY_KEY);
      if (raw) {
        const v = JSON.parse(raw) as { id: string; ts: number };
        if (v?.id && Date.now() - v.ts < TWO_HOURS_MS) setMyHelp(v);
        else localStorage.removeItem(MY_KEY);
      }
    } catch {
      /* ignore */
    }
    let alive = true;
    const load = async () => {
      const m = await fetchHelps();
      if (alive) setHelps(m);
    };
    load();
    const t = setInterval(load, 25000); // 25秒ごとに更新
    return () => {
      alive = false;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 自分のマークが2時間経過したら取り消しボタンを隠す
  const hasMyHelp = !!myHelp && Date.now() - myHelp.ts < TWO_HOURS_MS;

  // --- 電車遅延（JR） ---
  const [trainLines, setTrainLines] = useState<TrainLine[]>([]);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const t = await fetchTrain();
      if (alive) setTrainLines(t);
    };
    load();
    const id = setInterval(load, 180000); // 3分ごと
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // 影響路線の駅を地図ハイライト用に展開（運転見合わせを優先表示）
  const trainStations = useMemo(() => {
    const out: {
      name: string;
      lat: number;
      lng: number;
      level: "suspended" | "delay";
      line: string;
    }[] = [];
    for (const t of trainLines) {
      for (const s of LINE_STATIONS[t.label] ?? []) {
        out.push({ ...s, level: t.level, line: t.label });
      }
    }
    return out;
  }, [trainLines]);

  const suspended = trainLines.filter((t) => t.level === "suspended");
  const delayed = trainLines.filter((t) => t.level === "delay");

  const refreshHelps = useCallback(async () => {
    setHelps(await fetchHelps());
  }, []);

  const flash = useCallback((text: string, tone: "ok" | "warn") => {
    setHelpMsg({ text, tone });
    window.setTimeout(() => setHelpMsg(null), 4500);
  }, []);

  const submitHelp = useCallback(
    async (lat: number, lng: number) => {
      setSending(true);
      const res = await postHelp(lat, lng, deviceIdRef.current);
      setSending(false);
      if (res.ok) {
        if (res.id) {
          const rec = { id: res.id, ts: Date.now() };
          setMyHelp(rec);
          try {
            localStorage.setItem(MY_KEY, JSON.stringify(rec));
          } catch {
            /* ignore */
          }
        }
        flash("🙋 登録しました（2時間表示されます）", "ok");
        refreshHelps();
      } else if (res.error === "rate_limited") {
        flash(`このスマホは2時間に1回まで。${formatRetry(res.retryAfterSec)}は押せません`, "warn");
      } else if (res.error === "out_of_area") {
        flash("エリア外のため登録できませんでした", "warn");
      } else if (res.error === "not_configured") {
        flash("ヘルプ機能は現在準備中です（まもなく開始）", "warn");
      } else {
        flash("登録に失敗しました。通信状況をご確認ください", "warn");
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [flash, refreshHelps]
  );

  // 現在地ワンタップで登録（確認ダイアログあり）
  const helpHere = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      flash("位置情報が使えません", "warn");
      return;
    }
    if (!window.confirm("現在地に「客多い（応援要請）」を登録しますか？")) return;
    setSending(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => submitHelp(pos.coords.latitude, pos.coords.longitude),
      () => {
        setSending(false);
        flash("現在地を取得できませんでした", "warn");
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
    );
  }, [flash, submitHelp]);

  // 地図タップで登録（確認ダイアログあり）
  const handleMapClick = useCallback(
    (lat: number, lng: number) => {
      setPlaceMode(false);
      if (!window.confirm("この地点に「客多い」を登録しますか？")) return;
      submitHelp(lat, lng);
    },
    [submitHelp]
  );

  // 自分のヘルプを取り消す（レート制限はリセットしない）
  const deleteOwnHelp = useCallback(async () => {
    if (!myHelp) return;
    if (
      !window.confirm(
        "自分のヘルプを取り消しますか？\n※取り消しても、次に押せるのは登録から2時間後のままです。"
      )
    )
      return;
    setSending(true);
    const r = await deleteHelp(myHelp.id, deviceIdRef.current);
    setSending(false);
    if (r.ok) {
      setMyHelp(null);
      try {
        localStorage.removeItem(MY_KEY);
      } catch {
        /* ignore */
      }
      flash("取り消しました（次に押せるのは登録から2時間後のまま）", "ok");
      refreshHelps();
    } else {
      flash("取り消しに失敗しました", "warn");
    }
  }, [myHelp, flash, refreshHelps]);

  const summary =
    today.length > 0
      ? `今日は${today.length}件のイベントあり`
      : list.length > 0
      ? `今日のイベントはなし／直近7日で${list.length}件`
      : "直近のイベント情報はありません";

  return (
    <main className="mx-auto max-w-screen-sm bg-white">
      {/* スリムなヘッダー（1行） */}
      <header className="sticky top-0 z-[1001] flex items-center justify-between gap-2 border-b border-slate-200 bg-white/95 px-3 py-2 backdrop-blur">
        <div className="flex min-w-0 items-baseline gap-2">
          <h1 className="shrink-0 whitespace-nowrap text-base font-bold text-slate-900">
            🚕 需要マップ
          </h1>
          <span className="truncate text-xs font-semibold text-amber-600">
            {summary}
          </span>
        </div>
        <span className="shrink-0 text-[10px] text-slate-400">
          更新 {formatUpdatedAt(data.updated_at)}
        </span>
      </header>

      {/* 電車遅延バナー（運転見合わせ＝赤／遅延＝黄。平常時は非表示） */}
      {(suspended.length > 0 || delayed.length > 0) && (
        <div
          className={`flex items-start gap-2 px-3 py-2 text-xs font-bold ${
            suspended.length > 0
              ? "bg-red-600 text-white"
              : "bg-amber-400 text-amber-950"
          }`}
        >
          <span className="shrink-0">🚆</span>
          <span className="min-w-0">
            {suspended.length > 0 && (
              <span>
                【運転見合わせ】{suspended.map((t) => t.label).join("・")}
                <span className="font-normal">｜該当駅周辺で需要急増の可能性。早めの待機を。</span>
              </span>
            )}
            {suspended.length > 0 && delayed.length > 0 && <br />}
            {delayed.length > 0 && (
              <span>
                【遅延】{delayed.map((t) => t.label).join("・")}
                {delayed[0]?.detail && (
                  <span className="font-normal">｜{delayed[0].detail}</span>
                )}
              </span>
            )}
          </span>
        </div>
      )}

      {/* マップ：最初の1画面をほぼ占有（下に少しだけ次の内容を覗かせてスクロールを示唆） */}
      <section className="relative h-[calc(100dvh-6rem)] min-h-[380px]">
        <MapView
          events={data.events}
          selectedId={selectedId}
          userLoc={userLoc}
          helpMarkers={helps}
          placeMode={placeMode}
          onMapClick={handleMapClick}
          trainStations={trainStations}
        />

        {/* 天気（雨時のみ）・ごとおび：地図左上の小チップ */}
        <div className="absolute left-2 top-2 z-[1000] flex max-w-[58%] flex-col items-start gap-1.5">
          <WeatherBanner />
          {gotoubi && (
            <span
              title={gotoubi.sub}
              className="inline-flex items-center rounded-full bg-rose-100 px-2.5 py-1 text-[11px] font-bold text-rose-700 shadow ring-1 ring-inset ring-rose-200"
            >
              🗓 {gotoubi.label}
            </span>
          )}
        </div>

        {/* 凡例：地図右上の小チップ */}
        <div className="absolute right-2 top-2 z-[1000] flex items-center gap-1.5 rounded-full bg-white/90 px-2.5 py-1 text-[10px] font-medium text-slate-600 shadow ring-1 ring-slate-200">
          <span className="flex items-center gap-0.5">
            <span className="h-2 w-2 rounded-full bg-demand-high" />大
          </span>
          <span className="flex items-center gap-0.5">
            <span className="h-2 w-2 rounded-full bg-demand-medium" />中
          </span>
          <span className="flex items-center gap-0.5">
            <span className="h-2 w-2 rounded-full bg-demand-low" />小
          </span>
        </div>

        {/* 現在地（右下） */}
        {locStatus !== "ok" && (
          <button
            type="button"
            onClick={requestLocation}
            disabled={locStatus === "loading"}
            className="absolute bottom-3 right-3 z-[1000] rounded-full bg-white px-4 py-2.5 text-sm font-bold text-slate-700 shadow-lg ring-1 ring-slate-300 active:bg-slate-100 disabled:opacity-60"
          >
            {locStatus === "loading"
              ? "取得中…"
              : locStatus === "denied"
              ? "📍 再試行"
              : "📍 現在地"}
          </button>
        )}

        {/* ヘルプ（左下） */}
        <div className="absolute bottom-3 left-3 z-[1000] flex flex-col items-start gap-2">
          <button
            type="button"
            onClick={helpHere}
            disabled={sending}
            className="rounded-full bg-orange-500 px-4 py-2.5 text-sm font-bold text-white shadow-lg ring-2 ring-white active:bg-orange-600 disabled:opacity-60"
          >
            🙋 客多い
          </button>
          <button
            type="button"
            onClick={() => setPlaceMode((v) => !v)}
            className={`rounded-full px-3 py-1.5 text-xs font-bold shadow ring-1 ring-slate-300 ${
              placeMode
                ? "bg-orange-100 text-orange-700"
                : "bg-white/90 text-slate-600"
            }`}
          >
            {placeMode ? "タップで登録（解除）" : "🗺 地図で指定"}
          </button>
          {hasMyHelp && (
            <button
              type="button"
              onClick={deleteOwnHelp}
              disabled={sending}
              className="rounded-full bg-white/90 px-3 py-1.5 text-xs font-bold text-rose-600 shadow ring-1 ring-rose-300 active:bg-rose-50 disabled:opacity-60"
            >
              🗑 取り消す
            </button>
          )}
        </div>

        {/* 登録モードのヒント（上中央） */}
        {placeMode && (
          <div className="absolute left-1/2 top-2 z-[1000] -translate-x-1/2 rounded-full bg-orange-600 px-3 py-1.5 text-xs font-bold text-white shadow-lg">
            客が多い地点をタップ
          </div>
        )}

        {/* 結果トースト（操作ボタンの上） */}
        {helpMsg && (
          <div
            className={`absolute bottom-20 left-1/2 z-[1001] max-w-[80%] -translate-x-1/2 rounded-lg px-3 py-2 text-center text-xs font-bold text-white shadow-lg ${
              helpMsg.tone === "ok" ? "bg-emerald-600" : "bg-slate-700"
            }`}
          >
            {helpMsg.text}
          </div>
        )}
      </section>

      {/* ②最寄りスポット（現在地取得後・地図直下のスリムバー） */}
      {locStatus === "ok" && nearest && (
        <div className="flex items-center gap-2 border-b border-blue-200 bg-blue-50 px-3 py-2">
          <button
            type="button"
            onClick={() => setSelectedId(nearest.ev.id)}
            className="min-w-0 flex-1 truncate text-left text-sm font-bold text-blue-900"
          >
            📍最寄り {nearest.ev.title}
            <span className="ml-1 font-normal text-blue-700">
              （{formatDistance(nearest.km)}）
            </span>
          </button>
          <a
            href={googleMapsDirUrl(nearest.ev.lat, nearest.ev.lng)}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-bold text-white active:bg-blue-700"
          >
            向かう ▶
          </a>
        </div>
      )}

      {/* ③稼ぎどきタイムライン（今日のイベントを大→中→小で表示） */}
      <EarningsTimeline events={timeline} onSelect={setSelectedId} />

      {/* イベント一覧 */}
      <div className="px-3 pt-3 pb-1 text-xs font-bold text-slate-500">
        直近7日間のイベント（{list.length}件）
      </div>
      <EventList
        events={list}
        selectedId={selectedId}
        onSelect={setSelectedId}
        userLoc={userLoc}
      />

      {/* 注記（最下部・控えめ） */}
      <p className="px-3 py-3 text-center text-[10px] leading-snug text-slate-400">
        ℹ️ イベントは毎日自動更新（出典：Walkerplus／さいたまスーパーアリーナ）。需要レベルは自動推定、開始時刻は未掲載の場合があります。
      </p>
    </main>
  );
}
