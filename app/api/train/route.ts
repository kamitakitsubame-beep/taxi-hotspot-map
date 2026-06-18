import { NextResponse } from "next/server";
import * as cheerio from "cheerio";

// サーバーで取得（数分ごと更新で十分なため120秒キャッシュ）
export const dynamic = "force-dynamic";

const YAHOO_URL = "https://transit.yahoo.co.jp/diainfo/area/4"; // 関東
const CACHE_TTL = 120_000;

// 対象路線：Yahoo diainfo の路線ID（前方一致）→ 表示名
// ID で特定し、八高線・上越線・東武宇都宮線などの誤マッチを排除する
const TARGET: { id: string; label: string }[] = [
  { id: "/diainfo/22/", label: "JR京浜東北線" },
  { id: "/diainfo/50/", label: "JR埼京・川越線" },
  { id: "/diainfo/46/46", label: "JR宇都宮線" },
  { id: "/diainfo/48/", label: "JR高崎線" },
  { id: "/diainfo/71/", label: "JR武蔵野線" },
];

type Level = "suspended" | "delay" | "normal";

// 「平常運転 事故・遅延情報はありません」に"遅延"が含まれるため、判定順序が重要
function classify(text: string): { level: Level; word: string } {
  if (text.includes("運転見合わせ")) return { level: "suspended", word: "運転見合わせ" };
  if (text.includes("平常運転")) return { level: "normal", word: "平常運転" };
  if (text.includes("列車遅延")) return { level: "delay", word: "列車遅延" };
  if (text.includes("運転状況")) return { level: "delay", word: "運転状況" };
  if (text.includes("遅延")) return { level: "delay", word: "遅延" };
  return { level: "normal", word: "" };
}

let cache: { at: number; payload: unknown } | null = null;

async function load() {
  if (cache && Date.now() - cache.at < CACHE_TTL) return cache.payload;
  let payload: unknown;
  try {
    const r = await fetch(YAHOO_URL, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; taxi-hotspot-map/1.0; event demand map)",
        "Accept-Language": "ja",
      },
      cache: "no-store",
    });
    if (!r.ok) {
      payload = { ok: false, reachable: false, lines: [] };
    } else {
      const $ = cheerio.load(await r.text());
      const lines: { label: string; level: Level; detail: string }[] = [];
      const seen = new Set<string>();
      $('a[href*="/diainfo/"]').each((_, el) => {
        const href = $(el).attr("href") || "";
        const t = TARGET.find((x) => href.startsWith(x.id));
        if (!t || seen.has(t.label)) return;
        seen.add(t.label);
        const ctx = $(el)
          .closest("tr,li,div")
          .text()
          .replace(/\s+/g, " ")
          .trim();
        const st = classify(ctx);
        if (st.level === "normal") return;
        let detail = "";
        const idx = ctx.indexOf(st.word);
        if (idx >= 0) detail = ctx.slice(idx + st.word.length).trim().slice(0, 60);
        lines.push({ label: t.label, level: st.level, detail });
      });
      // 運転見合わせを先に
      lines.sort((a, b) => (a.level === "suspended" ? -1 : 1));
      payload = { ok: true, reachable: true, lines, source: "Yahoo" };
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
