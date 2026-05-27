/* ============================================================
 * Results — Page logic
 * ============================================================
 * Fetches /canonical/results/aggregate + /canonical/results/breakdown
 * from the backend, manages filter state (season / tier / market via
 * dropdowns), renders the aggregate stats panel and nested per-season
 * → per-week → pick rows. Static rows — no accordion.
 *
 * No external libraries. Vanilla JS.
 * ============================================================ */

(function () {
  'use strict';

  const API_BASE = 'https://betbuddy-backend.onrender.com';

  // ── Config: filter options ─────────────────────────────────────────
  const FILTER_OPTIONS = {
    season: [
      { value: 'all',  label: 'All years' },
      { value: '2024', label: '2024'      },
      { value: '2025', label: '2025'      },
      // 2026 added dynamically once first 2026 pick has graded
    ],
    tier: [
      { value: 'all',         label: 'All tiers'   },
      { value: 'A+',          label: 'A+'          },
      { value: 'A',           label: 'A'           },
      { value: 'smart_money', label: 'Smart Money' },
      { value: 'goldilocks',  label: 'Goldilocks'  },
      { value: 'lottery',     label: 'Lottery'     },
    ],
    market: [
      { value: 'all',    label: 'All markets' },
      { value: 'spread', label: 'Spread'      },
      { value: 'total',  label: 'Total'       },
      { value: 'ml',     label: 'Moneyline'   },
    ],
  };

  const FILTER_DISPLAY_LABEL = {
    season: 'Year',
    tier:   'Tier',
    market: 'Market',
  };

  // ── State ──────────────────────────────────────────────────────────
  const state = {
    season: 'all',
    tier:   'all',
    market: 'all',
    aggregate: null,
    breakdown: null,
    loading: false,
    openDropdown: null, // 'season' | 'tier' | 'market' | null
  };

  // ── Helpers ────────────────────────────────────────────────────────
  function $app() { return document.getElementById('results-app'); }

  function esc(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function fmtPct(v) {
    if (v == null) return '—';
    return (v * 100).toFixed(1) + '%';
  }

  function fmtRoi(v) {
    if (v == null) return '—';
    const sign = v >= 0 ? '+' : '';
    return sign + (v * 100).toFixed(1) + '%';
  }

  function fmtPp(v) {
    if (v == null) return '—';
    // v is a fraction (e.g. 0.008 = 0.8 percentage points)
    return (v * 100).toFixed(1) + ' pp';
  }

  function lookupLabel(filterName, value) {
    const opts = FILTER_OPTIONS[filterName];
    const found = opts.find(o => o.value === value);
    return found ? found.label : value;
  }

  // Tier slug → CSS class key for .ll-badge--{key} (shared with Live Lines)
  function tierBadgeKey(slug) {
    if (slug === 'A+') return 'aplus';
    if (slug === 'A')  return 'a';
    return slug; // smart_money / goldilocks / lottery already match
  }

  // Short label inside the badge box
  function tierBadgeShortLabel(slug) {
    if (slug === 'A+')          return 'A+';
    if (slug === 'A')           return 'A';
    if (slug === 'smart_money') return 'SM';
    if (slug === 'goldilocks')  return 'GL';
    if (slug === 'lottery')     return 'LT';
    return slug;
  }

  function fmtLine(line, market) {
    if (line == null) return '';
    // ml released_line is American odds; show with sign
    // spread/total released_line is the betting line; show with sign
    return line > 0 ? `+${line}` : String(line);
  }

  // ── Filter context label for the stats panel ───────────────────────
  function statsContextLabel() {
    const parts = [];
    if (state.tier !== 'all') {
      parts.push(lookupLabel('tier', state.tier).toUpperCase());
    } else {
      parts.push('ALL TIERS');
    }
    if (state.season === 'all') {
      parts.push('ALL YEARS');
    } else {
      parts.push(state.season);
    }
    if (state.market !== 'all') {
      parts.push(lookupLabel('market', state.market).toUpperCase());
    } else {
      parts.push('ALL MARKETS');
    }
    return parts.join(' · ');
  }

  // ── Render: header ─────────────────────────────────────────────────
  function renderHeader() {
    return `
      <header class="rs-header">
        <div class="rs-eyebrow">— Results</div>
        <h1 class="rs-headline">Two seasons under<br><em>the locked spec.</em></h1>
        <p class="rs-lede">
          Every pick. Every week. Every result.
          <strong>No cherry-picking, no selective memory</strong> — the full record.
        </p>
      </header>
    `;
  }

  // ── Render: aggregate stats panel ──────────────────────────────────
  function renderStatsPanel() {
    const a = state.aggregate;
    if (!a) {
      return `
        <section class="rs-stats">
          <div class="rs-stats-context">Loading...</div>
        </section>
      `;
    }

    const showYoy = (state.season === 'all') && a.year_over_year_stability_pp != null;

    const bottomCols = showYoy
      ? `
        <div class="rs-stat-cell">
          <div class="rs-stat-value rs-stat-value--md rs-stat-value--sage">${esc(fmtRoi(a.roi))}</div>
          <div class="rs-stat-label">ROI</div>
        </div>
        <div class="rs-stat-cell">
          <div class="rs-stat-value rs-stat-value--md">${esc(a.total_picks)}</div>
          <div class="rs-stat-label">picks graded</div>
        </div>
        <div class="rs-stat-cell">
          <div class="rs-stat-value rs-stat-value--md">${esc(fmtPp(a.year_over_year_stability_pp))}</div>
          <div class="rs-stat-label">y/y stability</div>
        </div>
      `
      : `
        <div class="rs-stat-cell">
          <div class="rs-stat-value rs-stat-value--md rs-stat-value--sage">${esc(fmtRoi(a.roi))}</div>
          <div class="rs-stat-label">ROI</div>
        </div>
        <div class="rs-stat-cell">
          <div class="rs-stat-value rs-stat-value--md">${esc(a.total_picks)}</div>
          <div class="rs-stat-label">picks graded</div>
        </div>
      `;

    return `
      <section class="rs-stats">
        <div class="rs-stats-context">${esc(statsContextLabel())}</div>
        <div class="rs-stats-top">
          <div class="rs-stat-cell">
            <div class="rs-stat-value rs-stat-value--lg">${esc(a.record)}</div>
            <div class="rs-stat-label">record</div>
          </div>
          <div class="rs-stat-cell">
            <div class="rs-stat-value rs-stat-value--lg rs-stat-value--gold">${esc(fmtPct(a.hit_rate))}</div>
            <div class="rs-stat-label">hit rate</div>
          </div>
        </div>
        <div class="rs-stats-divider"></div>
        <div class="rs-stats-bottom ${showYoy ? '' : 'rs-stats-bottom--two'}">
          ${bottomCols}
        </div>
      </section>
    `;
  }

  // ── Render: filter dropdowns ───────────────────────────────────────
  function renderDropdown(filterName) {
    const opts = FILTER_OPTIONS[filterName];
    const current = state[filterName];
    const currentLabel = lookupLabel(filterName, current);
    const isOpen = state.openDropdown === filterName;

    const optionsHtml = opts.map(o => `
      <button class="rs-dropdown-option"
              data-filter="${esc(filterName)}"
              data-value="${esc(o.value)}"
              aria-selected="${o.value === current ? 'true' : 'false'}">
        ${esc(o.label)}
      </button>
    `).join('');

    return `
      <div class="rs-dropdown ${isOpen ? 'open' : ''}" data-dropdown="${esc(filterName)}">
        <button class="rs-dropdown-trigger" data-action="toggle-dropdown" data-filter="${esc(filterName)}">
          <span class="rs-dropdown-label">${esc(FILTER_DISPLAY_LABEL[filterName])}</span>
          <span class="rs-dropdown-value">
            ${esc(currentLabel)}
            <svg class="rs-dropdown-chevron" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path d="M3 5l3 3 3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </span>
        </button>
        <div class="rs-dropdown-menu" role="listbox">
          ${optionsHtml}
        </div>
      </div>
    `;
  }

  function renderFilters() {
    return `
      <div class="rs-filters">
        <span class="rs-filters-label">Filters</span>
        ${renderDropdown('season')}
        ${renderDropdown('tier')}
        ${renderDropdown('market')}
      </div>
    `;
  }

  // ── Render: per-pick row ───────────────────────────────────────────
  function renderPick(p) {
    const badgeKey   = tierBadgeKey(p.tier);
    const badgeLabel = tierBadgeShortLabel(p.tier);
    const lineStr    = fmtLine(p.line, p.market);
    const bookStr    = p.book ? ` · ${esc(p.book)}` : '';

    let outcomeClass, outcomeLabel;
    if (p.outcome === 'W')      { outcomeClass = 'win';  outcomeLabel = 'WIN';  }
    else if (p.outcome === 'L') { outcomeClass = 'loss'; outcomeLabel = 'LOSS'; }
    else if (p.outcome === 'P') { outcomeClass = 'push'; outcomeLabel = 'PUSH'; }
    else                         { outcomeClass = 'push'; outcomeLabel = '—';   }

    return `
      <div class="rs-pick">
        <span class="ll-badge ll-badge--${esc(badgeKey)}" aria-label="${esc(p.tier_display)}">${esc(badgeLabel)}</span>
        <div class="rs-pick-content">
          <div class="rs-pick-matchup">${esc(p.matchup)}</div>
          <div class="rs-pick-detail">
            ${esc(p.side)} <span class="rs-pick-line">${esc(lineStr)}</span><span class="rs-pick-book">${bookStr}</span>
          </div>
        </div>
        <span class="rs-outcome rs-outcome--${esc(outcomeClass)}">
          <span class="rs-outcome-dot" aria-hidden="true"></span>
          <span class="rs-outcome-label">${esc(outcomeLabel)}</span>
        </span>
      </div>
    `;
  }

  // ── Render: per-week block ─────────────────────────────────────────
  function renderWeek(wk) {
    const picksHtml = wk.picks.map(renderPick).join('');
    return `
      <div class="rs-week">
        <div class="rs-week-header">
          <div class="rs-week-label">Week ${esc(wk.week)}</div>
          <div class="rs-week-stats">
            <span class="rs-stat-num">${esc(wk.record)}</span> · ${esc(fmtPct(wk.hit_rate))} · <span class="rs-stat-num">${esc(fmtRoi(wk.roi))}</span> ROI · ${esc(wk.total_picks)} pick${wk.total_picks === 1 ? '' : 's'}
          </div>
        </div>
        ${picksHtml}
      </div>
    `;
  }

  // ── Render: per-season block ───────────────────────────────────────
  function renderSeason(s) {
    const weeksHtml = s.weeks.map(renderWeek).join('');
    return `
      <section class="rs-season">
        <div class="rs-season-header">
          <h2 class="rs-season-year">${esc(s.year)} Season</h2>
          <div class="rs-season-stats">
            <span class="rs-stat-num">${esc(s.record)}</span> · ${esc(fmtPct(s.hit_rate))} · <span class="rs-stat-num">${esc(fmtRoi(s.roi))}</span> ROI · ${esc(s.total_picks)} picks
          </div>
        </div>
        ${weeksHtml}
      </section>
    `;
  }

  // ── Render: breakdown (all seasons) ────────────────────────────────
  function renderBreakdown() {
    const b = state.breakdown;
    if (!b) {
      return `<div class="rs-loading">Loading picks...</div>`;
    }
    if (!b.seasons || b.seasons.length === 0) {
      return renderEmptyState();
    }
    return b.seasons.map(renderSeason).join('');
  }

  function renderEmptyState() {
    return `
      <div class="rs-empty">
        <div class="rs-empty-eyebrow">No results yet</div>
        <div class="rs-empty-headline"><em>Nothing graded under that filter.</em></div>
        <div class="rs-empty-sub">Try a different filter combination or clear filters to see the full record.</div>
        <button class="rs-empty-cta" data-action="clear-filters">Clear filters</button>
      </div>
    `;
  }

  // ── Render: full page ──────────────────────────────────────────────
  function render() {
    $app().innerHTML = `
      ${renderHeader()}
      ${renderStatsPanel()}
      ${renderFilters()}
      ${renderBreakdown()}
      <p class="rs-footer-note">
        Wins, losses, and pushes only. Picks that landed in No Edge by kickoff aren't counted here —
        no side was recommended, so there's nothing to score.
        The full live board is at <a href="/live-lines.html">Live Lines</a>.
      </p>
    `;
    attachHandlers();
  }

  // ── Handlers ───────────────────────────────────────────────────────
  function attachHandlers() {
    // Dropdown trigger toggling
    document.querySelectorAll('[data-action="toggle-dropdown"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const f = btn.dataset.filter;
        state.openDropdown = (state.openDropdown === f) ? null : f;
        render();
      });
    });

    // Dropdown option selection
    document.querySelectorAll('.rs-dropdown-option').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const filterName = btn.dataset.filter;
        const value      = btn.dataset.value;
        state[filterName]    = value;
        state.openDropdown   = null;
        refresh();
      });
    });

    // Empty state CTA
    document.querySelectorAll('[data-action="clear-filters"]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.season = 'all';
        state.tier   = 'all';
        state.market = 'all';
        refresh();
      });
    });

    // Close dropdowns on outside click
    document.addEventListener('click', (e) => {
      if (state.openDropdown && !e.target.closest('.rs-dropdown')) {
        state.openDropdown = null;
        render();
      }
    }, { once: true });
  }

  // ── Fetch ──────────────────────────────────────────────────────────
  async function refresh() {
    if (state.loading) return;
    state.loading = true;

    const params = new URLSearchParams();
    if (state.season !== 'all') params.append('season', state.season);
    if (state.tier   !== 'all') params.append('tier',   state.tier);
    if (state.market !== 'all') params.append('market', state.market);
    const qs = params.toString();

    try {
      const [aggRes, brkRes] = await Promise.all([
        fetch(`${API_BASE}/canonical/results/aggregate${qs ? '?' + qs : ''}`, { credentials: 'omit' }),
        fetch(`${API_BASE}/canonical/results/breakdown${qs ? '?' + qs : ''}`, { credentials: 'omit' }),
      ]);
      if (!aggRes.ok) throw new Error(`aggregate HTTP ${aggRes.status}`);
      if (!brkRes.ok) throw new Error(`breakdown HTTP ${brkRes.status}`);

      state.aggregate = await aggRes.json();
      state.breakdown = await brkRes.json();
      render();
    } catch (err) {
      console.error('Results fetch failed:', err);
      $app().innerHTML = `
        <div class="rs-loading" style="color:var(--rust);">
          Couldn't load results. Refresh to try again.
        </div>
      `;
    } finally {
      state.loading = false;
    }
  }

  // ── Boot ───────────────────────────────────────────────────────────
  refresh();
})();
