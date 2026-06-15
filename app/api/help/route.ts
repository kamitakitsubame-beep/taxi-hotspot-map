import { NextRequest, NextResponse } from "next/server";
import { Redis } from "@upstash/redis";

export const dynamic = "force-dynamic";

const TTL_MS = 2 * 60 * 60 * 1000; // ヘルプマークの寿命：2時間
const TTL_SEC = 2 * 60 * 60;
const RATE_LIMIT_SEC = 2 * 60 * 60; // 1端末あたり2時間に1回
const MAX_MARKERS = 300; // 総数上限
const KEY = "helps";

// 県南中央交通圏のおおよその範囲（妥当性チェック用）
const BOUNDS = { latMin: 35.6, latMax: 36.2, lngMin: 139.35, lngMax: 139.9 };

function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

/** 有効なヘルプマーク一覧を返す（2時間より古いものは消す） */
export async function GET() {
  const redis = getRedis();
  if (!redis) return NextResponse.json({ markers: [], configured: false });

  const now = Date.now();
  await redis.zremrangebyscore(KEY, 0, now - TTL_MS);
  const raw = (await redis.zrange(KEY, 0, -1, { withScores: true })) as (
    | string
    | number
  )[];

  const markers: { lat: number; lng: number; ageMin: number }[] = [];
  for (let i = 0; i < raw.length; i += 2) {
    const member = String(raw[i]);
    const score = Number(raw[i + 1]);
    const [lat, lng] = member.split(",").map(Number);
    if (!isFinite(lat) || !isFinite(lng)) continue;
    markers.push({
      lat,
      lng,
      ageMin: Math.max(0, Math.floor((now - score) / 60000)),
    });
  }
  return NextResponse.json({ markers, configured: true });
}

/** ヘルプマークを登録（現在地 or 地図タップ地点）。1端末2時間に1回。 */
export async function POST(req: NextRequest) {
  const redis = getRedis();
  if (!redis) {
    return NextResponse.json(
      { ok: false, error: "not_configured" },
      { status: 503 }
    );
  }

  let body: { lat?: unknown; lng?: unknown; deviceId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad_json" }, { status: 400 });
  }

  const lat = Number(body.lat);
  const lng = Number(body.lng);
  const deviceId = String(body.deviceId ?? "").slice(0, 64);
  if (!deviceId || !isFinite(lat) || !isFinite(lng)) {
    return NextResponse.json({ ok: false, error: "bad_params" }, { status: 400 });
  }
  if (
    lat < BOUNDS.latMin || lat > BOUNDS.latMax ||
    lng < BOUNDS.lngMin || lng > BOUNDS.lngMax
  ) {
    return NextResponse.json({ ok: false, error: "out_of_area" }, { status: 400 });
  }

  // レート制限：1端末2時間に1回
  const rlKey = `rl:${deviceId}`;
  const ttl = await redis.ttl(rlKey);
  if (typeof ttl === "number" && ttl > 0) {
    return NextResponse.json(
      { ok: false, error: "rate_limited", retryAfterSec: ttl },
      { status: 429 }
    );
  }
  await redis.set(rlKey, "1", { ex: RATE_LIMIT_SEC });

  const now = Date.now();
  const member = `${lat.toFixed(5)},${lng.toFixed(5)},${now}`;
  await redis.zadd(KEY, { score: now, member });
  // 取り消し時の本人照合用（マークと同じ2時間で自動消滅）
  await redis.set(`owner:${member}`, deviceId, { ex: TTL_SEC });

  // 後始末：期限切れ削除＋総数上限
  await redis.zremrangebyscore(KEY, 0, now - TTL_MS);
  const count = await redis.zcard(KEY);
  if (count > MAX_MARKERS) {
    await redis.zremrangebyrank(KEY, 0, count - MAX_MARKERS - 1);
  }
  return NextResponse.json({ ok: true, id: member });
}

/** 自分が登録したヘルプを取り消す。※レート制限はあえて残す（連打・いたずら防止）。 */
export async function DELETE(req: NextRequest) {
  const redis = getRedis();
  if (!redis) {
    return NextResponse.json(
      { ok: false, error: "not_configured" },
      { status: 503 }
    );
  }

  let body: { id?: unknown; deviceId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad_json" }, { status: 400 });
  }
  const id = String(body.id ?? "");
  const deviceId = String(body.deviceId ?? "").slice(0, 64);
  if (!id) {
    return NextResponse.json({ ok: false, error: "bad_params" }, { status: 400 });
  }

  // 本人のみ取り消し可（登録した端末のみ）
  const owner = await redis.get(`owner:${id}`);
  if (owner && String(owner) !== deviceId) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  await redis.zrem(KEY, id);
  await redis.del(`owner:${id}`);
  // レート制限キー（rl:deviceId）は残すので、再登録は元の2時間後まで不可
  return NextResponse.json({ ok: true });
}
