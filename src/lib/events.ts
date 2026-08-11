import type { EventItem, SortKey } from "../types";

export const genreFilters = [
  { value: "culture", label: "展示・カルチャー", keywords: ["展示", "アート", "写真", "美術", "浮世絵", "イラスト", "ファッション", "ポップアップ", "アニメ", "キャラクター", "マンガ", "コミック", "声優", "VTuber", "コラボカフェ"] },
  { value: "music-game", label: "音楽・ゲーム", keywords: ["音楽", "ライブ", "コンサート", "ピアノ", "DJ", "演奏", "ゲーム", "eスポーツ", "esports", "IT", "AI", "テクノロジー", "科学", "鉄道"] },
  { value: "experience-local", label: "体験・交流", keywords: ["体験", "ワークショップ", "工作", "自由研究", "スタンプラリー", "散策", "歴史", "環境", "庭園", "銭湯", "地域", "祭", "盆踊り", "商店街", "交流", "国際", "コミュニ", "図書館"] },
  { value: "food", label: "フード・買い物", keywords: ["フード", "食", "酒", "ビール", "マルシェ", "グルメ", "物産", "買い物"] },
  { value: "family", label: "子ども・家族", keywords: ["子ども", "こども", "親子", "絵本", "おはなし", "昆虫", "動物", "自由研究", "工作"] },
] as const;

export type GenreFilterValue = "all" | (typeof genreFilters)[number]["value"];

function tokyoDateParts(value: Date): Record<string, string> {
  return Object.fromEntries(new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).formatToParts(value).map((part) => [part.type, part.value]));
}

function eventStartDate(event: EventItem): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(event.startAt)
    ? new Date(`${event.startAt}T00:00:00+09:00`)
    : new Date(event.startAt);
}

export function tokyoDate(date = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function formatEventDate(event: EventItem): string {
  const parts = tokyoDateParts(eventStartDate(event));
  return `${parts.month}月${parts.day}日（${parts.weekday}）`;
}

export function formatPublishedAt(value: string): string {
  const date = new Date(value);
  const parts = tokyoDateParts(date);
  const time = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  return `${parts.year}年${parts.month}月${parts.day}日（${parts.weekday}） ${time}`;
}

export function eventMatchesGenre(event: EventItem, genre: GenreFilterValue): boolean {
  if (genre === "all") return true;
  const filter = genreFilters.find((item) => item.value === genre);
  if (!filter) return false;
  const text = [event.title, event.summary, ...event.tags].join(" ").toLocaleLowerCase("ja");
  return filter.keywords.some((keyword) => text.includes(keyword.toLocaleLowerCase("ja")));
}

export function eventBroadGenre(event: EventItem): GenreFilterValue {
  return genreFilters.find((genre) => eventMatchesGenre(event, genre.value))?.value ?? "all";
}

export function isEventToday(event: EventItem, now = new Date()): boolean {
  return isEventOnDate(event, tokyoDate(now));
}

export function isEventOnDate(event: EventItem, date: string): boolean {
  return event.startAt.slice(0, 10) === date;
}

export function isEventVisible(event: EventItem, now = new Date()): boolean {
  if (!isEventToday(event, now)) return false;
  const estimatedArrival = now.getTime() + event.kotakeMinutes * 60_000;
  if (event.endAt !== null) return new Date(event.endAt).getTime() > estimatedArrival;
  const day = event.startAt.slice(0, 10);
  const conservativeCutoff = new Date(`${day}T22:00:00+09:00`).getTime();
  return estimatedArrival < conservativeCutoff;
}

export function dynamicRecommendationScore(event: EventItem, now = new Date()): number {
  const baseScore = event.recommendationScore;
  const eventDay = event.startAt.slice(0, 10);
  const currentDay = tokyoDate(now);
  if (eventDay !== currentDay) return baseScore + 15;
  if (/^\d{4}-\d{2}-\d{2}$/.test(event.startAt)) return baseScore + 18;

  const arrival = now.getTime() + event.kotakeMinutes * 60_000;
  const start = new Date(event.startAt).getTime();
  const end = event.endAt === null ? null : new Date(event.endAt).getTime();
  if (end !== null && end <= arrival) return -1;
  if (start <= arrival) {
    if (end === null) return baseScore + 12;
    const remaining = (end - arrival) / 60_000;
    if (remaining >= 120) return baseScore + 25;
    if (remaining >= 60) return baseScore + 22;
    if (remaining >= 30) return baseScore + 14;
    return baseScore + 6;
  }
  const wait = (start - arrival) / 60_000;
  if (wait <= 30) return baseScore + 25;
  if (wait <= 90) return baseScore + 22;
  if (wait <= 180) return baseScore + 18;
  return baseScore + 12;
}

export function sortEvents(events: EventItem[], sortKey: SortKey, now = new Date()): EventItem[] {
  const copy = [...events];
  copy.sort((a, b) => {
    if (sortKey === "nearest") return a.kotakeMinutes - b.kotakeMinutes;
    if (sortKey === "start") return new Date(a.startAt).getTime() - new Date(b.startAt).getTime();
    if (sortKey === "price") {
      const aPrice = a.minPriceYen ?? Number.MAX_SAFE_INTEGER;
      const bPrice = b.minPriceYen ?? Number.MAX_SAFE_INTEGER;
      return aPrice - bPrice || dynamicRecommendationScore(b, now) - dynamicRecommendationScore(a, now);
    }
    return dynamicRecommendationScore(b, now) - dynamicRecommendationScore(a, now)
      || a.kotakeMinutes - b.kotakeMinutes
      || new Date(a.startAt).getTime() - new Date(b.startAt).getTime();
  });
  return copy;
}

function sourceDomain(event: EventItem): string {
  try { return new URL(event.sourceUrl).hostname.replace(/^www\./, ""); } catch { return event.sourceUrl; }
}

export function selectRecommendations(events: EventItem[], limit = 5, now = new Date()): EventItem[] {
  const ranked = sortEvents(events, "recommended", now);
  const selected: EventItem[] = [];
  const genreCounts = new Map<GenreFilterValue, number>();
  const venueCounts = new Map<string, number>();
  const domainCounts = new Map<string, number>();

  for (const event of ranked) {
    const genre = eventBroadGenre(event);
    const venue = event.venueName.normalize("NFKC").toLocaleLowerCase("ja");
    const domain = sourceDomain(event);
    if ((genreCounts.get(genre) ?? 0) >= 2) continue;
    if ((venueCounts.get(venue) ?? 0) >= 1) continue;
    if ((domainCounts.get(domain) ?? 0) >= 2) continue;
    selected.push(event);
    genreCounts.set(genre, (genreCounts.get(genre) ?? 0) + 1);
    venueCounts.set(venue, (venueCounts.get(venue) ?? 0) + 1);
    domainCounts.set(domain, (domainCounts.get(domain) ?? 0) + 1);
    if (selected.length === limit) return selected;
  }

  for (const event of ranked) {
    if (!selected.some((item) => item.id === event.id)) selected.push(event);
    if (selected.length === limit) break;
  }
  return selected;
}

export function recommendationReasons(event: EventItem, now = new Date()): string[] {
  const reasons: string[] = [];
  const timing = timingLabel(event, now);
  if (timing === "開催中") reasons.push("開催中");
  else if (timing.startsWith("あと約")) reasons.push("まもなく");
  if (event.kotakeMinutes <= 30) reasons.push("近い");
  if (event.reservation === "not_required") reasons.push("予約不要");
  else if (event.availability === "same_day_ticket") reasons.push("当日券");
  if (event.isFree) reasons.push("無料");
  return reasons.slice(0, 3);
}

export function formatTimeRange(event: EventItem): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(event.startAt)) return "終日・開催時間は公式で確認";
  const formatter = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
  });
  const start = formatter.format(new Date(event.startAt));
  return event.endAt === null ? `${start}〜終了時刻は公式で確認` : `${start}–${formatter.format(new Date(event.endAt))}`;
}

export function timingLabel(event: EventItem, now = new Date()): string {
  const eventDay = event.startAt.slice(0, 10);
  const currentDay = tokyoDate(now);
  if (eventDay > currentDay) {
    const eventDate = new Date(`${eventDay}T00:00:00Z`).getTime();
    const currentDate = new Date(`${currentDay}T00:00:00Z`).getTime();
    const dayDifference = Math.round((eventDate - currentDate) / 86_400_000);
    if (dayDifference === 1) return "明日";
    if (dayDifference === 2) return "明後日";
    return "予定";
  }
  const start = /^\d{4}-\d{2}-\d{2}$/.test(event.startAt)
    ? new Date(`${event.startAt}T00:00:00+09:00`).getTime()
    : new Date(event.startAt).getTime();
  const end = event.endAt === null ? Number.POSITIVE_INFINITY : new Date(event.endAt).getTime();
  const current = now.getTime();
  if (current >= end) return "終了";
  if (event.endAt === null && current >= start) return "時間は公式確認";
  if (current >= start && current < end) return "開催中";
  const minutes = Math.max(0, Math.round((start - current) / 60_000));
  if (minutes < 60) return `あと約${minutes}分`;
  return "これから";
}

export function availabilityLabel(event: EventItem): string {
  if (event.availability === "walk_in") return "予約なしで参加しやすい";
  if (event.availability === "same_day_ticket") return "当日券あり";
  if (event.availability === "registration_open") return "当日申込を確認";
  return "参加条件を公式で確認";
}
