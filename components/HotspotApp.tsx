"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { getDeviceId } from "@/lib/device";
import {
  fetchHelps,
  formatRetry,
  postHelp,
  type HelpMarker,
} from "@/lib/help";
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
  const [helps, setHelps] = useState<HelpMarker[]>([]);
  const [placeMode, setPlaceMode] = useState(false);
  const [helpMsg, setHelpMsg] = useState<{ text: string; tone: "ok" | "warn" } | null>(null);
  const [sending, setSending] = useState(false);
  const deviceIdRef = useRef<string>("");

  useEffect(() => {
    deviceIdRef.current = getDeviceId();
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
  }, []);

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
    [flash, refreshHelps]
  );

  // 現在地ワンタップで登録
  const helpHere = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      flash("位置情報が使えません", "warn");
      return;
    }
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

  // 地図タップで登録
  const handleMapClick = useCallback(
    (lat: number, lng: number) => {
      setPlaceMode(false);
      submitHelp(lat, lng);
    },
    [submitHelp]
  );

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
        {/* 自動更新データに関する注意書き */}
        <div className="-mx-4 -mt-2.5 mb-2 bg-slate-100 px-4 py-1.5 text-center text-[11px] leading-snug text-slate-600">
          ℹ️ イベントは毎日自動更新（出典：Walkerplus）。需要レベルは自動推定・開始時刻は未掲載の場合があります。詳細は各リンク先でご確認ください。
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
          helpMarkers={helps}
          placeMode={placeMode}
          onMapClick={handleMapClick}
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

        {/* ①ヘルプマーク登録ボタン（地図左下フローティング） */}
        <div className="absolute bottom-3 left-3 z-[1000] flex flex-col items-start gap-2">
          <button
            type="button"
            onClick={helpHere}
            disabled={sending}
            className="rounded-full bg-orange-500 px-4 py-2.5 text-sm font-bold text-white shadow-lg ring-2 ring-white active:bg-orange-600 disabled:opacity-60"
          >
            🙋 客多い（応援要請）
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
            {placeMode ? "タップ地点を登録…（解除）" : "🗺 地図で指定"}
          </button>
        </div>

        {/* 登録モードのヒント */}
        {placeMode && (
          <div className="absolute left-1/2 top-3 z-[1000] -translate-x-1/2 rounded-full bg-orange-600 px-3 py-1.5 text-xs font-bold text-white shadow-lg">
            客が多い地点を地図でタップ
          </div>
        )}

        {/* 結果トースト */}
        {helpMsg && (
          <div
            className={`absolute left-1/2 bottom-3 z-[1001] -translate-x-1/2 rounded-lg px-3 py-2 text-center text-xs font-bold text-white shadow-lg ${
              helpMsg.tone === "ok" ? "bg-emerald-600" : "bg-slate-700"
            }`}
          >
            {helpMsg.text}
          </div>
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
