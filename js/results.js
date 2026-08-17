/* ============================================================
 * Results — Live Lines for finished games
 * ============================================================
 * One fetch: /canonical/results/feed. Game cards in the Live Lines
 * language — released grade on the badge, the pick as it was graded
 * (released price/book, line frozen at kickoff), win/loss/push glyph
 * per pick, final score in the header, whole card links to the game
 * page's final state. Week tabs + the sitewide market/tier pills.
 *
 * The old aggregate/history view (2022–25 backfill records, season
 * dropdowns) is gone on purpose: this page is the 2026 record as it
 * lands, game by game. ?demo=1 renders a fixture for pre-season
 * layout checks (same precedent as the game page's demo mode).
 *
 * No external libraries. Vanilla JS.
 * ============================================================ */

(function () {
  'use strict';

  const API_BASE = 'https://betbuddy-backend.onrender.com';
  const SEASON = 2026;
  const DEMO = new URLSearchParams(location.search).get('demo') === '1';

  const state = {
    games: [], weeks: [], week: null, record: {},
    filters: { market: null, tier: null },
    loading: true, error: false,
  };

  const root = document.getElementById('results-app');

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function weekLabel(w) { return w === 0 ? 'Week 0' : `Week ${w}`; }

  // Tier badge — same map as live-lines/allocator/parlay, bolt included.
  function renderBadge(tier, bolt) {
    const map = {
      'A+':      { label: 'A+', aria: 'A+ tier', key: 'aplus' },
      'A':       { label: 'A',  aria: 'A tier',  key: 'A' },
      'B':       { label: 'B',  aria: 'B tier',  key: 'B' },
      'C':       { label: 'C',  aria: 'C tier',  key: 'C' },
      'no_edge': { label: 'NE', aria: 'No edge', key: 'no_edge' },
    };
    const m = map[tier] || { label: esc(tier || '—'), aria: esc(tier || 'ungraded'), key: 'no_edge' };
    const boltKey = ({ aplus: 'aplus', A: 'A', B: 'B', C: 'C' })[m.key];
    const boltHtml = (bolt && boltKey)
      ? `<span class="ll-bolt ll-bolt--${boltKey}" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M15 1 5.5 14.5h6L9.5 23l9.5-13.5h-6z"/></svg></span>`
      : '';
    const aria = bolt ? `${m.aria} — streak-aligned` : m.aria;
    return `<span class="ll-badge ll-badge--${m.key}" aria-label="${aria}">${m.label}${boltHtml}</span>`;
  }

  // Bare glyphs, never chips (site convention): ✓ win, ✕ loss, – push.
  function markHTML(result) {
    const m = { win: ['✓', 'win', 'Win'], loss: ['✕', 'loss', 'Loss'],
                push: ['–', 'push', 'Push'] }[result];
    if (!m) return '';
    return `<span class="rs-mark rs-mark--${m[1]}" aria-label="${m[2]}">${m[0]}</span>`;
  }

  function marketLabel(mkt) {
    return { spread: 'Spread', total: 'Total', ml: 'Moneyline' }[mkt] || mkt;
  }

  function pickLineHTML(p) {
    // "Memphis +195 · FanDuel" / "Under 47.5 −108 · DraftKings" — the
    // ll-row-pick classes give the exact Live Lines typography.
    const px = p.price ? ` <span class="ll-row-pick-px">${esc(p.price)}</span>` : '';
    const book = p.book && p.book.name ? ` · ${esc(p.book.name)}` : '';
    const ne = p.tier === 'no_edge';
    return `
      <div class="rs-pick${ne ? ' rs-pick--ne' : ''}">
        ${renderBadge(p.tier, p.bolt)}
        <span class="rs-pick-mkt">${esc(marketLabel(p.market))}</span>
        <span class="ll-row-pick"><span class="ll-row-pick-num">${esc(p.side || '')} ${esc(p.line || '')}</span>${px}${esc(book)}</span>
        ${markHTML(p.result)}
      </div>`;
  }

  function gameCardHTML(g) {
    const score = (g.home_points != null && g.away_points != null)
      ? `${g.away_points}–${g.home_points}` : '';
    return `
      <a class="ll-row rs-game" href="/game.html?id=${encodeURIComponent(g.game_id)}"
         aria-label="${esc(g.matchup)} final — full breakdown">
        <div class="rs-game-head">
          <span class="rs-matchup">${esc(g.matchup || '')}</span>
          <span class="rs-headright"><span class="rs-final">Final</span> <span class="rs-score">${esc(score)}</span></span>
        </div>
        ${g.picks.map(pickLineHTML).join('')}
      </a>`;
  }

  function weekTabsHTML() {
    if (!state.weeks || state.weeks.length <= 1) return '';
    return `
      <div class="ll-week-bar"><div class="ll-week-bar-inner" role="tablist" aria-label="Results week">
        ${state.weeks.map(w => `
          <button class="ll-week-tab ${w === state.week ? 'active' : ''}" data-week="${w}"
                  role="tab" aria-selected="${w === state.week ? 'true' : 'false'}">${esc(weekLabel(w))}</button>
        `).join('')}
      </div></div>`;
  }

  function filtersHTML() {
    const f = state.filters;
    const pill = (key, label, active) =>
      `<button type="button" class="ll-filter-pill${active ? ' active' : ''}" data-filter="${key}"
               aria-pressed="${active ? 'true' : 'false'}">${label}</button>`;
    return `
      <div class="ll-filters" style="margin-bottom:var(--space-4);">
        <span class="ll-filter-label">Pick Type</span>
        ${pill('all', 'All', !f.market && !f.tier)}
        ${pill('spread', 'Spread', f.market === 'spread')}
        ${pill('total', 'Total', f.market === 'total')}
        ${pill('ml', 'Moneyline', f.market === 'ml')}
        ${pill('tier:A+', 'A+', f.tier === 'A+')}
        ${pill('tier:A', 'A', f.tier === 'A')}
        ${pill('tier:B', 'B', f.tier === 'B')}
        ${pill('tier:C', 'C', f.tier === 'C')}
      </div>`;
  }

  function recordHTML() {
    const r = state.record || {};
    const w = r.win || 0, l = r.loss || 0, p = r.push || 0;
    if (!(w + l + p)) return '';
    const push = p ? ` · ${p} push${p === 1 ? '' : 'es'}` : '';
    return `<div class="rs-record">${SEASON} so far:
      <span class="ll-row-pick-num">${w}–${l}</span>${esc(push)}</div>`;
  }

  function matchesFilters(p) {
    const f = state.filters;
    if (f.tier) return p.tier === f.tier;
    if (f.market) return p.market === f.market;
    return true;
  }

  function render() {
    if (state.loading) { root.innerHTML = `<div class="ll-skeleton-stack">${'<div class="ll-skeleton ll-skeleton-row"></div>'.repeat(4)}</div>`; return; }
    if (state.error) {
      root.innerHTML = `<div class="rs-empty">Couldn’t load the record — try a refresh.</div>`;
      return;
    }
    const header = `
      <header class="rs-head">
        <div class="rs-eyebrow">— Results</div>
        <h1 class="rs-title">Every pick, graded.</h1>
        <p class="rs-sub">Live Lines, for games that are over. Picks leave the board
        when their game kicks off; when it goes final they land here — graded at the
        released number, exactly as published. Click any game for the full breakdown.</p>
        ${recordHTML()}
      </header>`;

    const inWeek = state.games.filter(g => state.week == null || g.week === state.week);
    const cards = inWeek
      .map(g => ({ ...g, picks: g.picks.filter(matchesFilters) }))
      .filter(g => g.picks.length)
      .map(gameCardHTML).join('');

    const empty = state.games.length
      ? `<div class="rs-empty">Nothing matches that filter this week.</div>`
      : `<div class="rs-empty">The record starts with the Week 0 finals. Picks leave
         Live Lines at kickoff and land here graded shortly after the final whistle.</div>`;

    root.innerHTML = header + weekTabsHTML() + (state.games.length ? filtersHTML() : '')
      + (cards || empty);
  }

  function demoPayload() {
    return {
      season: SEASON, weeks: [0], record: { win: 3, loss: 2, push: 1 },
      games: [
        { game_id: 'demo1', week: 0, matchup: 'Sample State @ Placeholder Tech',
          home_points: 31, away_points: 17, picks: [
            { market: 'spread', tier: 'A+', bolt: true, side: 'Placeholder Tech', line: '-9.5', price: '-108', book: { name: 'FanDuel' }, result: 'win' },
            { market: 'total', tier: 'B', side: 'Under', line: '54.5', price: '-112', book: { name: 'DraftKings' }, result: 'loss' },
            { market: 'ml', tier: 'C', side: 'Placeholder Tech', line: '-260', price: null, book: { name: 'theScore Bet' }, result: 'win' },
          ]},
        { game_id: 'demo2', week: 0, matchup: 'Fixture A&M @ Demo College',
          home_points: 24, away_points: 24, picks: [
            { market: 'spread', tier: 'B', side: 'Demo College', line: '+3', price: '-110', book: { name: 'Bovada' }, result: 'push' },
            { market: 'total', tier: 'no_edge', side: 'Over', line: '48.5', price: '-105', book: { name: 'BetMGM' }, result: 'loss' },
          ]},
        { game_id: 'demo3', week: 0, matchup: 'Placeholder Poly @ Sample U',
          home_points: 20, away_points: 27, picks: [
            { market: 'ml', tier: 'A', side: 'Placeholder Poly', line: '+195', price: null, book: { name: 'FanDuel' }, result: 'win' },
            { market: 'spread', tier: 'C', side: 'Sample U', line: '-4.5', price: '-115', book: { name: 'DraftKings' }, result: 'loss' },
          ]},
      ],
    };
  }

  async function load() {
    try {
      const payload = DEMO ? demoPayload()
        : await (await fetch(`${API_BASE}/canonical/results/feed?season=${SEASON}`,
                             { credentials: 'omit' })).json();
      state.games = payload.games || [];
      state.weeks = (payload.weeks || []).slice().sort((a, b) => b - a); // latest first
      state.record = payload.record || {};
      if (state.week == null && state.weeks.length) state.week = state.weeks[0];
      state.loading = false;
      render();
    } catch (e) {
      console.error('Results fetch failed:', e);
      state.loading = false; state.error = true; render();
    }
  }

  document.addEventListener('click', (e) => {
    const tab = e.target.closest('.ll-week-tab');
    if (tab) {
      state.week = Number(tab.dataset.week);
      render(); return;
    }
    const pill = e.target.closest('.ll-filter-pill');
    if (pill) {
      const key = pill.dataset.filter;
      if (key === 'all') state.filters = { market: null, tier: null };
      else if (key.startsWith('tier:')) {
        const t = key.slice(5);
        state.filters = { market: null, tier: state.filters.tier === t ? null : t };
      } else {
        state.filters = { market: state.filters.market === key ? null : key, tier: null };
      }
      render();
    }
  });

  render();
  load();
})();
