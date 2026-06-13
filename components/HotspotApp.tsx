"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import type { EventsData, TaxiEvent } from "@/lib/types";
import {
  formatDistance,
  formatTimeRange,
  googleMapsDirUrl,
  gotoubiInfo,
  haversineKm,
  timelineEvents,
  todaysEvents,
  upcomingEvents,
  type LatLng,
} from "@/lib/utils";
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

  const summary =
    today.length > 0
      ? `今日は${today.length}件のイベントあり`
      : list.length > 0
      ? `今日のイベントはなし／直近7日で${list.length}件`
      : "直近のイベント情報はありません";

  return (
    <main className="mx-auto flex h-[100dvh] max-w-screen-sm flex-col bg-white">
      {/* ヘッダー */}
      <header className="shrink-0 border-b border-slate-200 bg-white px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-lg font-bold text-slate-900">
            🚕 需要ホットスポット
          </h1>
          <span className="text-xs text-slate-500">
            最終更新：{formatUpdatedAt(data.updated_at)}
          </span>
        </div>
        <p className="mt-1 text-sm font-semibold text-amber-600">{summary}</p>
        {today.length > 0 && (
          <p className="mt-0.5 truncate text-xs text-slate-500">
            {today
              .map((e) => `${e.title}（${formatTimeRange(e)}）`)
              .join("・")}
          </p>
        )}

        {/* ① 天気連動バナー（Open-Meteo・無料） */}
        <WeatherBanner />

        {/* ④ ごとおび／給料日バナー */}
        {gotoubi && (
          <div className="mt-2 rounded-lg bg-rose-50 px-3 py-1.5 text-sm font-semibold text-rose-700 ring-1 ring-inset ring-rose-200">
            🗓 {gotoubi.label}
            <span className="ml-1 font-normal text-rose-500">{gotoubi.sub}</span>
          </div>
        )}

        {/* ② 現在地 → 最寄りスポット */}
        <div className="mt-2">
          {locStatus !== "ok" ? (
            <button
              type="button"
              onClick={requestLocation}
              disabled={locStatus === "loading"}
              className="w-full rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700 ring-1 ring-inset ring-slate-200 active:bg-slate-200 disabled:opacity-60"
            >
              {locStatus === "loading"
                ? "現在地を取得中…"
                : locStatus === "denied"
                ? "📍 位置情報が取得できませんでした（タップで再試行）"
                : "📍 現在地から最寄りスポットを探す"}
            </button>
          ) : nearest ? (
            <div className="flex items-center gap-2 rounded-lg bg-blue-50 px-3 py-2 ring-1 ring-inset ring-blue-200">
              <div className="min-w-0 flex-1">
                <p className="text-xs text-blue-600">現在地から最寄り</p>
                <button
                  type="button"
                  onClick={() => setSelectedId(nearest.ev.id)}
                  className="block truncate text-left text-sm font-bold text-blue-900"
                >
                  {nearest.ev.title}
                  <span className="ml-1 font-normal text-blue-700">
                    （{formatDistance(nearest.km)}）
                  </span>
                </button>
              </div>
              <a
                href={googleMapsDirUrl(nearest.ev.lat, nearest.ev.lng)}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-bold text-white active:bg-blue-700"
              >
                向かう ▶
              </a>
            </div>
          ) : (
            <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-500">
              現在地は取得しましたが、近くの対象イベントがありません。
            </p>
          )}
        </div>
      </header>

      {/* マップ（画面の約55%。要素が増えても潰れないよう shrink を許可） */}
      <section className="min-h-[200px] shrink basis-[55%]">
        <MapView
          events={data.events}
          selectedId={selectedId}
          userLoc={userLoc}
        />
      </section>

      {/* 凡例 */}
      <div className="flex shrink-0 items-center gap-4 border-y border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-600">
        <span className="flex items-center gap-1">
          <span className="h-3 w-3 rounded-full bg-demand-high" />大需要
        </span>
        <span className="flex items-center gap-1">
          <span className="h-3 w-3 rounded-full bg-demand-medium" />中需要
        </span>
        <span className="flex items-center gap-1">
          <span className="h-3 w-3 rounded-full bg-demand-low" />小・参考
        </span>
      </div>

      {/* ③ 稼ぎどきタイムライン（今日のイベントがある時だけ） */}
      <EarningsTimeline events={timeline} onSelect={setSelectedId} />

      {/* イベント一覧（スクロール） */}
      <section className="min-h-0 flex-1 overflow-y-auto bg-white">
        <div className="sticky top-0 z-[1] bg-white/95 px-4 py-2 text-xs font-bold text-slate-500 backdrop-blur">
          直近7日間のイベント（{list.length}件）
        </div>
        <EventList
          events={list}
          selectedId={selectedId}
          onSelect={setSelectedId}
          userLoc={userLoc}
        />
      </section>
    </main>
  );
}
