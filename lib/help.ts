export interface HelpMarker {
  lat: number;
  lng: number;
  /** 押されてからの経過分 */
  ageMin: number;
}

export interface PostHelpResult {
  ok: boolean;
  error?: string;
  /** rate_limited のとき、次に押せるまでの秒数 */
  retryAfterSec?: number;
}

/** 有効なヘルプマークを取得 */
export async function fetchHelps(): Promise<HelpMarker[]> {
  try {
    const r = await fetch("/api/help", { cache: "no-store" });
    if (!r.ok) return [];
    const d = await r.json();
    return Array.isArray(d.markers) ? (d.markers as HelpMarker[]) : [];
  } catch {
    return [];
  }
}

/** ヘルプマークを登録 */
export async function postHelp(
  lat: number,
  lng: number,
  deviceId: string
): Promise<PostHelpResult> {
  try {
    const r = await fetch("/api/help", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat, lng, deviceId }),
    });
    const d = await r.json().catch(() => ({}));
    if (r.ok && d.ok) return { ok: true };
    return { ok: false, error: d.error, retryAfterSec: d.retryAfterSec };
  } catch {
    return { ok: false, error: "network" };
  }
}

/** rate_limited の残り秒を「あと約N分」に整形 */
export function formatRetry(sec?: number): string {
  if (!sec || sec <= 0) return "";
  const min = Math.ceil(sec / 60);
  if (min >= 60) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m ? `あと約${h}時間${m}分` : `あと約${h}時間`;
  }
  return `あと約${min}分`;
}
