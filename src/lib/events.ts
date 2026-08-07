import type { EventItem, SortKey } from "../types";

const primaryTags = [
  "ゲーム",
  "展示",
  "音楽",
  "交流会",
  "体験",
  "フード",
  "地域",
  "テクノロジー",
];

export const genreFilters = [
  { value: "art", label: "展示・アート", keywords: ["展示", "アート", "写真", "美術", "浮世絵", "イラスト", "ファッション", "ポップアップ", "プロジェクション"] },
  { value: "anime-character", label: "アニメ・キャラクター", keywords: ["アニメ", "キャラクター", "マンガ", "コミック", "声優", "アニソン", "VTuber", "推し活", "コラボカフェ"] },
  { value: "music", label: "音楽・ライブ", keywords: ["音楽", "ライブ", "コンサート", "ピアノ", "DJ", "演奏"] },
  { value: "game-tech", label: "ゲーム・IT", keywords: ["ゲーム", "eスポーツ", "esports", "IT", "AI", "テクノロジー", "科学", "鉄道"] },
  { value: "experience", label: "体験・学び", keywords: ["体験", "ワークショップ", "工作", "自由研究", "スタンプラリー", "散策", "歴史", "環境", "庭園", "銭湯"] },
  { value: "local", label: "地域・交流", keywords: ["地域", "祭", "盆踊り", "七夕", "商店街", "交流", "国際", "対話", "コミュニ", "居場所", "平和", "図書館"] },
  { value: "food", label: "フード・買い物", keywords: ["フード", "食", "酒", "ビール", "マルシェ", "グルメ", "物産", "買い物", "ポップアップ"] },
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
  return event.tags.some((tag) => {
    const normalizedTag = tag.toLocaleLowerCase("ja");
    return filter.keywords.some((keyword) => normalizedTag.includes(keyword.toLocaleLowerCase("ja")));
  });
}

export function isEventVisible(event: EventItem, now = new Date()): boolean {
  const today = tokyoDate(now);
  if (event.startAt.slice(0, 10) !== today) return false;
  const estimatedArrival = now.getTime() + event.kotakeMinutes * 60_000;
  return event.endAt === null || new Date(event.endAt).getTime() > estimatedArrival;
}

export function sortEvents(events: EventItem[], sortKey: SortKey): EventItem[] {
  const copy = [...events];
  copy.sort((a, b) => {
    if (sortKey === "nearest") return a.kotakeMinutes - b.kotakeMinutes;
    if (sortKey === "start") return new Date(a.startAt).getTime() - new Date(b.startAt).getTime();
    if (sortKey === "price") {
      const aPrice = a.minPriceYen ?? Number.MAX_SAFE_INTEGER;
      const bPrice = b.minPriceYen ?? Number.MAX_SAFE_INTEGER;
      return aPrice - bPrice || b.recommendationScore - a.recommendationScore;
    }
    return b.recommendationScore - a.recommendationScore || a.kotakeMinutes - b.kotakeMinutes;
  });
  return copy;
}

function primaryTag(event: EventItem): string {
  return primaryTags.find((tag) => event.tags.includes(tag)) ?? event.tags[0] ?? "その他";
}

export function selectRecommendations(events: EventItem[], limit = 5): EventItem[] {
  const ranked = sortEvents(events, "recommended");
  const selected: EventItem[] = [];
  const tagCounts = new Map<string, number>();

  for (const event of ranked) {
    const tag = primaryTag(event);
    if ((tagCounts.get(tag) ?? 0) >= 2) continue;
    selected.push(event);
    tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    if (selected.length === limit) return selected;
  }

  for (const event of ranked) {
    if (!selected.some((item) => item.id === event.id)) selected.push(event);
    if (selected.length === limit) break;
  }
  return selected;
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
  const start = /^\d{4}-\d{2}-\d{2}$/.test(event.startAt)
    ? new Date(`${event.startAt}T00:00:00+09:00`).getTime()
    : new Date(event.startAt).getTime();
  const end = event.endAt === null ? Number.POSITIVE_INFINITY : new Date(event.endAt).getTime();
  const current = now.getTime();
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
