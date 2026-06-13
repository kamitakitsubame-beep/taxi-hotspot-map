export type DemandLevel = "high" | "medium" | "low";

export interface TaxiEvent {
  id: string;
  title: string;
  /** YYYY-MM-DD */
  date: string;
  /** HH:mm （任意） */
  time_start?: string;
  /** HH:mm （任意） */
  time_end?: string;
  venue: string;
  lat: number;
  lng: number;
  category: string;
  demand_level: DemandLevel;
  demand_comment: string;
  source_url?: string;
}

export interface EventsData {
  updated_at: string;
  events: TaxiEvent[];
}
