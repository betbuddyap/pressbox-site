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

  // ── App state ───────────────────────────────────────────────
  const state = {
    week:        null,            // current week (from URL or computed)
    picks:       [],              // last-fetched list of picks
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

  // ── Authentication mode (?auth=paid|anon) ───────────────────
  // Until real auth is wired in, allow query param override for testing.
  function getAuthMode() {
    const p = new URLSearchParams(location.search);
    const v = p.get('auth');
    if (v === 'anon') return 'anon';
    return 'paid';   // default to paid for v1
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

  // ── Utility: which week to fetch ────────────────────────────
  // Read from ?week=N, else fall back to backend's earliest open-pick week.
  function getRequestedWeek() {
    const p = new URLSearchParams(location.search);
    const w = parseInt(p.get('week'), 10);
    if (!isNaN(w) && w > 0) return w;
    return state.week || 1;
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
  async function fetchFeed() {
    const week = getRequestedWeek();
    const params = new URLSearchParams({ season: SEASON, week: week });
    // Don't push market/tier/status to server — we filter client-side so
    // toggling filters doesn't require round-trips and so we always have
    // the "filtered from N" denominator.
    const url = `${FEED_URL}?${params.toString()}`;

    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) throw new Error(`feed HTTP ${res.status}`);
    const payload = await res.json();
    if (payload.error) throw new Error(payload.error);
    state.week = payload.week || week;
    return payload.picks || [];
  }

  // ── Network: fetch history for one pick ──────────────────────
  async function fetchHistory(pickId) {
    if (state.historyCache[pickId]) return state.historyCache[pickId];
    const url = HISTORY_URL(pickId);
    const res = await fetch(url, { credentials: 'omit' });
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
        <h1 class="ll-headline">Week ${esc(state.week || 1)}</h1>
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
    const week = state.week || 1;
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
          <div class="ll-empty-label">Week ${esc(week)} kicks off in</div>
          <div class="ll-empty-countdown" id="ll-countdown">${esc(countdown)}</div>
          <div class="ll-empty-date">${esc(kickoffDate.toLocaleDateString('en-US', {
            weekday: 'long', month: 'short', day: 'numeric', timeZone: 'America/New_York'
          }))} · 12:00 PM ET</div>
        </div>

        <p class="ll-empty-message">
          First picks for <strong>Week ${esc(week)}</strong> drop Tuesday, Aug 18.
          Until then, the board is quiet.
        </p>

        <div class="ll-empty-ctas">
          <a class="ll-empty-cta" href="/results">
            <div class="ll-empty-cta-label">Past Results</div>
            <div class="ll-empty-cta-body">See the full 2024-25 record</div>
          </a>
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

  // ── Render: the populated feed ────────────────────────────────
  function renderFeed() {
    const filtered = applyFilters(state.picks);
    const totalCount = state.picks.length;
    const filteredCount = filtered.length;
    const anyActive = !!(state.filters.market || state.filters.aplusOnly);

    const metaText = anyActive
      ? `${filteredCount} pick${filteredCount === 1 ? '' : 's'} · filtered from ${totalCount}`
      : `${totalCount} open pick${totalCount === 1 ? '' : 's'} · last updated ${relativeTimeFrom(state.lastFetchedAt)}`;

    const grouped = groupPicks(filtered);

    $app().innerHTML = `
      <header class="ll-header">
        <div class="ll-eyebrow">
          <span class="ll-eyebrow-dot"></span>
          Live Lines
        </div>
        <h1 class="ll-headline">Week ${esc(state.week || 1)}</h1>
        <div class="ll-meta">
          <span>${esc(metaText)}</span>
          <button class="ll-meta-refresh" id="ll-refresh-btn">refresh</button>
        </div>
      </header>

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
      'no_edge':     { label: '—',  aria: 'No edge — line has moved out of cell', key: 'no_edge' },
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
          Release pricing through Aug 22 kickoff. 25% off, locked for as long as you're subscribed.
        </p>

        <div class="ll-paywall-plans">
          <div class="ll-paywall-plan">
            <div class="ll-paywall-plan-name">Weekly</div>
            <div class="ll-paywall-plan-price">
              $6.99/wk<br>
              <span class="ll-paywall-plan-release">release $4.99</span>
            </div>
          </div>
          <div class="ll-paywall-plan ll-paywall-plan--featured">
            <div class="ll-paywall-plan-badge">Most Picked</div>
            <div class="ll-paywall-plan-name">Monthly</div>
            <div class="ll-paywall-plan-price">
              $19.99/mo<br>
              <span class="ll-paywall-plan-release">release $14.99</span>
            </div>
          </div>
          <div class="ll-paywall-plan">
            <div class="ll-paywall-plan-name">Season Pass</div>
            <div class="ll-paywall-plan-price">
              $54.99<br>
              <span class="ll-paywall-plan-release">release $39.99</span>
            </div>
          </div>
        </div>

        <a class="ll-paywall-cta" href="/subscribe">Get the picks →</a>
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
    const newPicks = await fetchFeed();
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

  // Refresh immediately when the tab regains focus, even between polls
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.picks) {
      loadFeed().catch(e => console.error('visibility refresh failed', e));
    }
  });

  // ── Boot ─────────────────────────────────────────────────────
  async function init() {
    if (getAuthMode() === 'anon') {
      // Render paywall, attempt feed for the blurred preview
      renderPaywall();
      try {
        state.picks = await fetchFeed();
        renderPaywall();
      } catch (e) {
        console.error('paywall preview failed', e);
      }
      return;
    }

    // Authenticated path
    state.picks = null; // signals loading
    renderLoading();
    try {
      state.picks = await fetchFeed();
      state.lastFetchedAt = new Date().toISOString();
      render();
      startPolling();
    } catch (e) {
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
