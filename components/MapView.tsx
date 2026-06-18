"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import type { TaxiEvent } from "@/lib/types";
import type { HelpMarker } from "@/lib/help";
import {
  DEMAND_LABEL,
  formatDateLabel,
  formatTimeRange,
  googleMapsDirUrl,
  isPast,
  type LatLng,
} from "@/lib/utils";

// 県南中央交通圏（さいたま市・川口・蕨・戸田周辺）のおおよその中心
const DEFAULT_CENTER: [number, number] = [35.86, 139.63];
const DEFAULT_ZOOM = 11;

interface TrainRoute {
  /** 区間を構成する座標列 [lat, lng] */
  coords: [number, number][];
  level: "suspended" | "delay";
  line: string;
  /** 遅延の理由など（タップ時に表示） */
  detail?: string;
}

interface MapViewProps {
  events: TaxiEvent[];
  /** 一覧から選択されたイベントID（ピンを開く） */
  selectedId: string | null;
  /** 取得済みなら現在地マーカーを表示 */
  userLoc?: LatLng | null;
  /** 乗務員のヘルプマーク */
  helpMarkers?: HelpMarker[];
  /** 地図タップ登録モード */
  placeMode?: boolean;
  /** 地図タップ時（placeMode中のみ呼ばれる） */
  onMapClick?: (lat: number, lng: number) => void;
  /** 遅延・運転見合わせ中の路線を線でなぞる */
  trainRoutes?: TrainRoute[];
}

function helpIcon(ageMin: number): L.DivIcon {
  const op = ageMin >= 90 ? 0.45 : ageMin >= 60 ? 0.65 : ageMin >= 30 ? 0.82 : 1;
  return L.divIcon({
    className: "",
    html: `<span class="help-marker" style="opacity:${op}">🙋</span>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    popupAnchor: [0, -16],
  });
}

function markerHtml(level: TaxiEvent["demand_level"]): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<span class="demand-marker ${level}"></span>`,
    iconSize: [24, 24],
    iconAnchor: [12, 24],
    popupAnchor: [0, -24],
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function popupHtml(ev: TaxiEvent): string {
  const sourceLink = ev.source_url
    ? `<div style="margin-top:8px"><a href="${escapeHtml(
        ev.source_url
      )}" target="_blank" rel="noopener" style="color:#2563eb">詳細リンク ↗</a></div>`
    : "";
  return `
    <div style="min-width:200px">
      <div style="font-weight:700;font-size:15px;margin-bottom:4px;color:#0f172a">${escapeHtml(
        ev.title
      )}</div>
      <div style="color:#475569">📅 ${formatDateLabel(
        ev.date
      )} ${formatTimeRange(ev)}</div>
      <div style="color:#475569">📍 ${escapeHtml(ev.venue)}</div>
      <div style="margin-top:6px;padding:6px 8px;background:rgba(148,163,184,0.18);border-radius:8px;color:#334155">
        💡 ${escapeHtml(ev.demand_comment)}
      </div>
      <div style="margin-top:6px;font-size:12px;color:#64748b">需要レベル：${
        DEMAND_LABEL[ev.demand_level]
      }${ev.category ? `／${escapeHtml(ev.category)}` : ""}</div>
      <a href="${googleMapsDirUrl(ev.lat, ev.lng)}" target="_blank"
         rel="noopener noreferrer"
         style="display:block;margin-top:8px;padding:7px 10px;background:#2563eb;color:#fff;border-radius:8px;font-weight:700;text-align:center;text-decoration:none">ここへ向かう ▶</a>
      ${sourceLink}
    </div>`;
}

export default function MapView({
  events,
  selectedId,
  userLoc,
  helpMarkers,
  placeMode,
  onMapClick,
  trainRoutes,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const userMarkerRef = useRef<L.CircleMarker | null>(null);
  const helpLayerRef = useRef<L.LayerGroup | null>(null);
  const trainLayerRef = useRef<L.LayerGroup | null>(null);
  const placeModeRef = useRef<boolean>(false);
  const onMapClickRef = useRef<MapViewProps["onMapClick"]>(undefined);

  // 最新の placeMode / onMapClick を ref に反映（イベントは一度だけ束縛するため）
  placeModeRef.current = !!placeMode;
  onMapClickRef.current = onMapClick;

  // 地図の初期化（マウント時に一度だけ）
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      zoomControl: false, // モバイルはピンチ操作。画面をすっきりさせる
    });

    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
      {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
        maxZoom: 19,
      }
    ).addTo(map);

    helpLayerRef.current = L.layerGroup().addTo(map);
    trainLayerRef.current = L.layerGroup().addTo(map);

    // 地図タップ登録モード中のクリックで位置を通知
    map.on("click", (e: L.LeafletMouseEvent) => {
      if (placeModeRef.current && onMapClickRef.current) {
        onMapClickRef.current(e.latlng.lat, e.latlng.lng);
      }
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      markersRef.current.clear();
      helpLayerRef.current = null;
      trainLayerRef.current = null;
    };
  }, []);

  // 遅延・運転見合わせ路線を線でなぞる（遅延=黄／見合わせ=赤）
  useEffect(() => {
    const layer = trainLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    (trainRoutes ?? []).forEach((rt) => {
      const color = rt.level === "suspended" ? "#dc2626" : "#f59e0b";
      const label = rt.level === "suspended" ? "運転見合わせ" : "遅延";
      // 視認性のための白いケーシング（点滅しない）
      L.polyline(rt.coords, {
        color: "#ffffff",
        weight: 9,
        opacity: 0.9,
        lineCap: "round",
        lineJoin: "round",
      }).addTo(layer);
      const detailHtml = rt.detail
        ? `<div style="margin-top:4px;color:#475569;font-size:13px">${escapeHtml(
            rt.detail
          )}</div>`
        : "";
      // 色付きの線（ゆっくり点滅・タップで詳細）
      L.polyline(rt.coords, {
        color,
        weight: 5,
        opacity: 1,
        lineCap: "round",
        lineJoin: "round",
        className: `train-line ${rt.level}`,
      })
        .bindPopup(
          `<div style="min-width:190px">
            <div style="font-weight:700;font-size:15px;color:${color}">🚆 ${escapeHtml(
            rt.line
          )}</div>
            <div style="font-weight:700;margin-top:2px">【${label}】</div>
            ${detailHtml}
            <div style="margin-top:6px;font-size:12px;color:#64748b">該当路線の駅周辺で需要増の可能性。タクシー待機の狙い目です。</div>
          </div>`
        )
        .addTo(layer);
    });
  }, [trainRoutes]);

  // ヘルプマークの描画
  useEffect(() => {
    const layer = helpLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    (helpMarkers ?? []).forEach((h) => {
      const label =
        h.ageMin <= 0 ? "たった今" : `${h.ageMin}分前`;
      L.marker([h.lat, h.lng], { icon: helpIcon(h.ageMin) })
        .bindPopup(`🙋 客多い（${label}の要請）`)
        .addTo(layer);
    });
  }, [helpMarkers]);

  // 登録モードのカーソル切替
  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    c.classList.toggle("place-mode", !!placeMode);
  }, [placeMode]);

  // マーカーの描画（events変更時）
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    markersRef.current.forEach((m) => m.remove());
    markersRef.current.clear();

    const bounds: [number, number][] = [];

    events.forEach((ev) => {
      if (typeof ev.lat !== "number" || typeof ev.lng !== "number") return;
      const marker = L.marker([ev.lat, ev.lng], {
        icon: markerHtml(ev.demand_level),
        opacity: isPast(ev) ? 0.45 : 1,
      })
        .addTo(map)
        .bindPopup(popupHtml(ev));
      markersRef.current.set(ev.id, marker);
      bounds.push([ev.lat, ev.lng]);
    });

    if (bounds.length > 0) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
    }
  }, [events]);

  // 現在地マーカー（青い丸）の表示・更新
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!userLoc) {
      userMarkerRef.current?.remove();
      userMarkerRef.current = null;
      return;
    }
    const latlng: [number, number] = [userLoc.lat, userLoc.lng];
    if (userMarkerRef.current) {
      userMarkerRef.current.setLatLng(latlng);
    } else {
      userMarkerRef.current = L.circleMarker(latlng, {
        radius: 8,
        color: "#ffffff",
        weight: 2,
        fillColor: "#2563eb",
        fillOpacity: 1,
      })
        .addTo(map)
        .bindPopup("現在地");
    }
  }, [userLoc]);

  // 一覧から選択されたピンを開いて中心に移動
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedId) return;
    const marker = markersRef.current.get(selectedId);
    if (!marker) return;
    map.flyTo(marker.getLatLng(), Math.max(map.getZoom(), 14), {
      duration: 0.6,
    });
    marker.openPopup();
  }, [selectedId]);

  return <div ref={containerRef} className="h-full w-full" />;
}
