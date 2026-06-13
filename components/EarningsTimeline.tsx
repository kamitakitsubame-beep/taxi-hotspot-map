"use client";

import type { TaxiEvent } from "@/lib/types";
import {
  DEMAND_COLOR,
  DEMAND_LABEL,
  formatTimeRange,
  googleMapsDirUrl,
} from "@/lib/utils";

interface EarningsTimelineProps {
  /** 今日のイベント（終了時刻順に渡される想定） */
  events: TaxiEvent[];
  onSelect: (id: string) => void;
}

export default function EarningsTimeline({
  events,
  onSelect,
}: EarningsTimelineProps) {
  if (events.length === 0) return null;

  return (
    <div className="shrink-0 border-b border-slate-200 bg-amber-50/60 px-3 py-2">
      <p className="mb-1 px-1 text-xs font-bold text-amber-700">
        ⏱ 今日の稼ぎどき（大→中→小の需要順）
      </p>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {events.map((ev) => {
          const endTime = ev.time_end ?? ev.time_start ?? "時間未定";
          return (
            <div
              key={ev.id}
              className="flex w-44 shrink-0 flex-col rounded-xl border border-slate-200 bg-white p-2.5 shadow-sm"
            >
              <button
                type="button"
                onClick={() => onSelect(ev.id)}
                className="text-left"
              >
                <div className="flex items-center gap-1.5">
                  <span
                    className="rounded px-1 py-0.5 text-[10px] font-bold text-slate-900"
                    style={{ backgroundColor: DEMAND_COLOR[ev.demand_level] }}
                  >
                    {DEMAND_LABEL[ev.demand_level]}
                  </span>
                  <span className="text-base font-bold tabular-nums text-slate-900">
                    {endTime}
                    <span className="ml-0.5 text-[10px] font-normal text-slate-400">
                      終了
                    </span>
                  </span>
                </div>
                <p className="mt-0.5 line-clamp-1 text-sm font-semibold text-slate-800">
                  {ev.title}
                </p>
                <p className="line-clamp-1 text-xs text-slate-500">
                  {ev.venue}
                </p>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  {formatTimeRange(ev)}
                </p>
              </button>
              <a
                href={googleMapsDirUrl(ev.lat, ev.lng)}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1.5 rounded-lg bg-blue-600 px-2 py-1 text-center text-xs font-bold text-white active:bg-blue-700"
              >
                ここへ向かう ▶
              </a>
            </div>
          );
        })}
      </div>
    </div>
  );
}
