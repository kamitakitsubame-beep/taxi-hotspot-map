"use client";

import type { TaxiEvent } from "@/lib/types";
import {
  DEMAND_COLOR,
  DEMAND_LABEL,
  formatDateLabel,
  formatDistance,
  formatTimeRange,
  googleMapsDirUrl,
  haversineKm,
  isPast,
  jstDateString,
  type LatLng,
} from "@/lib/utils";

interface EventListProps {
  events: TaxiEvent[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** 現在地（取得済みなら各イベントまでの距離を表示） */
  userLoc?: LatLng | null;
}

export default function EventList({
  events,
  selectedId,
  onSelect,
  userLoc,
}: EventListProps) {
  const today = jstDateString();

  if (events.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-slate-500">
        直近7日間の登録イベントはありません。
      </div>
    );
  }

  return (
    <ul className="divide-y divide-slate-200">
      {events.map((ev) => {
        const past = isPast(ev, today);
        const isToday = ev.date === today;
        const selected = ev.id === selectedId;
        const distKm = userLoc
          ? haversineKm(userLoc, { lat: ev.lat, lng: ev.lng })
          : null;
        return (
          <li
            key={ev.id}
            className={`flex items-stretch ${selected ? "bg-sky-50" : ""} ${
              past ? "opacity-50" : ""
            }`}
          >
            <button
              type="button"
              onClick={() => onSelect(ev.id)}
              className="flex min-w-0 flex-1 items-start gap-3 px-4 py-3 text-left transition active:bg-slate-100"
            >
              <span
                aria-hidden
                className="mt-1 inline-block h-3 w-3 shrink-0 rounded-full"
                style={{ backgroundColor: DEMAND_COLOR[ev.demand_level] }}
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="text-[15px] font-bold text-slate-900">
                    {ev.title}
                  </span>
                  {isToday && (
                    <span className="shrink-0 rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-bold text-red-700">
                      本日
                    </span>
                  )}
                  {distKm !== null && (
                    <span className="shrink-0 rounded bg-blue-100 px-1.5 py-0.5 text-[11px] font-bold text-blue-700">
                      {formatDistance(distKm)}
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-sm text-slate-600">
                  {formatDateLabel(ev.date)} {formatTimeRange(ev)}
                </span>
                <span className="block truncate text-sm text-slate-500">
                  📍 {ev.venue}
                </span>
                <span className="mt-1 block text-[13px] text-amber-700">
                  💡 {ev.demand_comment}
                </span>
              </span>
              <span
                className="mt-1 shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold text-slate-900"
                style={{ backgroundColor: DEMAND_COLOR[ev.demand_level] }}
              >
                {DEMAND_LABEL[ev.demand_level]}
              </span>
            </button>
            <a
              href={googleMapsDirUrl(ev.lat, ev.lng)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${ev.title}へのナビを開く`}
              className="flex w-14 shrink-0 flex-col items-center justify-center gap-0.5 border-l border-slate-200 bg-blue-600 text-white active:bg-blue-700"
            >
              <span className="text-lg leading-none">▶</span>
              <span className="text-[10px] font-bold leading-none">向かう</span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}
