import { NextResponse } from "next/server";

// リクエスト時にサーバーで取得（RTIはローカル開発回線から不可のため、本番で動かす）
export const dynamic = "force-dynamic";

const RTI_URL = "https://tetsudo.rti-giken.jp/free/delay.json";
const CACHE_TTL = 120_000; // 120秒：RTIへの負荷軽減

// 県南中央交通圏を通るJR路線（RTIの路線名に対する部分一致キー）
const TARGET_LINES: { key: string; label: string }[] = [
  { key: "京浜東北", label: "JR京浜東北線" },
  { key: "埼京", label: "JR埼京線" },
  { key: "川越", label: "JR川越線" },
  { key: "宇都宮", label: "JR宇都宮線" },
  { key: "高崎", label: "JR高崎線" },
  { key: "武蔵野", label: "JR武蔵野線" },
];

interface RtiEntry {
  name?: string;
  company?: string;
}

// サーバーインスタンス内の簡易キャッシュ
let cache: { at: number; payload: unknown } | null = null;

async function load() {
  if (cache && Date.now() - cache.at < CACHE_TTL) return cache.payload;
  let payload: unknown;
  try {
    const r = await fetch(RTI_URL, {
      headers: { "User-Agent": "taxi-hotspot-map/1.0 (event demand map)" },
      cache: "no-store",
    });
    if (!r.ok) {
      payload = { ok: false, reachable: false, lines: [] };
    } else {
      const data = (await r.json()) as RtiEntry[];
      const lines: { label: string; raw: string }[] = [];
      for (const d of data) {
        const name = String(d?.name ?? "");
        const company = String(d?.company ?? "");
        if (name.includes("新幹線")) continue; // 新幹線は対象外
        if (!company.includes("JR")) continue;
        const hit = TARGET_LINES.find((t) => name.includes(t.key));
        if (hit && !lines.some((l) => l.label === hit.label)) {
          lines.push({ label: hit.label, raw: name });
        }
      }
      payload = {
        ok: true,
        reachable: true,
        lines,
        totalDelayed: data.length,
        source: "RTI",
      };
    }
  } catch {
    payload = { ok: false, reachable: false, lines: [] };
  }
  cache = { at: Date.now(), payload };
  return payload;
}

export async function GET() {
  return NextResponse.json(await load());
}
