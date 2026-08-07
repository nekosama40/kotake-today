export type Confidence = "high" | "medium" | "low";
export type Availability = "walk_in" | "same_day_ticket" | "registration_open" | "unknown";
export type Reservation = "not_required" | "recommended" | "required" | "unknown";

export interface EventImage {
  url: string | null;
  alt: string;
  attribution: string | null;
  sourceUrl: string | null;
}

export interface EventItem {
  id: string;
  title: string;
  summary: string;
  startAt: string;
  endAt: string | null;
  venueName: string;
  ward: string;
  nearestStation: string;
  kotakeMinutes: number;
  priceLabel: string;
  minPriceYen: number | null;
  isFree: boolean;
  availability: Availability;
  reservation: Reservation;
  sameDayNote: string;
  tags: string[];
  sourceLabel: string;
  sourceUrl: string;
  lastCheckedAt: string;
  image: EventImage;
  confidence: Confidence;
  recommendationScore: number;
}

export interface EventsPayload {
  generatedFor: string;
  coveredDates?: string[];
  generatedAt: string;
  publishedAt: string;
  searchPasses: number;
  sourceCount: number;
  events: EventItem[];
}

export type SortKey = "recommended" | "nearest" | "start" | "price";
