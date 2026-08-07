import { useEffect, useMemo, useState } from "react";
import {
  availabilityLabel,
  eventMatchesGenre,
  formatEventDate,
  formatPublishedAt,
  formatTimeRange,
  genreFilters,
  isEventVisible,
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
  return (
    <article className={`event-card ${featured ? "featured-card" : ""}`}>
      <a
        className="event-card-link"
        href={event.sourceUrl}
        target="_blank"
        rel="noreferrer"
        aria-label={`${event.title}の公式ページを開く`}
      >
        <EventVisual event={event} featured={featured} />
        <div className="event-card-body">
          <span className="timing-pill">{timingLabel(event, now)}</span>
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
            {event.tags.slice(0, 4).map((tag) => <span key={tag}>#{tag}</span>)}
          </div>
        </div>
      </a>
    </article>
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
  const [clock, setClock] = useState(new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/events.json?ts=${Date.now()}`, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`イベントデータを読み込めませんでした (${response.status})`);
        return response.json();
      })
      .then((data: EventsPayload) => setPayload(data))
      .catch((reason: Error) => setError(reason.message));
  }, []);

  const dataIsToday = payload?.generatedFor === tokyoDate(clock);
  const activeEvents = useMemo(() => {
    if (!payload || !dataIsToday) return [];
    return payload.events.filter((event) => isEventVisible(event, clock));
  }, [payload, dataIsToday, clock]);

  const availableGenres = useMemo(() => {
    return genreFilters.filter((genre) => activeEvents.some((event) => eventMatchesGenre(event, genre.value)));
  }, [activeEvents]);

  useEffect(() => {
    if (selectedGenre !== "all" && !availableGenres.some((genre) => genre.value === selectedGenre)) {
      setSelectedGenre("all");
    }
  }, [availableGenres, selectedGenre]);

  const filteredEvents = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("ja");
    const filtered = activeEvents.filter((event) => {
      if (!eventMatchesGenre(event, selectedGenre)) return false;
      if (freeOnly && !event.isFree) return false;
      if (walkInOnly && event.reservation !== "not_required") return false;
      if (!needle) return true;
      return [event.title, event.summary, event.venueName, event.ward, ...event.tags]
        .join(" ")
        .toLocaleLowerCase("ja")
        .includes(needle);
    });
    return sortEvents(filtered, sortKey);
  }, [activeEvents, search, selectedGenre, freeOnly, walkInOnly, sortKey]);

  const recommendations = useMemo(() => selectRecommendations(activeEvents), [activeEvents]);
  const formattedDate = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(clock);

  if (error) return <main className="state-page"><p>{error}</p></main>;
  if (!payload) return <main className="state-page"><div className="loader" /><p>今日の東京を探しています</p></main>;

  return (
    <>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="こたけから、きょう。トップ">
          <span className="brand-dot" />
          こたけから、きょう。
        </a>
        <div className="header-note">毎朝7:00までに更新</div>
      </header>

      <main id="top">
        <section className="hero">
          <div>
            <p className="eyebrow">{formattedDate}　東京23区</p>
            <h1>今日、ふらっと<em>東京へ。</em></h1>
            <p className="hero-copy">
              予約なしや当日参加を中心に、Lunaが朝から幅広く調査。小竹向原から約1時間以内の、今日だけの選択肢です。
            </p>
          </div>
          <div className="update-stamp">
            <div className="live-count"><strong>{activeEvents.length}</strong><span>件を掲載中</span></div>
            <time dateTime={payload.publishedAt}><small>最終更新</small><strong>{formatPublishedAt(payload.publishedAt)}</strong></time>
          </div>
        </section>

        {!dataIsToday && (
          <div className="notice">
            今日の更新データを待っています。前回の情報は日付違いを防ぐため非表示にしています。
          </div>
        )}

        {dataIsToday && recommendations.length > 0 && (
          <section className="recommendations section-shell">
            <div className="section-heading">
              <div><span className="section-number">01</span><h2>今日のおすすめ</h2></div>
              <p>参加しやすさ、面白さ、近さのバランスで選んだ最大5件。</p>
            </div>
            <div className="featured-grid">
              {recommendations.map((event) => <EventCard key={event.id} event={event} featured />)}
            </div>
          </section>
        )}

        <section className="all-events section-shell">
          <div className="section-heading">
            <div><span className="section-number">02</span><h2>これから行けるイベント</h2></div>
            <p>終了したイベントは現在時刻に合わせて自動的に消えます。</p>
          </div>

          <div className="controls">
            <label className="search-box">
              <span>⌕</span>
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="イベント名・会場・ジャンルで検索" />
            </label>
            <label className="sort-box">
              <span>並び替え</span>
              <select value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)}>
                {sortOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label className="toggle"><input type="checkbox" checked={freeOnly} onChange={(event) => setFreeOnly(event.target.checked)} /><span>無料のみ</span></label>
            <label className="toggle"><input type="checkbox" checked={walkInOnly} onChange={(event) => setWalkInOnly(event.target.checked)} /><span>予約不要</span></label>
          </div>

          <div className="tag-filter" role="list" aria-label="ジャンルで絞り込む">
            <button className={selectedGenre === "all" ? "active" : ""} onClick={() => setSelectedGenre("all")}>すべて</button>
            {availableGenres.map((genre) => (
              <button key={genre.value} className={selectedGenre === genre.value ? "active" : ""} onClick={() => setSelectedGenre(genre.value)}>{genre.label}</button>
            ))}
          </div>

          {filteredEvents.length > 0 ? (
            <div className="event-grid">
              {filteredEvents.map((event) => <EventCard key={event.id} event={event} />)}
            </div>
          ) : (
            <div className="empty-state"><span>○</span><p>この条件で、これから参加できるイベントは見つかりませんでした。</p></div>
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
