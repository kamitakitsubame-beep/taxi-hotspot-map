"use client";

import { useEffect, useState } from "react";

// 県南中央交通圏のおおよその中心（さいたま市付近）
const LAT = 35.86;
const LNG = 139.63;

interface WeatherState {
  /** 現在の天気アイコン＋ラベル */
  nowIcon: string;
  nowLabel: string;
  /** 今日この先に雨／雪が降り始める時刻（"HH:mm"）。なければ null */
  rainFrom: string | null;
  /** 雨・雪フラグ（需要増のサイン） */
  wet: boolean;
}

// WMO weather code → アイコン・ラベル
function decodeWeather(code: number): { icon: string; label: string; wet: boolean } {
  if (code === 0) return { icon: "☀️", label: "快晴", wet: false };
  if ([1, 2, 3].includes(code)) return { icon: "⛅", label: "くもり", wet: false };
  if ([45, 48].includes(code)) return { icon: "🌫️", label: "霧", wet: false };
  if ([51, 53, 55, 56, 57].includes(code))
    return { icon: "🌦️", label: "霧雨", wet: true };
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code))
    return { icon: "🌧️", label: "雨", wet: true };
  if ([71, 73, 75, 77, 85, 86].includes(code))
    return { icon: "🌨️", label: "雪", wet: true };
  if ([95, 96, 99].includes(code))
    return { icon: "⛈️", label: "雷雨", wet: true };
  return { icon: "🌤️", label: "—", wet: false };
}

export default function WeatherBanner() {
  const [weather, setWeather] = useState<WeatherState | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LNG}` +
      `&current=weather_code&hourly=precipitation,weather_code` +
      `&timezone=Asia%2FTokyo&forecast_days=1`;

    fetch(url, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data) => {
        const nowCode: number = data?.current?.weather_code ?? -1;
        const now = decodeWeather(nowCode);

        const times: string[] = data?.hourly?.time ?? [];
        const precip: number[] = data?.hourly?.precipitation ?? [];
        const codes: number[] = data?.hourly?.weather_code ?? [];

        // 現在時刻(JST)以降で最初に「雨/雪 or 降水0.3mm以上」になる時刻を探す
        const nowMs = Date.now();
        let rainFrom: string | null = null;
        for (let i = 0; i < times.length; i++) {
          const t = new Date(times[i] + "+09:00").getTime();
          if (t < nowMs) continue;
          const wetCode = decodeWeather(codes[i] ?? -1).wet;
          if (wetCode || (precip[i] ?? 0) >= 0.3) {
            rainFrom = times[i].slice(11, 16); // "HH:mm"
            break;
          }
        }

        setWeather({
          nowIcon: now.icon,
          nowLabel: now.label,
          rainFrom,
          wet: now.wet || rainFrom !== null,
        });
      })
      .catch(() => {
        /* 取得失敗時は何も表示しない（売上UI本体には影響させない） */
      });

    return () => controller.abort();
  }, []);

  if (!weather) return null;

  // ヘッダーをコンパクトに保つため、チップ（丸いタグ）1個で表示する
  if (weather.wet) {
    const msg = weather.rainFrom
      ? `☔ ${weather.rainFrom}〜雨・需要増`
      : `☔ ${weather.nowLabel}・需要増`;
    return (
      <span className="inline-flex items-center rounded-full bg-sky-100 px-2.5 py-1 text-xs font-bold text-sky-800 ring-1 ring-inset ring-sky-200">
        {msg}
      </span>
    );
  }

  // 晴れ／くもりは控えめなチップ
  return (
    <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-500">
      {weather.nowIcon} {weather.nowLabel}
    </span>
  );
}
