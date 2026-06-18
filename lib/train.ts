export type TrainLevel = "suspended" | "delay";

export interface TrainLine {
  label: string;
  level: TrainLevel;
  detail: string;
}

/** JRの運行情報（運転見合わせ・遅延）を取得。平常時は空配列。 */
export async function fetchTrain(): Promise<TrainLine[]> {
  try {
    const r = await fetch("/api/train", { cache: "no-store" });
    if (!r.ok) return [];
    const d = await r.json();
    return Array.isArray(d.lines) ? (d.lines as TrainLine[]) : [];
  } catch {
    return [];
  }
}
