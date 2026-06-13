import type { DemandLevel, TaxiEvent } from "./types";

/** JST(+09:00) の現在時刻を Date として返す（実行環境のTZに依存しない） */
export function nowJst(): Date {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utc + 9 * 3600000);
}

/** JST基準の YYYY-MM-DD 文字列 */
export function jstDateString(d: Date = nowJst()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 2つの YYYY-MM-DD の差（b - a）を日数で返す */
export function diffDays(a: string, b: string): number {
  const da = new Date(`${a}T00:00:00+09:00`).getTime();
  const db = new Date(`${b}T00:00:00+09:00`).getTime();
  return Math.round((db - da) / 86400000);
}

/** イベントが過去（今日より前）かどうか */
export function isPast(ev: TaxiEvent, today = jstDateString()): boolean {
  return diffDays(today, ev.date) < 0;
}

/** 今日〜rangeDays日以内のイベントを日付・開始時刻順で返す */
export function upcomingEvents(
  events: TaxiEvent[],
  rangeDays = 7,
  today = jstDateString()
): TaxiEvent[] {
  return [...events]
    .filter((ev) => {
      const d = diffDays(today, ev.date);
      return d >= 0 && d <= rangeDays;
    })
    .sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return (a.time_start ?? "99:99").localeCompare(b.time_start ?? "99:99");
    });
}

/** 今日のイベント */
export function todaysEvents(
  events: TaxiEvent[],
  today = jstDateString()
): TaxiEvent[] {
  return events.filter((ev) => ev.date === today);
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

/** 「6/13(金)」のような表示用日付 */
export function formatDateLabel(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00+09:00`);
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]})`;
}

/** 「19:00〜21:00」「19:00〜」「時間未定」 */
export function formatTimeRange(ev: TaxiEvent): string {
  if (ev.time_start && ev.time_end) return `${ev.time_start}〜${ev.time_end}`;
  if (ev.time_start) return `${ev.time_start}〜`;
  return "時間未定";
}

export const DEMAND_LABEL: Record<DemandLevel, string> = {
  high: "大",
  medium: "中",
  low: "小",
};

export const DEMAND_COLOR: Record<DemandLevel, string> = {
  high: "#ef4444",
  medium: "#eab308",
  low: "#22c55e",
};

export interface LatLng {
  lat: number;
  lng: number;
}

/** 2地点間の直線距離(km)。ハバーサイン公式。 */
export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** 距離の表示用整形（< 1km は m 表示） */
export function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)}m`;
  return `${km.toFixed(1)}km`;
}

/** Googleマップのナビ（経路案内）を開くURL。スマホではアプリが起動する。 */
export function googleMapsDirUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
}

export interface GotoubiInfo {
  label: string;
  sub: string;
}

/** ごとおび（5・10・15・20・25・月末）／給料日の判定。該当なしは null。 */
export function gotoubiInfo(d: Date = nowJst()): GotoubiInfo | null {
  const day = d.getDate();
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const isMonthEnd = day === lastDay;
  const isGotoubi = [5, 10, 15, 20, 25].includes(day) || isMonthEnd;
  if (!isGotoubi) return null;
  const isPayday = day === 25 || isMonthEnd;
  const dayLabel = isMonthEnd ? "月末" : `${day}日`;
  const tag = isPayday ? "・給料日" : "";
  return {
    label: `今日は${dayLabel}${tag}（ごとおび）`,
    sub: "繁華街・法人の夜需要が増えやすい日です。早めの繁華街待機が狙い目。",
  };
}

/** 終了時刻（なければ開始時刻）順に並べた今日のイベント。タイムライン用。 */
export function timelineEvents(
  events: TaxiEvent[],
  today = jstDateString()
): TaxiEvent[] {
  return events
    .filter((ev) => ev.date === today)
    .sort((a, b) => {
      const ka = a.time_end ?? a.time_start ?? "99:99";
      const kb = b.time_end ?? b.time_start ?? "99:99";
      return ka.localeCompare(kb);
    });
}
