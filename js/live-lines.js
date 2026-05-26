/* ============================================================
 * Live Lines — Page logic
 * ============================================================
 * Handles: fetch, render (5 states), polling, accordion, filters.
 * No localStorage. No external libraries. Vanilla JS only.
 *
 * State machine:
 *   loading → default | empty
 *   default → filtered (when filters active)
 *   default ↔ filtered (toggle)
 *   anonymous → paywall
 *
 * Polling: every 30s. Diff result against currently-rendered rows.
 * Only patch rows that changed. Flash --gold-pale for 600ms on change.
 * ============================================================ */

(function () {
  'use strict';

  // ── Config ──────────────────────────────────────────────────
  const API_BASE = 'https://betbuddy-backend.onrender.com';
  const FEED_URL = `${API_BASE}/canonical/live-lines/feed`;
  const HISTORY_URL = (pickId) => `${API_BASE}/canonical/live-lines/history/${pickId}`;
  const POLL_INTERVAL_MS = 120000;   // 2 min — backend updates every 30 min
  const SEASON = 2026;

  // ── Supabase auth client ────────────────────────────────────
  // Loaded from CDN script tag in live-lines.html. The anon key is
  // safe to expose — RLS protects data server-side.
  const SUPABASE_URL  = 'https://brwalcuodwxsynrpiqjc.supabase.co';
  const SUPABASE_ANON = 'REPLACE_ME_WITH_ANON_KEY';
  const sb = (typeof supabase !== 'undefined')
    ? supabase.createClient(SUPABASE_URL, SUPABASE_ANON)
    : null;

  // Cached access token (refreshed via getAccessToken below).
  // Stored on state, not in module scope, so it survives the
  // initial paint and updates if the session refreshes.

  // ── App state ───────────────────────────────────────────────
  const state = {
    authMode:    null,            // 'paid' | 'anon' | 'auth-no-sub'; resolved on init
    week:        null,            // currently selected week (from tab bar or URL)
    weeks:       [],              // all weeks present in open picks (for tab bar)
    picks:       [],              // ALL open picks (across all weeks)
    filters: {
      market:    null,            // 'spread' | 'total' | 'ml' | null
      tier:      null,            // 'A+' | 'A' | 'smart_money' | ... | null
      aplusOnly: false,           // shorthand pill: A+ across markets
    },
    lastFetchedAt: null,          // ISO timestamp of last successful fetch
    pollTimer:   null,
    expandedPickId: null,         // currently expanded row, if any
    historyCache:  {},            // pick_id → history payload
  };

  // ── Authentication ──────────────────────────────────────────
  // Resolved on init() and cached on state. Synchronous reads via
  // getAuthMode() once the page has booted.
  //
  // Three states:
  //   'paid'  — logged-in user with active subscription. Sees the board.
  //   'anon'  — not logged in. Sees paywall preview.
  //   'auth-no-sub' — logged in but no active subscription. Sees paywall
  //                   with a slightly different message and link to
  //                   manage subscription.
  //
  // Backward-compat: `?auth=anon` query param forces anonymous view for
  // testing the paywall, even when a session exists.
  function getAuthMode() {
    return state.authMode || 'anon';
  }

  // Get the current Supabase access token (JWT) if any. Returns null
  // for anonymous users.
  async function getAccessToken() {
    if (!sb) return null;
    try {
      const { data: { session } } = await sb.auth.getSession();
      return session?.access_token || null;
    } catch (e) {
      return null;
    }
  }

  // Resolve the auth mode on boot. Returns the mode string.
  async function resolveAuthMode() {
    // Manual override via query param (?auth=anon) — for paywall testing.
    const p = new URLSearchParams(location.search);
    if (p.get('auth') === 'anon') return 'anon';

    // No Supabase client loaded means SDK didn't load — treat as anon.
    if (!sb) return 'anon';

    try {
      const { data: { session } } = await sb.auth.getSession();
      if (!session) return 'anon';
      // Has a session — distinguish subscriber from logged-in-no-sub
      // based on what the feed endpoint returns. We default to 'paid'
      // here; if the first fetchFeed returns 402, we downgrade to
      // 'auth-no-sub' there.
      return 'paid';
    } catch (e) {
      return 'anon';
    }
  }

  // ── Utility: query the app container ────────────────────────
  const $app = () => document.getElementById('ll-app');

  // ── Utility: format relative time ───────────────────────────
  function relativeTimeFrom(iso) {
    if (!iso) return '';
    const then = new Date(iso).getTime();
    const now = Date.now();
    const diffSec = Math.floor((now - then) / 1000);
    if (diffSec < 60) return 'just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin} min ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr} hr ago`;
    const diffDay = Math.floor(diffHr / 24);
    return `${diffDay} day${diffDay === 1 ? '' : 's'} ago`;
  }

  // ── Utility: format kickoff as day + time ───────────────────
  // Returns { dayLabel, timeLabel, dateKey, timeKey }
  function parseKickoff(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;

    const opts = { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'America/New_York' };
    const dayLabel = d.toLocaleDateString('en-US', opts);

    const timeOpts = { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York', timeZoneName: 'short' };
    const timeLabel = d.toLocaleTimeString('en-US', timeOpts).replace(' EDT', ' ET').replace(' EST', ' ET');

    // Group key (day) — use ET date to avoid splits across midnight UTC.
    const dateKey = d.toLocaleDateString('en-US', { timeZone: 'America/New_York' });

    // Time bucket key (hour-grain) to group "Noon ET", "3:30 PM ET" etc.
    const timeKey = timeLabel;

    return { dayLabel, timeLabel, dateKey, timeKey };
  }

  // ── Utility: format a week number for display ─────────────────
  // Matches /upcoming convention: "Week 0" for opening Saturday, then "Week N".
  function weekLabel(w) {
    if (w === 0) return 'Week 0';
    return `Week ${w}`;
  }

  // ── Utility: tier sort rank (for ordering within time bucket) ─
  const TIER_SORT = {
    'A+':          7,
    'smart_money': 6,
    'A':           5,
    'goldilocks':  4,
    'lottery':     3,
    'no_edge':     0,
  };

  // ── Utility: tier display name (raw slug → customer-facing label) ─
  const TIER_DISPLAY = {
    'A+':          'A+',
    'A':           'A',
    'smart_money': 'Smart Money',
    'goldilocks':  'Goldilocks',
    'lottery':     'Lottery',
    'no_edge':     'No edge',
  };
  function tierLabel(tier) {
    if (!tier) return '—';
    return TIER_DISPLAY[tier] || tier;
  }

  // ── Utility: HTML escape ─────────────────────────────────────
  function esc(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // ── Network: fetch the feed ──────────────────────────────────
  // Custom error class for paywall responses (HTTP 402) so callers
  // can distinguish "show paywall" from "actually broken."
  class PaywallError extends Error {
    constructor(msg) { super(msg); this.name = 'PaywallError'; }
  }

  async function fetchFeed() {
    // Fetch ALL open picks across all weeks. We filter by week
    // client-side based on state.week (set by the week-tab bar).
    // Why client-side: switching weeks is instant + we have the
    // full week-tab list from a single response.
    const params = new URLSearchParams({ season: SEASON });
    const url = `${FEED_URL}?${params.toString()}`;

    const headers = {};
    const token = await getAccessToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(url, { credentials: 'omit', headers });
    if (res.status === 402) {
      throw new PaywallError('subscription required');
    }
    if (res.status === 401) {
      // JWT expired or invalid. Treat as anon — frontend will rerender.
      throw new PaywallError('not authenticated');
    }
    if (!res.ok) throw new Error(`feed HTTP ${res.status}`);
    const payload = await res.json();
    if (payload.error) throw new Error(payload.error);

    // Update weeks list. Default selected week to earliest if not set.
    state.weeks = (payload.weeks || []).slice().sort((a, b) => a - b);
    if (state.week === null && state.weeks.length > 0) {
      // Honor ?week=N from URL if it's in the list
      const urlWeek = getRequestedWeekFromUrl();
      if (urlWeek !== null && state.weeks.includes(urlWeek)) {
        state.week = urlWeek;
      } else {
        state.week = state.weeks[0];
      }
    }
    return payload.picks || [];
  }

  // Read ?week=N from URL. Returns null if not present or invalid.
  function getRequestedWeekFromUrl() {
    const p = new URLSearchParams(location.search);
    const v = p.get('week');
    if (v === null) return null;
    const n = parseInt(v, 10);
    return isNaN(n) ? null : n;
  }

  // ── Network: fetch history for one pick ──────────────────────
  async function fetchHistory(pickId) {
    if (state.historyCache[pickId]) return state.historyCache[pickId];
    const url = HISTORY_URL(pickId);

    const headers = {};
    const token = await getAccessToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(url, { credentials: 'omit', headers });
    if (res.status === 402) throw new PaywallError('subscription required');
    if (res.status === 401) throw new PaywallError('not authenticated');
    if (!res.ok) throw new Error(`history HTTP ${res.status}`);
    const payload = await res.json();
    state.historyCache[pickId] = payload;
    return payload;
  }

  // ── Render: top-level dispatcher ─────────────────────────────
  function render() {
    if (getAuthMode() === 'anon') {
      renderPaywall();
      return;
    }
    if (state.picks === null) {
      renderLoading();
      return;
    }
    if (state.picks.length === 0) {
      renderEmpty();
      return;
    }
    renderFeed();
  }

  // ── Render: loading state ────────────────────────────────────
  function renderLoading() {
    $app().innerHTML = `
      <header class="ll-header">
        <div class="ll-eyebrow">
          <span class="ll-eyebrow-dot"></span>
          Live Lines
        </div>
        <h1 class="ll-headline">${esc(state.week !== null ? weekLabel(state.week) : 'Loading')}</h1>
        <div class="ll-meta"><span class="ll-skeleton ll-skeleton--meta"></span></div>
      </header>

      ${renderFilters()}

      <div class="ll-day">
        <div class="ll-skeleton ll-skeleton--day"></div>
        <div class="ll-skeleton ll-skeleton--time"></div>
        ${[1,2,3].map(() => `
          <div class="ll-row-skeleton">
            <div class="ll-skeleton ll-skeleton--badge"></div>
            <div style="flex:1;">
              <div class="ll-skeleton ll-skeleton--line-a"></div>
              <div class="ll-skeleton ll-skeleton--line-b"></div>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  // ── Render: empty state ──────────────────────────────────────
  function renderEmpty() {
    const w = state.week ?? 0;
    const kickoffDate = new Date(`2026-08-22T12:00:00-04:00`); // Week 0 kickoff
    const countdown = formatCountdown(kickoffDate);

    $app().innerHTML = `
      <header class="ll-header">
        <div class="ll-eyebrow">
          <span class="ll-eyebrow-dot ll-eyebrow-dot--static"></span>
          Live Lines
        </div>
        <h1 class="ll-headline">Holding for kickoff</h1>
      </header>

      <div class="ll-empty">
        <div class="ll-empty-card">
          <div class="ll-empty-label">${esc(weekLabel(w))} kicks off in</div>
          <div class="ll-empty-countdown" id="ll-countdown">${esc(countdown)}</div>
          <div class="ll-empty-date">${esc(kickoffDate.toLocaleDateString('en-US', {
            weekday: 'long', month: 'short', day: 'numeric', timeZone: 'America/New_York'
          }))} · 12:00 PM ET</div>
        </div>

        <p class="ll-empty-message">
          First picks for <strong>${esc(weekLabel(w))}</strong> drop Tuesday, Aug 18.
          Until then, the board is quiet.
        </p>

        <div class="ll-empty-ctas">
          <a class="ll-empty-cta" href="/about">
            <div class="ll-empty-cta-label">How it works</div>
            <div class="ll-empty-cta-body">Methodology + five-model breakdown</div>
          </a>
        </div>

        <div class="ll-empty-footer">You'll see picks here the moment they drop.</div>
      </div>
    `;

    // Tick the countdown every minute
    if (state._countdownInterval) clearInterval(state._countdownInterval);
    state._countdownInterval = setInterval(() => {
      const el = document.getElementById('ll-countdown');
      if (el) el.textContent = formatCountdown(kickoffDate);
    }, 60000);
  }

  function formatCountdown(targetDate) {
    const diffMs = targetDate.getTime() - Date.now();
    if (diffMs <= 0) return 'now';
    const totalHr = Math.floor(diffMs / 3600000);
    const days = Math.floor(totalHr / 24);
    const hrs = totalHr - days * 24;
    return `${days}d ${hrs}h`;
  }

  // ── Render: filters (used by all populated states) ───────────
  function renderFilters() {
    const f = state.filters;
    const isActive = (m) => f.market === m && !f.aplusOnly;
    const aplusActive = f.aplusOnly;
    return `
      <div class="ll-filters" role="group" aria-label="Filter picks">
        <span class="ll-filter-label">Pick Type</span>
        <button class="ll-filter-pill" data-filter="all"
          aria-pressed="${!f.market && !f.aplusOnly ? 'true' : 'false'}">All</button>
        <button class="ll-filter-pill" data-filter="spread"
          aria-pressed="${isActive('spread') ? 'true' : 'false'}">Spread</button>
        <button class="ll-filter-pill" data-filter="total"
          aria-pressed="${isActive('total') ? 'true' : 'false'}">Total</button>
        <button class="ll-filter-pill" data-filter="ml"
          aria-pressed="${isActive('ml') ? 'true' : 'false'}">ML</button>
        <button class="ll-filter-pill" data-filter="aplus"
          aria-pressed="${aplusActive ? 'true' : 'false'}">A+ only</button>
      </div>
    `;
  }

  // ── Render: week tab bar ─────────────────────────────────────
  // Horizontal scrolling tab strip showing every week that has open
  // picks. Click a tab → state.week changes → re-render filters picks.
  function renderWeekTabs() {
    if (!state.weeks || state.weeks.length === 0) return '';
    if (state.weeks.length === 1) return '';  // no tab bar for a single week
    return `
      <div class="ll-week-bar">
        <div class="ll-week-bar-inner" role="tablist" aria-label="Pick week">
          ${state.weeks.map(w => `
            <button class="ll-week-tab ${w === state.week ? 'active' : ''}"
                    data-week="${w}" role="tab"
                    aria-selected="${w === state.week ? 'true' : 'false'}">
              ${esc(weekLabel(w))}
            </button>
          `).join('')}
        </div>
      </div>
    `;
  }

  // ── Render: the populated feed ────────────────────────────────
  function renderFeed() {
    const filtered = applyFilters(state.picks);
    // Count of picks JUST in the current week (denominator for "filtered from N")
    const inWeek = state.picks.filter(p => state.week === null || p.week === state.week);
    const totalInWeek = inWeek.length;
    const filteredCount = filtered.length;
    const anyActive = !!(state.filters.market || state.filters.aplusOnly);

    const metaText = anyActive
      ? `${filteredCount} pick${filteredCount === 1 ? '' : 's'} · filtered from ${totalInWeek}`
      : `${totalInWeek} open pick${totalInWeek === 1 ? '' : 's'} · last updated ${relativeTimeFrom(state.lastFetchedAt)}`;

    const grouped = groupPicks(filtered);

    $app().innerHTML = `
      <header class="ll-header">
        <div class="ll-eyebrow">
          <span class="ll-eyebrow-dot"></span>
          Live Lines
        </div>
        <h1 class="ll-headline">${esc(weekLabel(state.week ?? 0))}</h1>
        <div class="ll-meta">
          <span>${esc(metaText)}</span>
          <button class="ll-meta-refresh" id="ll-refresh-btn">refresh</button>
        </div>
      </header>

      ${renderWeekTabs()}

      ${renderFilters()}

      ${grouped.length === 0
        ? '<p style="padding:var(--space-6) 0;color:var(--text-mid);">No picks match these filters.</p>'
        : grouped.map(renderDayBucket).join('')
      }
    `;

    attachFeedHandlers();
  }

  function applyFilters(picks) {
    const f = state.filters;
    return picks.filter(p => {
      // Filter by selected week (week-tab bar)
      if (state.week !== null && p.week !== state.week) return false;
      if (f.aplusOnly && p.tier !== 'A+') return false;
      if (f.market && p.market !== f.market) return false;
      if (f.tier && p.tier !== f.tier) return false;
      return true;
    });
  }

  // Group picks by day → time, sorted within each by tier strength
  function groupPicks(picks) {
    const byDay = new Map(); // dateKey → { dayLabel, byTime: Map<timeKey, picks[]> }
    for (const p of picks) {
      const k = parseKickoff(p.kickoff);
      if (!k) continue;
      if (!byDay.has(k.dateKey)) {
        byDay.set(k.dateKey, { dayLabel: k.dayLabel, kickoff: p.kickoff, byTime: new Map() });
      }
      const day = byDay.get(k.dateKey);
      if (!day.byTime.has(k.timeKey)) {
        day.byTime.set(k.timeKey, { timeLabel: k.timeLabel, picks: [] });
      }
      day.byTime.get(k.timeKey).picks.push(p);
    }
    // Convert to arrays, sort
    const days = [];
    for (const [dateKey, day] of byDay) {
      const times = [];
      for (const [timeKey, tg] of day.byTime) {
        tg.picks.sort((a, b) => {
          const ar = TIER_SORT[a.tier] || 0;
          const br = TIER_SORT[b.tier] || 0;
          if (br !== ar) return br - ar;
          return (a.matchup || '').localeCompare(b.matchup || '');
        });
        times.push({ timeKey, timeLabel: tg.timeLabel, picks: tg.picks });
      }
      times.sort((a, b) => {
        // Sort time buckets by the earliest pick's kickoff
        const ak = a.picks[0]?.kickoff || '';
        const bk = b.picks[0]?.kickoff || '';
        return ak.localeCompare(bk);
      });
      days.push({ dateKey, dayLabel: day.dayLabel, kickoff: day.kickoff, times });
    }
    days.sort((a, b) => (a.kickoff || '').localeCompare(b.kickoff || ''));
    return days;
  }

  function renderDayBucket(day) {
    return `
      <section class="ll-day">
        <h2 class="ll-day-header">${esc(day.dayLabel)}</h2>
        ${day.times.map(t => `
          <div class="ll-time-header">${esc(t.timeLabel)}</div>
          ${t.picks.map(renderPickRow).join('')}
        `).join('')}
      </section>
    `;
  }

  function renderPickRow(p) {
    const isNoEdge = p.tier === 'no_edge';
    const isExpanded = state.expandedPickId === p.pick_id;
    const badge = renderBadge(p.tier);
    const pickLine = renderPickLine(p);

    return `
      <article class="ll-row ${isNoEdge ? 'll-row--no-edge' : ''}"
               data-pick-id="${esc(p.pick_id)}"
               aria-expanded="${isExpanded ? 'true' : 'false'}">
        <button class="ll-row-header" data-action="toggle"
                aria-controls="ll-acc-${esc(p.pick_id)}"
                aria-expanded="${isExpanded ? 'true' : 'false'}">
          ${badge}
          <div class="ll-row-content">
            <div class="ll-row-matchup">${esc(p.matchup || '—')}</div>
            <div class="ll-row-pick">${pickLine}</div>
          </div>
          <svg class="ll-row-chevron" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <div id="ll-acc-${esc(p.pick_id)}" class="ll-accordion">
          ${isExpanded ? renderAccordionBody(p) : ''}
        </div>
      </article>
    `;
  }

  function renderBadge(tier) {
    // Map tier value to (label, ariaLabel, cssKey). CSS class names are
    // case-sensitive, so we use a sanitized key that matches the CSS.
    const map = {
      'A+':          { label: 'A+', aria: 'A plus tier',      key: 'aplus' },
      'A':           { label: 'A',  aria: 'A tier',           key: 'a' },
      'smart_money': { label: 'SM', aria: 'Smart Money tier', key: 'smart_money' },
      'goldilocks':  { label: 'GL', aria: 'Goldilocks tier',  key: 'goldilocks' },
      'lottery':     { label: 'LT', aria: 'Lottery tier',     key: 'lottery' },
      'no_edge':     { label: 'NE', aria: 'No edge — model aggregate without an actionable edge', key: 'no_edge' },
    };
    const m = map[tier] || { label: esc(tier), aria: esc(tier), key: 'no_edge' };
    return `<span class="ll-badge ll-badge--${m.key}" aria-label="${m.aria}">${m.label}</span>`;
  }

  function renderPickLine(p) {
    // Format the per-row pick line. Examples:
    //   "Memphis +3 · DraftKings"          (single book)
    //   "Memphis +3 · DraftKings + 1 other"  (one tied book)
    //   "Under 54.5 · FanDuel + 2 others"    (multiple tied books)
    if (!p.side) return '<span class="ll-row-pick-num">—</span>';
    const bookName = esc(p.book?.name || '');
    const tied = Number(p.tied_books_count || 0);
    let bookText = bookName;
    if (tied === 1) bookText = `${bookName} + 1 other`;
    else if (tied > 1) bookText = `${bookName} + ${tied} others`;

    if (p.market === 'total') {
      return `${esc(p.side)} <span class="ll-row-pick-num">${esc(p.line)}</span> · ${bookText}`;
    }
    if (p.market === 'ml') {
      return `${esc(p.side)} ML <span class="ll-row-pick-num">${esc(p.line)}</span> · ${bookText}`;
    }
    return `${esc(p.side)} <span class="ll-row-pick-num">${esc(p.line)}</span> · ${bookText}`;
  }

  // ── Accordion body (history + other books + bet button) ──────
  // Renders a SKELETON only. After fetchHistory resolves,
  // renderHistoryInto replaces this with the real timeline + books +
  // bet button + game link.
  function renderAccordionBody(p) {
    return `
      <div data-history-for="${esc(p.pick_id)}">
        <div class="ll-accordion-section-label">History</div>
        <div class="ll-skeleton" style="display:block;width:80%;height:12px;margin-bottom:var(--space-2);"></div>
        <div class="ll-skeleton" style="display:block;width:60%;height:12px;margin-bottom:var(--space-4);"></div>
      </div>
    `;
  }

  function renderHistoryInto(pickId, history, pick) {
    const target = document.querySelector(`[data-history-for="${CSS.escape(String(pickId))}"]`);
    if (!target) return;

    const released = history.released;
    const events = history.transitions || [];

    const releasedDate = released?.at ? formatHistoryTime(released.at) : '';

    let eventsHtml = events.map(e => {
      const isBookChange = e.is_book_change && !e.is_tier_change && !e.is_side_change;
      const dot = isBookChange
        ? `<span class="ll-event-dot" style="background:var(--text-mid);"></span>`
        : `<span class="ll-event-dot"></span>`;
      return `
        <div class="ll-event">
          ${dot}
          <div class="ll-event-title">${esc(e.summary || 'Pick updated')}</div>
          <div class="ll-event-time">${esc(formatHistoryTime(e.observed_at))}</div>
        </div>
      `;
    }).join('');

    const currentBook = pick.book?.name || '';
    const currentLine = pick.line || '';
    const currentSide = pick.side || '';
    const currentTier = pick.tier || '';
    const currentBookUrl = pick.book?.url || '#';

    // Other books: exclude only the one already shown as the primary on
    // the row above. Multiple books can tie for "best" — we don't want
    // to hide them all, just the one we picked as the headline.
    const allBooks = history.current_books || [];
    let primaryHidden = false;
    const otherBooks = allBooks.filter(b => {
      if (!primaryHidden && b.book && b.book.name === currentBook) {
        primaryHidden = true;
        return false;
      }
      return true;
    });

    const booksHtml = otherBooks.length ? otherBooks.map(b => {
      const url = b.book?.url || '#';
      const name = esc(b.book?.name || '?');
      const line = esc(b.line || '');
      const deltaClass =
        b.delta === 'match' ? 'll-book-delta--match' :
        (b.delta && b.delta.startsWith('+')) ? 'll-book-delta--better' :
        'll-book-delta--worse';
      return `
        <a class="ll-book-row" href="${esc(url)}" target="_blank" rel="noopener noreferrer"
           aria-label="Bet at ${name} (opens in new tab)">
          <span class="ll-book-name">
            ${name}
            <svg class="ll-book-name-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M6 4h6v6M12 4L4 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          </span>
          <span>
            <span class="ll-book-line">${line}</span>
            <span class="${deltaClass}"> (${esc(b.delta)})</span>
          </span>
        </a>
      `;
    }).join('') : '';

    target.innerHTML = `
      <div class="ll-accordion-section-label">History</div>
      <div class="ll-history">
        <div class="ll-event">
          <span class="ll-event-dot"></span>
          <div class="ll-event-title">
            <strong>Released ${esc(tierLabel(released?.tier))}</strong>
            · ${esc(released?.side || '—')} ${esc(released?.line || '')}
            at ${esc(released?.book?.name || '—')}
          </div>
          <div class="ll-event-time">${esc(releasedDate)}</div>
        </div>
        ${eventsHtml}
        <div class="ll-event">
          <span class="ll-event-dot"></span>
          <div class="ll-event-title">
            <strong>Current</strong>
            · ${esc(currentTier === 'no_edge' ? 'No edge' : tierLabel(currentTier) + ' holding')}
            · ${esc(currentSide)} ${esc(currentLine)} at ${esc(currentBook)}
          </div>
          <div class="ll-event-time">Now</div>
        </div>
      </div>

      ${booksHtml ? `
        <div class="ll-other-books" data-other-books="${esc(pickId)}">
          <button type="button" class="ll-other-books-header" data-action="toggle-books"
                  aria-expanded="false">
            <span class="ll-accordion-section-label" style="margin:0;">Other books</span>
            <svg class="ll-other-books-chevron" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <div class="ll-other-books-rows" style="display:none;margin-top:var(--space-2);">
            ${booksHtml}
          </div>
        </div>
      ` : ''}

      <a class="ll-bet-button" href="${esc(currentBookUrl)}"
         target="_blank" rel="noopener noreferrer"
         aria-label="Bet at ${esc(currentBook)} (opens in new tab)"
         style="margin-top:var(--space-4);">
        Bet at ${esc(currentBook)} →
      </a>
      <a class="ll-game-link" href="/game/${esc(pick.game_id || '')}">
        Full game breakdown →
      </a>
    `;

    // Attach Other Books toggle handler
    const obToggle = target.querySelector('[data-action="toggle-books"]');
    if (obToggle) {
      obToggle.addEventListener('click', () => {
        const wrap = obToggle.closest('.ll-other-books');
        const rows = wrap?.querySelector('.ll-other-books-rows');
        if (!rows) return;
        const isOpen = obToggle.getAttribute('aria-expanded') === 'true';
        obToggle.setAttribute('aria-expanded', String(!isOpen));
        rows.style.display = isOpen ? 'none' : 'block';
        // Rotate chevron
        const chev = obToggle.querySelector('.ll-other-books-chevron');
        if (chev) chev.style.transform = isOpen ? '' : 'rotate(180deg)';
      });
    }
  }

  function formatHistoryTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
      timeZone: 'America/New_York'
    });
  }

  // ── Render: paywall state ────────────────────────────────────
  function renderPaywall() {
    // Pull picks if not already (just to blur them) — best effort, no auth needed
    const samplePicks = (state.picks || []).slice(0, 6);
    const rowsHtml = samplePicks.map(p => `
      <article class="ll-row">
        <div class="ll-row-header">
          ${renderBadge(p.tier)}
          <div class="ll-row-content">
            <div class="ll-row-matchup">${esc(p.matchup || '—')}</div>
            <div class="ll-row-pick">${renderPickLine(p)}</div>
          </div>
        </div>
      </article>
    `).join('');

    $app().innerHTML = `
      <header class="ll-paywall-header">
        <div class="ll-paywall-eyebrow">— Live Picks</div>
        <h1 class="ll-paywall-headline">
          <span class="ll-paywall-headline-1">Every active pick.</span>
          <span class="ll-paywall-headline-2">Graded live.</span>
        </h1>
        <p class="ll-paywall-body">
          The grade you see now is the bet you'd make now. Picks lock at release with
          a line, book, and tier. As the market moves, we re-grade against the current
          best number every 30 minutes. <strong>The "Now" tier is what matters for
          what you're about to bet.</strong> ~28 picks every week across seven tiers.
        </p>
      </header>

      <div class="ll-filters" aria-hidden="true" style="pointer-events:none;">
        <span class="ll-filter-label">Pick Type</span>
        <button class="ll-filter-pill" aria-pressed="true">All</button>
        <button class="ll-filter-pill" aria-pressed="false">Spread</button>
        <button class="ll-filter-pill" aria-pressed="false">Total</button>
        <button class="ll-filter-pill" aria-pressed="false">ML</button>
        <button class="ll-filter-pill" aria-pressed="false">A+ only</button>
      </div>

      <div class="ll-paywall-blur">
        ${rowsHtml || `
          <article class="ll-row"><div class="ll-row-header">
            <span class="ll-badge ll-badge--aplus">A+</span>
            <div class="ll-row-content">
              <div class="ll-row-matchup">Sample Matchup A</div>
              <div class="ll-row-pick">Team +7 · FanDuel</div>
            </div>
          </div></article>
          <article class="ll-row"><div class="ll-row-header">
            <span class="ll-badge ll-badge--a">A</span>
            <div class="ll-row-content">
              <div class="ll-row-matchup">Sample Matchup B</div>
              <div class="ll-row-pick">Team -3.5 · DraftKings</div>
            </div>
          </div></article>
        `}
        <div class="ll-paywall-fade"></div>
      </div>

      <div class="ll-paywall-card">
        <h2 class="ll-paywall-card-headline">
          See every pick.<br>Graded live, all week.
        </h2>
        <p class="ll-paywall-card-subhead">
          Founding-member pricing through Aug 22 kickoff. ~30% off, locked for as long as you're subscribed.
        </p>

        <div class="ll-paywall-plans">
          <div class="ll-paywall-plan">
            <div class="ll-paywall-plan-name">Weekly</div>
            <div class="ll-paywall-plan-price">
              $5.99/wk<br>
              <span class="ll-paywall-plan-release">release $3.99</span>
            </div>
          </div>
          <div class="ll-paywall-plan ll-paywall-plan--featured">
            <div class="ll-paywall-plan-badge">Most Picked</div>
            <div class="ll-paywall-plan-name">Monthly</div>
            <div class="ll-paywall-plan-price">
              $18.99/mo<br>
              <span class="ll-paywall-plan-release">release $11.99</span>
            </div>
          </div>
          <div class="ll-paywall-plan">
            <div class="ll-paywall-plan-name">Season Pass</div>
            <div class="ll-paywall-plan-price">
              $49.99<br>
              <span class="ll-paywall-plan-release">release $34.99</span>
            </div>
          </div>
        </div>

        <a class="ll-paywall-cta" href="/subscribe.html">Get the picks →</a>
        <div class="ll-paywall-footer">Cancel anytime. No upsells. Same access on every plan.</div>
      </div>

      <div class="ll-paywall-after">
        <div class="ll-paywall-after-eyebrow">What's behind the gate</div>
        <p class="ll-paywall-after-body">
          Every active pick across all seven tiers, regraded every 30 minutes against the
          current best market line.
        </p>
      </div>
    `;
  }

  // ── Event handlers ──────────────────────────────────────────
  function attachFeedHandlers() {
    // Week tabs
    $app().querySelectorAll('.ll-week-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        const w = parseInt(btn.getAttribute('data-week'), 10);
        if (isNaN(w) || w === state.week) return;
        state.week = w;
        // Close any expanded row when switching weeks
        state.expandedPickId = null;
        render();
        // Scroll to top of the feed so the user sees the new week's
        // header rather than wherever they happened to be scrolled.
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });

    // Filter pills
    $app().querySelectorAll('.ll-filter-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        const f = btn.getAttribute('data-filter');
        if (f === 'all') {
          state.filters.market = null;
          state.filters.tier = null;
          state.filters.aplusOnly = false;
        } else if (f === 'aplus') {
          state.filters.aplusOnly = !state.filters.aplusOnly;
          if (state.filters.aplusOnly) {
            state.filters.market = null;
          }
        } else {
          state.filters.market = (state.filters.market === f) ? null : f;
          state.filters.aplusOnly = false;
        }
        render();
      });
    });

    // Refresh button
    const refreshBtn = document.getElementById('ll-refresh-btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', async () => {
        try {
          await loadFeed();
        } catch (e) { console.error(e); }
      });
    }

    // Row toggle handlers
    $app().querySelectorAll('[data-action="toggle"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const row = btn.closest('.ll-row');
        const pickId = row?.getAttribute('data-pick-id');
        if (!pickId) return;
        toggleRow(parseInt(pickId, 10));
      });
    });
  }

  async function toggleRow(pickId) {
    const wasOpen = state.expandedPickId === pickId;
    state.expandedPickId = wasOpen ? null : pickId;
    render();
    if (!wasOpen) {
      try {
        const pick = state.picks.find(p => p.pick_id === pickId);
        const history = await fetchHistory(pickId);
        if (state.expandedPickId === pickId) {
          renderHistoryInto(pickId, history, pick);
        }
      } catch (e) {
        console.error('history load failed', e);
        const target = document.querySelector(`[data-history-for="${pickId}"]`);
        if (target) {
          target.innerHTML = `<div class="ll-accordion-section-label">History</div>
            <div style="color:var(--text-mid);font-size:var(--text-sm);">
              Couldn't load history right now. Try again in a moment.
            </div>`;
        }
      }
    }
  }

  // ── Polling ──────────────────────────────────────────────────
  async function loadFeed() {
    let newPicks;
    try {
      newPicks = await fetchFeed();
    } catch (e) {
      if (e instanceof PaywallError) {
        // Session expired or sub lapsed mid-session. Switch to paywall
        // and stop polling.
        state.authMode = 'auth-no-sub';
        stopPolling();
        renderPaywall();
        return;
      }
      throw e;
    }
    const oldPicks = state.picks || [];
    // Track which rows changed for the flash animation
    const oldById = new Map(oldPicks.map(p => [p.pick_id, p]));
    const changedIds = new Set();
    for (const p of newPicks) {
      const prev = oldById.get(p.pick_id);
      if (!prev) continue;
      if (prev.tier !== p.tier || prev.book?.name !== p.book?.name) {
        changedIds.add(p.pick_id);
      }
    }
    state.picks = newPicks;
    state.lastFetchedAt = new Date().toISOString();
    state.historyCache = {};   // invalidate so dropdown re-fetches
    render();
    // Apply flash to changed rows
    changedIds.forEach(id => {
      const row = document.querySelector(`.ll-row[data-pick-id="${id}"]`);
      if (row) {
        row.classList.add('ll-row--updated');
        setTimeout(() => row.classList.remove('ll-row--updated'), 600);
      }
    });
  }

  function startPolling() {
    if (state.pollTimer) clearInterval(state.pollTimer);
    state.pollTimer = setInterval(() => {
      // Pause polling when tab is hidden to save bandwidth + battery
      if (document.visibilityState !== 'visible') return;
      loadFeed().catch(e => console.error('poll failed', e));
    }, POLL_INTERVAL_MS);
  }

  function stopPolling() {
    if (state.pollTimer) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
  }

  // Refresh immediately when the tab regains focus, even between polls
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.picks) {
      loadFeed().catch(e => console.error('visibility refresh failed', e));
    }
  });

  // ── Boot ─────────────────────────────────────────────────────
  async function init() {
    // Resolve auth mode first. This is async (calls Supabase session API)
    // so we await it before any render decisions.
    state.authMode = await resolveAuthMode();

    // ANON path: render paywall immediately. Don't bother fetching the
    // feed — backend will 402. The paywall view is self-contained.
    if (state.authMode === 'anon') {
      renderPaywall();
      return;
    }

    // PAID path: try to fetch the feed. If backend returns 402, the
    // user is signed in but doesn't have an active subscription —
    // downgrade to paywall view.
    state.picks = null; // signals loading
    renderLoading();
    try {
      state.picks = await fetchFeed();
      state.lastFetchedAt = new Date().toISOString();
      render();
      startPolling();
    } catch (e) {
      if (e instanceof PaywallError) {
        // Signed in but no active sub (or token rejected). Show paywall.
        state.authMode = 'auth-no-sub';
        renderPaywall();
        return;
      }
      console.error('initial feed failed', e);
      $app().innerHTML = `<p style="padding:var(--space-8) 0;color:var(--rust);">
        Couldn't load Live Lines right now. Refresh to try again.
      </p>`;
    }
  }

  // Refresh meta line ("X min ago") every minute even without new data
  setInterval(() => {
    if (state.picks && state.picks.length > 0 && !state.filters.market && !state.filters.aplusOnly) {
      const metaEl = document.querySelector('.ll-meta span:first-child');
      if (metaEl && state.lastFetchedAt) {
        const text = `${state.picks.length} open pick${state.picks.length === 1 ? '' : 's'} · last updated ${relativeTimeFrom(state.lastFetchedAt)}`;
        if (metaEl.textContent !== text) metaEl.textContent = text;
      }
    }
  }, 60000);

  // Boot when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
