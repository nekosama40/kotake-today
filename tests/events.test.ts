import { describe, expect, it } from "vitest";
import {
  eventMatchesGenre,
  dynamicRecommendationScore,
  formatEventDate,
  formatPublishedAt,
  formatTimeRange,
  isEventOnDate,
  isEventToday,
  isEventVisible,
  selectRecommendations,
  sortEvents,
  timingLabel,
  tokyoDate,
} from "../src/lib/events";
import type { EventItem } from "../src/types";

const base: EventItem = {
  id: "sample",
  title: "サンプル",
  summary: "説明",
  startAt: "2026-08-07T10:00:00+09:00",
  endAt: "2026-08-07T20:00:00+09:00",
  venueName: "会場",
  ward: "豊島区",
  nearestStation: "池袋駅",
  kotakeMinutes: 20,
  priceLabel: "無料",
  minPriceYen: 0,
  isFree: true,
  availability: "walk_in",
  reservation: "not_required",
  sameDayNote: "自由入場",
  tags: ["展示"],
  sourceLabel: "公式",
  sourceUrl: "https://example.com/event",
  lastCheckedAt: "2026-08-07T06:50:00+09:00",
  image: { url: null, alt: "サンプル画像", attribution: null, sourceUrl: null },
  confidence: "high",
  recommendationScore: 80,
};

describe("event helpers", () => {
  it("uses the Tokyo calendar date", () => {
    expect(tokyoDate(new Date("2026-08-06T16:00:00Z"))).toBe("2026-08-07");
    expect(isEventOnDate(base, "2026-08-07")).toBe(true);
  });

  it("hides ended events", () => {
    expect(isEventVisible(base, new Date("2026-08-07T09:00:00Z"))).toBe(true);
    expect(isEventVisible(base, new Date("2026-08-07T12:00:00Z"))).toBe(false);
    expect(isEventToday(base, new Date("2026-08-07T12:00:00Z"))).toBe(true);
    expect(timingLabel(base, new Date("2026-08-07T12:00:00Z"))).toBe("終了");
  });

  it("hides events that would end before arrival from Kotake-mukaihara", () => {
    expect(isEventVisible(base, new Date("2026-08-07T10:39:00Z"))).toBe(true);
    expect(isEventVisible(base, new Date("2026-08-07T10:40:00Z"))).toBe(false);
  });

  it("keeps events with an unknown official end time visible", () => {
    const unknownEnd = { ...base, endAt: null };
    expect(isEventVisible(unknownEnd, new Date("2026-08-07T12:00:00Z"))).toBe(true);
    expect(isEventVisible(unknownEnd, new Date("2026-08-07T12:40:00Z"))).toBe(false);
    expect(formatTimeRange(unknownEnd)).toContain("終了時刻は公式で確認");
  });

  it("treats date-only events as all-day in Tokyo", () => {
    const allDay = { ...base, startAt: "2026-08-07", endAt: "2026-08-11" };
    expect(timingLabel(allDay, new Date("2026-08-06T22:00:00Z"))).toBe("開催中");
    expect(formatTimeRange(allDay)).toBe("終日・開催時間は公式で確認");
  });

  it("shows explicit Tokyo dates and publication times", () => {
    expect(formatEventDate(base)).toBe("8月7日（金）");
    expect(formatPublishedAt("2026-08-06T21:45:00Z")).toBe("2026年8月7日（金） 06:45");
  });

  it("labels the next two dates clearly", () => {
    const tomorrow = { ...base, startAt: "2026-08-08T10:00:00+09:00", endAt: "2026-08-08T20:00:00+09:00" };
    const following = { ...base, startAt: "2026-08-09T10:00:00+09:00", endAt: "2026-08-09T20:00:00+09:00" };
    expect(timingLabel(tomorrow, new Date("2026-08-07T03:00:00Z"))).toBe("明日");
    expect(timingLabel(following, new Date("2026-08-07T03:00:00Z"))).toBe("明後日");
  });

  it("groups detailed tags into broad filter genres", () => {
    expect(eventMatchesGenre({ ...base, tags: ["現代美術", "夜間開館"] }, "culture")).toBe(true);
    expect(eventMatchesGenre({ ...base, tags: ["キャラクター", "コラボカフェ"] }, "culture")).toBe(true);
    expect(eventMatchesGenre({ ...base, tags: ["ボードゲーム"] }, "music-game")).toBe(true);
    expect(eventMatchesGenre({ ...base, tags: ["絵本", "おはなし会"] }, "family")).toBe(true);
    expect(eventMatchesGenre(base, "food")).toBe(false);
  });

  it("sorts by travel time", () => {
    const far = { ...base, id: "far", kotakeMinutes: 50 };
    expect(sortEvents([far, base], "nearest").map((event) => event.id)).toEqual(["sample", "far"]);
  });

  it("keeps recommendations diverse when possible", () => {
    const events = [
      { ...base, id: "a", venueName: "会場A", sourceUrl: "https://a.example/event", recommendationScore: 100 },
      { ...base, id: "b", venueName: "会場B", sourceUrl: "https://b.example/event", recommendationScore: 99 },
      { ...base, id: "c", venueName: "会場C", sourceUrl: "https://c.example/event", recommendationScore: 98 },
      { ...base, id: "d", venueName: "会場D", sourceUrl: "https://d.example/event", tags: ["音楽"], recommendationScore: 70 },
    ];
    expect(selectRecommendations(events, 3).map((event) => event.id)).toEqual(["a", "b", "d"]);
  });

  it("raises an event that still has useful time left after arrival", () => {
    const now = new Date("2026-08-07T08:00:00Z");
    const useful = { ...base, endAt: "2026-08-07T20:00:00+09:00" };
    const nearlyOver = { ...base, endAt: "2026-08-07T18:30:00+09:00" };
    expect(dynamicRecommendationScore(useful, now)).toBeGreaterThan(dynamicRecommendationScore(nearlyOver, now));
  });
});
