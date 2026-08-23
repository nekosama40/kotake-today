import { useEffect, useMemo, useRef, useState } from "react";
import {
  availabilityLabel,
  eventMatchesGenre,
  formatEventDate,
  formatPublishedAt,
  formatTimeRange,
  genreFilters,
  isEventOnDate,
  isEventVisible,
  recommendationReasons,
  selectRecommendations,
  sortEvents,
  timingLabel,
  tokyoDate,
} from "./lib/events";
import type { EventItem, EventsPayload, SortKey } from "./types";
import type { GenreFilterValue } from "./lib/events";

const sortOptions: Array<{ value: SortKey; label: string }> = [
  { value: "recommended", label: "おすすめ順" },
  { value: "nearest", label: "小竹向原から近い順" },
  { value: "start", label: "開始時間順" },
  { value: "price", label: "料金が安い順" },
];

const tagEmoji: Record<string, string> = {
  ゲーム: "🎮",
  アニメ: "✧",
  キャラクター: "★",
  展示: "◫",
  音楽: "♫",
  交流会: "◎",
  体験: "✦",
  フード: "♨",
  地域: "祭",
  テクノロジー: "⌘",
};

function fallbackGlyph(event: EventItem): string {
  return event.tags.map((tag) => tagEmoji[tag]).find(Boolean) ?? "東";
}

function assetUrl(value: string): string {
  if (/^https:\/\//i.test(value)) return value;
  return `${import.meta.env.BASE_URL}${value.replace(/^\/+/, "")}`;
}

function dateDifference(date: string, baseDate: string): number {
  return Math.round((new Date(`${date}T00:00:00Z`).getTime() - new Date(`${baseDate}T00:00:00Z`).getTime()) / 86_400_000);
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function normalizeCoveredDates(dates: string[] | undefined, generatedFor: string): string[] {
  const source = dates?.length ? dates : [generatedFor];
  return [...new Set(source.filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)))].sort();
}

export function selectionAfterTokyoDateChange(
  selectedDate: string,
  previousTokyoDate: string,
  currentTokyoDate: string,
  followingToday: boolean,
): string {
  return followingToday && previousTokyoDate !== currentTokyoDate ? currentTokyoDate : selectedDate;
}

function relativeDateLabel(date: string, today: string): string {
  const difference = dateDifference(date, today);
  if (difference === 0) return "今日";
  if (difference === 1) return "明日";
  if (difference === 2) return "明後日";
  return "予定";
}

function compactDateLabel(date: string): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).formatToParts(new Date(`${date}T00:00:00+09:00`)).map((part) => [part.type, part.value]));
  return `${parts.month}/${parts.day}（${parts.weekday}）`;
}

function coverageRangeLabel(dates: string[]): string {
  if (dates.length === 0) return "準備中";
  const first = dates[0];
  const last = dates[dates.length - 1];
  const firstYear = first.slice(0, 4);
  const lastYear = last.slice(0, 4);
  const short = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
  return firstYear === lastYear
    ? `${short(first)}〜${short(last)}`
    : `${firstYear}/${short(first)}〜${lastYear}/${short(last)}`;
}

function EventVisual({ event, featured = false }: { event: EventItem; featured?: boolean }) {
  const [failed, setFailed] = useState(false);
  if (!event.image.url || failed) {
    return (
      <div className={`event-visual fallback ${featured ? "featured" : ""}`} aria-label={event.image.alt}>
        <span>{fallbackGlyph(event)}</span>
        <small>{event.tags[0] ?? "今日の東京"}</small>
      </div>
    );
  }
  return (
    <div className={`event-visual ${featured ? "featured" : ""}`}>
      <img
        src={assetUrl(event.image.url)}
        alt={event.image.alt}
        loading={featured ? "eager" : "lazy"}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
      {event.image.attribution && <small className="image-credit">画像：{event.image.attribution}</small>}
    </div>
  );
}

function EventCard({ event, featured = false }: { event: EventItem; featured?: boolean }) {
  const now = new Date();
  const timing = timingLabel(event, now);
  const [shared, setShared] = useState(false);

  const shareEvent = async () => {
    const shareUrl = new URL(window.location.href);
    shareUrl.search = "";
    shareUrl.searchParams.set("date", event.startAt.slice(0, 10));
    shareUrl.searchParams.set("event", event.id);
    const shareData = { title: event.title, text: `${formatEventDate(event)} ${formatTimeRange(event)}｜${event.venueName}`, url: shareUrl.href };
    try {
      if (navigator.share) await navigator.share(shareData);
      else await navigator.clipboard.writeText(shareUrl.href);
      setShared(true);
      window.setTimeout(() => setShared(false), 1800);
    } catch (error) {
      if ((error as DOMException).name !== "AbortError") setShared(false);
    }
  };

  return (
    <article id={event.id} className={`event-card ${featured ? "featured-card" : ""}`}>
      <a
        className="event-card-link"
        href={event.sourceUrl}
        target="_blank"
        rel="noreferrer"
      >
        <EventVisual event={event} featured={featured} />
        <div className="event-card-body">
          <span className={`timing-pill ${timing === "終了" ? "ended" : ""}`}>{timing}</span>
          <dl className="event-schedule">
            <div><dt>開催日</dt><dd>{formatEventDate(event)}</dd></div>
            <div><dt>時間</dt><dd>{formatTimeRange(event)}</dd></div>
          </dl>
          <h3>{event.title}</h3>
          <p className="summary">{event.summary}</p>
          <div className="location-line">
            <strong>{event.venueName}</strong>
            <span>{event.ward}・{event.nearestStation}</span>
          </div>
          <div className="facts">
            <span className="travel">小竹向原から約{event.kotakeMinutes}分</span>
            <span>{event.priceLabel}</span>
          </div>
          <p className="availability">{availabilityLabel(event)}　{event.sameDayNote}</p>
          <div className="tag-row">
            {event.tags.map((tag) => <span key={tag}>#{tag}</span>)}
          </div>
          <span className="official-link-note" aria-hidden="true">公式・告知ページへ ↗</span>
        </div>
      </a>
      <button type="button" className="share-button" onClick={shareEvent} aria-label={`${event.title}を共有`}>
        {shared ? "コピー済み" : "共有"}
      </button>
    </article>
  );
}

function RecommendationCard({ event, now }: { event: EventItem; now: Date }) {
  const reasons = recommendationReasons(event, now);
  return (
    <a className="recommendation-card" href={event.sourceUrl} target="_blank" rel="noreferrer">
      <EventVisual event={event} />
      <div>
        <p>{formatEventDate(event)}　{formatTimeRange(event)}</p>
        <h3>{event.title}</h3>
        <div className="recommendation-reasons">
          {reasons.map((reason) => <span key={reason}>{reason}</span>)}
        </div>
      </div>
    </a>
  );
}

function App() {
  const [payload, setPayload] = useState<EventsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("recommended");
  const [search, setSearch] = useState("");
  const [selectedGenre, setSelectedGenre] = useState<GenreFilterValue>("all");
  const [freeOnly, setFreeOnly] = useState(false);
  const [walkInOnly, setWalkInOnly] = useState(false);
  const [showEnded, setShowEnded] = useState(false);
  const initialTokyoDate = useRef(tokyoDate()).current;
  const initialRequestedDate = useRef(new URLSearchParams(window.location.search).get("date")).current;
  const [selectedDate, setSelectedDate] = useState(() => {
    return initialRequestedDate && /^\d{4}-\d{2}-\d{2}$/.test(initialRequestedDate) ? initialRequestedDate : initialTokyoDate;
  });
  const [followingToday, setFollowingToday] = useState(
    () => !initialRequestedDate || initialRequestedDate === initialTokyoDate,
  );
  const [clock, setClock] = useState(new Date());
  const [visibleCount, setVisibleCount] = useState(12);
  const previousTokyoDate = useRef(initialTokyoDate);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!payload) return;
    const eventId = new URLSearchParams(window.location.search).get("event");
    if (!eventId) return;
    const linkedEvent = payload.events.find((event) => event.id === eventId);
    if (linkedEvent) {
      const linkedDate = linkedEvent.startAt.slice(0, 10);
      setSelectedDate(linkedDate);
      const currentDate = tokyoDate();
      setFollowingToday(linkedDate === currentDate);
      if (linkedDate === currentDate && !isEventVisible(linkedEvent, new Date())) setShowEnded(true);
    }
  }, [payload]);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/events.json?ts=${Date.now()}`, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`イベントデータを読み込めませんでした (${response.status})`);
        return response.json();
      })
      .then((data: EventsPayload) => setPayload(data))
      .catch((reason: Error) => setError(reason.message));
  }, []);

  const currentTokyoDate = tokyoDate(clock);
  const coveredDates = useMemo(() => {
    if (!payload) return [];
    return normalizeCoveredDates(payload.coveredDates, payload.generatedFor);
  }, [payload]);
  const selectedIsToday = selectedDate === currentTokyoDate;
  const selectedDateIsCovered = coveredDates.includes(selectedDate);
  const coverageEnded = coveredDates.length > 0 && coveredDates[coveredDates.length - 1] < currentTokyoDate;
  const quickDates = useMemo(() => [
    { date: currentTokyoDate, label: "今日" },
    { date: addDays(currentTokyoDate, 1), label: "明日" },
    { date: addDays(currentTokyoDate, 2), label: "明後日" },
  ], [currentTokyoDate]);
  const quickDateValues = useMemo(() => new Set(quickDates.map(({ date }) => date)), [quickDates]);
  const selectedIsQuickDate = quickDateValues.has(selectedDate);

  const selectDate = (date: string) => {
    setSelectedDate(date);
    setFollowingToday(date === currentTokyoDate);
  };

  useEffect(() => {
    const previousDate = previousTokyoDate.current;
    if (previousDate === currentTokyoDate) return;
    previousTokyoDate.current = currentTokyoDate;
    setSelectedDate((date) => selectionAfterTokyoDateChange(
      date,
      previousDate,
      currentTokyoDate,
      followingToday,
    ));
  }, [currentTokyoDate, followingToday]);

  useEffect(() => {
    if (coveredDates.length === 0 || coveredDates.includes(selectedDate)) return;
    setSelectedDate(coveredDates.includes(currentTokyoDate) ? currentTokyoDate : coveredDates[coveredDates.length - 1]);
  }, [coveredDates, currentTokyoDate, selectedDate]);

  const selectedDateEvents = useMemo(() => {
    if (!payload) return [];
    return payload.events.filter((event) => isEventOnDate(event, selectedDate));
  }, [payload, selectedDate]);

  const visibleEvents = useMemo(() => {
    if (!selectedIsToday || showEnded) return selectedDateEvents;
    return selectedDateEvents.filter((event) => isEventVisible(event, clock));
  }, [selectedDateEvents, selectedIsToday, showEnded, clock]);

  const availableGenres = useMemo(() => {
    return genreFilters.filter((genre) => visibleEvents.some((event) => eventMatchesGenre(event, genre.value)));
  }, [visibleEvents]);

  useEffect(() => {
    if (selectedGenre !== "all" && !availableGenres.some((genre) => genre.value === selectedGenre)) {
      setSelectedGenre("all");
    }
  }, [availableGenres, selectedGenre]);

  const filteredEvents = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("ja");
    const filtered = visibleEvents.filter((event) => {
      if (!eventMatchesGenre(event, selectedGenre)) return false;
      if (freeOnly && !event.isFree) return false;
      if (walkInOnly && event.reservation !== "not_required") return false;
      if (!needle) return true;
      return [event.title, event.summary, event.venueName, event.ward, event.nearestStation, event.priceLabel, event.sameDayNote, event.sourceLabel, ...event.tags]
        .join(" ")
        .toLocaleLowerCase("ja")
        .includes(needle);
    });
    return sortEvents(filtered, sortKey, clock);
  }, [visibleEvents, search, selectedGenre, freeOnly, walkInOnly, sortKey, clock]);

  const recommendations = useMemo(() => {
    const pool = selectedIsToday
      ? selectedDateEvents.filter((event) => isEventVisible(event, clock))
      : selectedDateEvents;
    return selectRecommendations(pool, 5, clock);
  }, [selectedDateEvents, selectedIsToday, clock]);

  useEffect(() => {
    setVisibleCount(12);
  }, [selectedDate, search, selectedGenre, freeOnly, walkInOnly, showEnded, sortKey]);

  const displayedEvents = filteredEvents.slice(0, visibleCount);

  useEffect(() => {
    const eventId = new URLSearchParams(window.location.search).get("event");
    if (!eventId) return;
    const eventIndex = filteredEvents.findIndex((event) => event.id === eventId);
    if (eventIndex < 0) return;
    setVisibleCount((count) => Math.max(count, eventIndex + 1));
    const timer = window.setTimeout(() => document.getElementById(eventId)?.scrollIntoView({ block: "center" }), 160);
    return () => window.clearTimeout(timer);
  }, [filteredEvents]);

  const formattedDate = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(clock);
  const selectedRelativeLabel = relativeDateLabel(selectedDate, currentTokyoDate);
  const sectionTitle = selectedIsToday
    ? (showEnded ? "今日のイベント" : "これから行けるイベント")
    : `${selectedRelativeLabel === "予定" ? compactDateLabel(selectedDate) : selectedRelativeLabel}のイベント`;

  if (error) return <main className="state-page"><p>{error}</p></main>;
  if (!payload) return <main className="state-page"><div className="loader" /><p>今日の東京を探しています</p></main>;

  return (
    <>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="こたけから、きょう。トップ">
          <span className="brand-dot" />
          こたけから、きょう。
        </a>
        <div className="header-note">掲載期間 {coverageRangeLabel(coveredDates)}</div>
      </header>

      <main id="top">
        <section className="hero">
          <div>
            <p className="eyebrow">{formattedDate}　東京23区</p>
            <h1>こたけから、<em>きょう。</em></h1>
          </div>
          <div className="update-stamp">
            <time dateTime={payload.publishedAt}><small>最終更新</small><strong>{formatPublishedAt(payload.publishedAt)}</strong></time>
          </div>
        </section>

        {coverageEnded && (
          <div className="notice">
            掲載期間が終了しました。次回の更新待ちです。下の日付から掲載済みのイベントを確認できます。
          </div>
        )}

        <section className="all-events section-shell">
          <div className="section-heading">
            <div><span className="section-number">01</span><h2>{sectionTitle}</h2></div>
            <p>{selectedIsToday ? "終了分は「終了」で確認できます。" : "参加条件と空き状況は調査時点の情報です。"}</p>
          </div>

          <div className="date-navigation">
            <nav className="date-tabs" aria-label="今日から3日間">
              {quickDates.map(({ date, label }) => {
                const isCovered = coveredDates.includes(date);
                return (
                  <button
                    key={date}
                    type="button"
                    className={selectedDate === date ? "active" : ""}
                    aria-pressed={selectedDate === date}
                    disabled={!isCovered}
                    title={isCovered ? undefined : "掲載期間外です"}
                    onClick={() => selectDate(date)}
                  >
                    <span>{label}</span>
                    <strong>{compactDateLabel(date)}</strong>
                  </button>
                );
              })}
            </nav>
            <label className="other-date-select">
              <span>ほかの日を見る</span>
              <select
                aria-label="ほかの日を見る"
                value={!selectedIsQuickDate && selectedDateIsCovered ? selectedDate : ""}
                onChange={(event) => selectDate(event.target.value)}
              >
                <option value="" disabled>日付を選択</option>
                {coveredDates.filter((date) => !quickDateValues.has(date)).map((date) => (
                  <option key={date} value={date}>{compactDateLabel(date)}</option>
                ))}
              </select>
            </label>
          </div>

          {recommendations.length > 0 && (
            <section className="recommendation-strip" aria-labelledby="recommendation-title">
              <div className="recommendation-label">
                <h2 id="recommendation-title">おすすめ</h2>
                <p>参加しやすさ・時間・近さ・内容から選択</p>
              </div>
              <div className="recommendation-list">
                {recommendations.map((event) => <RecommendationCard key={event.id} event={event} now={clock} />)}
              </div>
            </section>
          )}

          <div className={`controls ${selectedIsToday ? "" : "without-ended"}`}>
            <label className="search-box">
              <span aria-hidden="true">⌕</span>
              <input aria-label="イベントを検索" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="イベント名・会場・ジャンルで検索" />
            </label>
            <label className="sort-box">
              <span>並び替え</span>
              <select value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)}>
                {sortOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label className="toggle"><input type="checkbox" checked={freeOnly} onChange={(event) => setFreeOnly(event.target.checked)} /><span>無料のみ</span></label>
            <label className="toggle"><input type="checkbox" checked={walkInOnly} onChange={(event) => setWalkInOnly(event.target.checked)} /><span>予約不要</span></label>
            {selectedIsToday && <label className="toggle"><input type="checkbox" checked={showEnded} onChange={(event) => setShowEnded(event.target.checked)} /><span>終了</span></label>}
          </div>

          <div className="tag-filter" aria-label="ジャンルで絞り込む">
            <button type="button" aria-pressed={selectedGenre === "all"} className={selectedGenre === "all" ? "active" : ""} onClick={() => setSelectedGenre("all")}>すべて</button>
            {availableGenres.map((genre) => (
              <button type="button" aria-pressed={selectedGenre === genre.value} key={genre.value} className={selectedGenre === genre.value ? "active" : ""} onClick={() => setSelectedGenre(genre.value)}>{genre.label}</button>
            ))}
          </div>

          {filteredEvents.length > 0 ? (
            <>
              <div className="event-grid">
                {displayedEvents.map((event) => <EventCard key={event.id} event={event} />)}
              </div>
              {visibleCount < filteredEvents.length && (
                <button type="button" className="load-more" onClick={() => setVisibleCount((count) => count + 12)}>
                  もっと見る
                </button>
              )}
            </>
          ) : (
            <div className="empty-state"><span>○</span><p>この条件に合う{selectedRelativeLabel}のイベントは見つかりませんでした。</p></div>
          )}
        </section>

      </main>

      <footer>
        <p>こたけから、きょう。</p>
        <small>掲載内容は変更される場合があります。参加前に必ず公式ページをご確認ください。</small>
      </footer>
    </>
  );
}

export default App;
