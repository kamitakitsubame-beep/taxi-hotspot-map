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
    <main className="mx-auto max-w-screen-sm bg-white pb-8">
      {/* ヘッダー（スクロールしても上に固定。コンパクト化） */}
      <header className="sticky top-0 z-[1001] border-b border-slate-200 bg-white/95 px-4 py-2.5 backdrop-blur">
        {/* デモ版であることの注意バナー（実データ本稼働までの暫定表示） */}
        <div className="-mx-4 -mt-2.5 mb-2 bg-amber-400 px-4 py-1.5 text-center text-[12px] font-bold leading-snug text-amber-950">
          🚧 現在はデモ版です。表示中のイベントは見本データで、実際の開催情報ではありません（実データでの本稼働は近日開始予定）。
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <h1 className="shrink-0 whitespace-nowrap text-lg font-bold text-slate-900">
            🚕 需要ホットスポット
          </h1>
          <span className="min-w-0 truncate text-right text-[11px] text-slate-500">
            更新 {formatUpdatedAt(data.updated_at)}
          </span>
        </div>
        <p className="mt-0.5 text-sm font-semibold text-amber-600">{summary}</p>
        {today.length > 0 && (
          <p className="truncate text-xs text-slate-500">
            {today
              .map((e) => `${e.title}（${formatTimeRange(e)}）`)
              .join("・")}
          </p>
        )}
        {/* ①天気・④ごとおびを小さなチップ1行にまとめる */}
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <WeatherBanner />
          {gotoubi && (
            <span
              title={gotoubi.sub}
              className="inline-flex items-center rounded-full bg-rose-100 px-2.5 py-1 text-xs font-bold text-rose-700 ring-1 ring-inset ring-rose-200"
            >
              🗓 {gotoubi.label}
            </span>
          )}
        </div>
      </header>

      {/* マップ：画面の主役として大きく表示（高さ60vh） */}
      <section className="relative h-[60vh] min-h-[340px]">
        <MapView
          events={data.events}
          selectedId={selectedId}
          userLoc={userLoc}
        />
        {/* ②現在地ボタンを地図の上にフローティング配置（Googleマップ風） */}
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
      </section>

      {/* ②最寄りスポット（現在地取得後に地図直下へ表示） */}
      {locStatus === "ok" && nearest && (
        <div className="flex items-center gap-2 border-b border-blue-200 bg-blue-50 px-4 py-2">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] text-blue-600">現在地から最寄り</p>
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
      )}

      {/* 凡例 */}
      <div className="flex items-center gap-4 border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-600">
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

      {/* ③稼ぎどきタイムライン（今日のイベントを大→中→小で表示） */}
      <EarningsTimeline events={timeline} onSelect={setSelectedId} />

      {/* イベント一覧 */}
      <div className="px-4 py-2 text-xs font-bold text-slate-500">
        直近7日間のイベント（{list.length}件）
      </div>
      <EventList
        events={list}
        selectedId={selectedId}
        onSelect={setSelectedId}
        userLoc={userLoc}
      />
    </main>
  );
}
