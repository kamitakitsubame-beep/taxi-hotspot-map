// 端末を識別する固定ID（レート制限用）。localStorage に保存。
const KEY = "taxi_device_id";

export function getDeviceId(): string {
  if (typeof window === "undefined") return "";
  let id = "";
  try {
    id = localStorage.getItem(KEY) ?? "";
    if (!id) {
      id =
        (typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : Math.random().toString(36).slice(2) + Date.now().toString(36));
      localStorage.setItem(KEY, id);
    }
  } catch {
    // localStorage 不可（プライベートモード等）：一時IDを返す
    id = Math.random().toString(36).slice(2);
  }
  return id;
}
