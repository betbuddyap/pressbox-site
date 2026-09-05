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
    const stake = p.stake > 0.5
      ? `<span class="rs-stake" title="What the allocator's $1,000 weekly sheet assigned this pick">$${Math.round(p.stake)}</span>`
      : '';
    return `
      <div class="rs-pick${ne ? ' rs-pick--ne' : ''}">
        ${renderBadge(p.tier, p.bolt)}
        <span class="rs-pick-mkt">${esc(marketLabel(p.market))}</span>
        <span class="ll-row-pick"><span class="ll-row-pick-num">${esc(p.side || '')} ${esc(p.line || '')}</span>${px}${esc(book)}</span>
        ${stake}
        ${markHTML(p.result)}
      </div>`;
  }

  // ── Allocator reconstruction ─────────────────────────────────────────
  // The SAME sizing rule the allocator sheet runs (allocator.html):
  //   weight = ((our_prob − 1/dec) × our_prob)^GAMMA, zero at no edge,
  // normalized per WEEK to a $1,000 sheet. our_prob arrives per pick from
  // the feed (released tier through the committed ladder anchors; ML =
  // the flat ROI floor over the released price). Stakes are assigned over
  // the FULL weekly sheet once — the pills only choose which stakes'
  // results get summed, exactly like reading the printed sheet back.
  const SIZING_GAMMA = 0.50;
  const WEEKLY_BANKROLL = 1000;
  function amToDec(a) {
    const o = Number(a);
    if (!o || !isFinite(o)) return null;
    return o > 0 ? 1 + o / 100 : 1 + 100 / (-o);
  }
  function deltaWeight(p, dec) {
    if (!(p > 0) || !(dec > 1)) return 0;
    const edge = p - 1 / dec;
    if (!(edge > 0)) return 0;
    return Math.pow(edge * p, SIZING_GAMMA);
  }
  function assignStakes() {
    const totals = new Map();
    for (const g of state.games) for (const p of g.picks) {
      p.dec = amToDec(p.price_raw);
      p.weight = (p.tier && p.tier !== 'no_edge' && p.our_prob)
        ? deltaWeight(p.our_prob, p.dec) : 0;
      const w = g.week ?? 0;
      totals.set(w, (totals.get(w) || 0) + p.weight);
    }
    for (const g of state.games) for (const p of g.picks) {
      const tot = totals.get(g.week ?? 0) || 0;
      p.stake = tot > 0 ? WEEKLY_BANKROLL * p.weight / tot : 0;
      p.pnl = !p.stake ? 0
        : p.result === 'win' ? p.stake * (p.dec - 1)
        : p.result === 'loss' ? -p.stake : 0;
    }
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
        <div class="rs-goto" aria-hidden="true">Full breakdown →</div>
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
        ${pill('tier:no_edge', 'No Edge', f.tier === 'no_edge')}
      </div>`;
  }

  // The record line recalculates off whatever the pills select (like My
  // Bets' hero tallies) — season-wide across all weeks, so flipping week
  // tabs browses games while the pills slice the record. No-edge rows are
  // transparency, never bets: they carry no record and no stake.
  function recordHTML() {
    const f = state.filters;
    let w = 0, l = 0, pu = 0, pnl = 0;
    for (const g of state.games) for (const p of g.picks) {
      if (!matchesFilters(p)) continue;
      if (!p.tier || p.tier === 'no_edge') continue;
      if (p.result === 'win') w++;
      else if (p.result === 'loss') l++;
      else if (p.result === 'push') pu++;
      pnl += p.pnl || 0;
    }
    if (!(w + l + pu)) return '';
    const slice = f.tier ? (f.tier === 'no_edge' ? 'No Edge' : f.tier)
      : f.market ? marketLabel(f.market) : null;
    const push = pu ? ` · ${pu} push${pu === 1 ? '' : 'es'}` : '';
    const up = pnl >= 0;
    const pnlTxt = `${up ? '+' : '−'}$${Math.abs(pnl).toFixed(0)}`;
    return `<div class="rs-record">${SEASON} so far${slice ? ` · ${esc(slice)}` : ''}:
      <span class="ll-row-pick-num">${w}–${l}</span>${esc(push)}
      · <span class="rs-pnl ${up ? 'rs-pnl--up' : 'rs-pnl--down'}">${pnlTxt}</span>
      <span class="rs-pnl-note">allocator's sheet, $1,000/wk</span></div>`;
  }

  // Graded picks are the page (Austin, 9/5: "default to only show graded").
  // No-edge verdicts stay reachable behind their own pill.
  function matchesFilters(p) {
    const f = state.filters;
    if (f.tier) return p.tier === f.tier;
    const graded = !!p.tier && p.tier !== 'no_edge';
    if (f.market) return graded && p.market === f.market;
    return graded;
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
        released number, exactly as published. Click any game for the full breakdown.
        <a href="/how-it-works.html#results" style="font-weight:600;color:var(--gold);text-decoration:none;white-space:nowrap;">How grading works →</a></p>
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
            { market: 'spread', tier: 'A+', bolt: true, side: 'Placeholder Tech', line: '-9.5', price: '-108', price_raw: -108, our_prob: 0.694, book: { name: 'FanDuel' }, result: 'win' },
            { market: 'total', tier: 'B', side: 'Under', line: '54.5', price: '-112', price_raw: -112, our_prob: 0.616, book: { name: 'DraftKings' }, result: 'loss' },
            { market: 'ml', tier: 'C', side: 'Placeholder Tech', line: '-260', price: null, price_raw: -260, our_prob: 0.7799, book: { name: 'theScore Bet' }, result: 'win' },
          ]},
        { game_id: 'demo2', week: 0, matchup: 'Fixture A&M @ Demo College',
          home_points: 24, away_points: 24, picks: [
            { market: 'spread', tier: 'B', side: 'Demo College', line: '+3', price: '-110', price_raw: -110, our_prob: 0.616, book: { name: 'Bovada' }, result: 'push' },
            { market: 'total', tier: 'no_edge', side: 'Over', line: '48.5', price: '-105', price_raw: null, our_prob: null, book: { name: 'BetMGM' }, result: 'loss' },
          ]},
        { game_id: 'demo3', week: 0, matchup: 'Placeholder Poly @ Sample U',
          home_points: 20, away_points: 27, picks: [
            { market: 'ml', tier: 'A', side: 'Placeholder Poly', line: '+195', price: null, price_raw: 195, our_prob: 0.3661, book: { name: 'FanDuel' }, result: 'win' },
            { market: 'spread', tier: 'C', side: 'Sample U', line: '-4.5', price: '-115', price_raw: -115, our_prob: 0.554, book: { name: 'DraftKings' }, result: 'loss' },
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
      assignStakes();
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
