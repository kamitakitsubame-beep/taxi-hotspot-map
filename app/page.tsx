import fs from "node:fs";
import path from "node:path";
import HotspotApp from "@/components/HotspotApp";
import type { EventsData } from "@/lib/types";

// データ（events.json）が更新されたら再生成されるよう、ビルド時に読み込む。
// Vercelは main への push で再デプロイされるため常に最新になる。
function loadEvents(): EventsData {
  const file = path.join(process.cwd(), "data", "events.json");
  try {
    const raw = fs.readFileSync(file, "utf-8");
    const parsed = JSON.parse(raw) as EventsData;
    if (!Array.isArray(parsed.events)) {
      return { updated_at: parsed.updated_at ?? "", events: [] };
    }
    return parsed;
  } catch {
    return { updated_at: "", events: [] };
  }
}

export default function Page() {
  const data = loadEvents();
  return <HotspotApp data={data} />;
}
