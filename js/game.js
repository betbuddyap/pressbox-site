/* ============================================================
 * Game Pages — Client logic
 * ============================================================
 * Per the build brief (2026-05-27).
 *
 * Reads ?game_id=N from URL. Fetches
 * /canonical/games/{id}/breakdown. Renders six sections:
 *   1. Hero          (.ctx-* — team colors, names, projected/final score)
 *   2. Storyline     (narrative blurb + staleness warn)
 *   3. The Read      (5-model dot plots + ML probability bars)
 *   4. The Pick      (active pick(s) or "no edge" note)
 *   5. The Numbers   (6 stat category cards w/ value-anchored bars)
 *   6. The Series    (matchup history, hidden if no prior meetings)
 *
 * Pure DOM + CSS positioning for charts — no library dependency.
 * ============================================================ */

(function () {
  'use strict';

  /* ───────────────────────────────────────────────────────────
   * Constants
   * ─────────────────────────────────────────────────────────── */

  const API_BASE   = 'https://betbuddy-backend.onrender.com';
  const SUPABASE_URL = 'https://brwalcuodwxsynrpiqjc.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_yUSCp6-m1gda0eMcGWuinw_LMLGP_uE';

  // Display labels and tier-class mapping (matches the brief)
  const TIER_CLASS = {
    'A+':           'tier-ap',
    'A':            'tier-a',
    'smart_money':  'tier-sm',
    'goldilocks':   'tier-gl',
    'lottery':      'tier-ls',
    'no_edge':      'tier-no-edge',
  };
  const MARKET_DISPLAY = {
    'spread': 'Spread',
    'total':  'Total',
    'ml':     'Moneyline',
  };
  const MODEL_ORDER = ['SP+', 'Elo', 'PPA', 'Advanced', 'Pace+'];

  /* ───────────────────────────────────────────────────────────
   * Element refs
   * ─────────────────────────────────────────────────────────── */

  const $ = (id) => document.getElementById(id);

  const els = {
    loading:   $('loadingState'),
    error:     $('errorState'),
    notFound:  $('notFoundState'),
    paywall:   $('paywallState'),
    content:   $('gameContent'),

    // Hero
    bgAway:    $('ctxBgAway'),
    bgHome:    $('ctxBgHome'),
    ribbon:    $('ctxRibbon'),
    breadcrumb: $('ctxBreadcrumb'),
    awayName:  $('ctxAwayName'),
    awaySub:   $('ctxAwaySub'),
    homeName:  $('ctxHomeName'),
    homeSub:   $('ctxHomeSub'),
    pgScore:   $('pgScore'),
    pgAway:    $('pgAwayNum'),
    pgHome:    $('pgHomeNum'),
    preGame:   $('preGameContent'),
    projected: $('ctxProjected'),
    projAway:  $('ctxProjAway'),
    projHome:  $('ctxProjHome'),
    projAwayLbl: $('ctxProjAwayLbl'),
    projHomeLbl: $('ctxProjHomeLbl'),
    meta:      $('ctxMeta'),

    // Sections
    storylineLede:  $('storylineLede'),
    storylineText:  $('storylineText'),
    storylineMeta:  $('storylineMeta'),
    readStack:      $('readStack'),
    pickStack:      $('pickStack'),
    numbersStack:   $('numbersStack'),
    seriesSection:  $('seriesSection'),
    seriesSummary:  $('seriesSummary'),
    seriesList:     $('seriesList'),
  };

  /* ───────────────────────────────────────────────────────────
   * State helpers
   * ─────────────────────────────────────────────────────────── */

  function showState(which) {
    [els.loading, els.error, els.notFound, els.paywall, els.content].forEach(el => {
      if (el) el.style.display = 'none';
    });
    const target = { loading: els.loading, error: els.error, notfound: els.notFound,
                     paywall: els.paywall, content: els.content }[which];
    if (target) target.style.display = which === 'content' ? 'block' : '';
  }

  function getGameId() {
    const url = new URL(window.location.href);
    const fromQuery = url.searchParams.get('game_id') || url.searchParams.get('id');
    if (fromQuery) return fromQuery;
    // Support path-style URLs: /game/{id}
    const m = url.pathname.match(/\/game\/(\d+)/);
    return m ? m[1] : null;
  }

  /* ───────────────────────────────────────────────────────────
   * Auth gate
   * ─────────────────────────────────────────────────────────── */

  async function checkAuth() {
    if (!window.supabase) return null;
    try {
      const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
      const { data } = await sb.auth.getSession();
      return data?.session?.access_token || null;
    } catch (e) {
      return null;
    }
  }

  /* ───────────────────────────────────────────────────────────
   * Data fetch
   * ─────────────────────────────────────────────────────────── */

  async function fetchBreakdown(gameId, token) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`${API_BASE}/canonical/games/${gameId}/breakdown`, { headers });
    if (res.status === 404) return { notFound: true };
    if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
    return await res.json();
  }

  /* ───────────────────────────────────────────────────────────
   * Hero rendering
   * ─────────────────────────────────────────────────────────── */

  function renderHero(data) {
    const g = data.game;
    if (!g) return;

    // Team color split
    if (g.away?.primary_color) els.bgAway.style.background = g.away.primary_color;
    if (g.home?.primary_color) els.bgHome.style.background = g.home.primary_color;

    // Breadcrumb
    els.breadcrumb.innerHTML =
      `<a href="/live-lines.html">Live Lines</a>` +
      `<span class="ctx-breadcrumb-sep">›</span>` +
      `<span>${escape(g.away?.name)} @ ${escape(g.home?.name)}</span>`;

    // Tier ribbon (only if there's a non-no-edge pick)
    const ribbonPick = (data.picks || []).find(p => p.tier && p.tier !== 'no_edge');
    if (ribbonPick) {
      const tierClass = TIER_CLASS[ribbonPick.tier] || 'tier-no-edge';
      els.ribbon.outerHTML =
        `<div class="ctx-ribbon ${tierClass}" id="ctxRibbon">${escape(ribbonPick.tier_display || ribbonPick.tier)}</div>`;
    } else {
      els.ribbon.outerHTML = `<div id="ctxRibbon"></div>`;
    }

    // Team names
    els.awayName.textContent = g.away?.name || '—';
    els.homeName.textContent = g.home?.name || '—';

    // Team sublines
    const awaySubParts = [];
    if (g.away?.rank != null) awaySubParts.push(`<span class="ctx-team-rank">#${g.away.rank}</span>`);
    if (g.away?.conference)   awaySubParts.push(`<span class="ctx-team-conf">${escape(g.away.conference)}</span>`);
    if (g.away?.record)       awaySubParts.push(`<span class="ctx-team-record">${escape(g.away.record)}</span>`);
    els.awaySub.innerHTML = awaySubParts.join('<span class="ctx-meta-dot"></span>');

    const homeSubParts = [];
    if (g.home?.rank != null) homeSubParts.push(`<span class="ctx-team-rank">#${g.home.rank}</span>`);
    if (g.home?.conference)   homeSubParts.push(`<span class="ctx-team-conf">${escape(g.home.conference)}</span>`);
    if (g.home?.record)       homeSubParts.push(`<span class="ctx-team-record">${escape(g.home.record)}</span>`);
    els.homeSub.innerHTML = homeSubParts.join('<span class="ctx-meta-dot"></span>');

    // Score state: played vs upcoming
    const played = g.status === 'final' && g.away_points != null && g.home_points != null;
    if (played) {
      els.pgScore.style.display = '';
      els.pgAway.textContent = g.away_points;
      els.pgHome.textContent = g.home_points;
      const awayWon = g.away_points > g.home_points;
      els.pgAway.classList.toggle('loser', !awayWon && g.away_points !== g.home_points);
      els.pgHome.classList.toggle('loser',  awayWon && g.away_points !== g.home_points);
      els.preGame.style.display = 'none';
    } else {
      els.pgScore.style.display = 'none';
      els.preGame.style.display = '';
      renderProjectedScore(data);
    }

    // Meta row (kickoff + venue)
    const metaParts = [];
    if (g.kickoff_display) {
      metaParts.push(`<div class="ctx-meta-item"><strong>${escape(g.kickoff_display)}</strong></div>`);
    }
    if (g.venue) {
      metaParts.push(`<div class="ctx-meta-item">${escape(g.venue)}</div>`);
    }
    if (g.neutral_site) {
      metaParts.push(`<div class="ctx-meta-item">Neutral Site</div>`);
    }
    els.meta.innerHTML = metaParts.join('<span class="ctx-meta-dot"></span>');
  }

  function renderProjectedScore(data) {
    const p = data.projections;
    if (!p) {
      els.projected.style.display = 'none';
      return;
    }
    // Blend total + blend home margin. We stored home_margin per-model
    // but the blend is in anchor frame — compute from anchor + anchor.is_home.
    const blendAnchorSpread = p.spread?.pressbox_blend;  // anchor-frame
    const blendTotal        = p.total?.pressbox_blend;
    const anchorIsHome      = p.anchor?.is_home;
    if (blendAnchorSpread == null || blendTotal == null || anchorIsHome == null) {
      els.projected.style.display = 'none';
      return;
    }
    // Convert anchor spread back to home margin:
    //   if anchor is home: home_margin = -anchor_spread
    //   if anchor is away: home_margin = anchor_spread
    const homeMargin = anchorIsHome ? -blendAnchorSpread : blendAnchorSpread;

    const homePts = (blendTotal + homeMargin) / 2;
    const awayPts = (blendTotal - homeMargin) / 2;

    els.projAway.textContent = Math.round(awayPts);
    els.projHome.textContent = Math.round(homePts);
    els.projAwayLbl.textContent = data.game?.away?.name || '';
    els.projHomeLbl.textContent = data.game?.home?.name || '';

    if (awayPts > homePts) {
      els.projAway.classList.add('winner');
      els.projHome.classList.remove('winner');
    } else if (homePts > awayPts) {
      els.projHome.classList.add('winner');
      els.projAway.classList.remove('winner');
    }

    els.projected.style.display = '';
  }

  /* ───────────────────────────────────────────────────────────
   * Storyline
   * ─────────────────────────────────────────────────────────── */

  function renderStoryline(data) {
    const n = data.narrative || {};
    if (!n.text) {
      els.storylineText.innerHTML = '<p style="color:var(--text-light);font-style:italic;">No editorial read available for this game.</p>';
      els.storylineMeta.textContent = '';
      els.storylineLede.style.display = 'none';
      return;
    }

    // Use post-game text if available and game is played
    const usePostGame = data.game?.status === 'final' && n.post_game_text;
    const text = usePostGame ? n.post_game_text : n.text;

    // Parse paragraphs and clean up UTF-8 encoding issues (em-dash corruption)
    const paragraphs = text
      .split(/\n\n+/)
      .map(p => p.trim())
      .filter(Boolean)
      .map(p => fixEncoding(p));

    els.storylineText.innerHTML = paragraphs.map(p =>
      `<p>${escape(p)}</p>`
    ).join('');

    // Generated timestamp + staleness warning
    const metaParts = [];
    if (n.generated_at) {
      metaParts.push(`Generated ${timeAgo(n.generated_at)}.`);
    }
    if (n.last_input_change && n.generated_at &&
        new Date(n.last_input_change) > new Date(n.generated_at)) {
      metaParts.push(`<span class="stale-warn">⚠ Lines have moved since this was written.</span>`);
    }
    els.storylineMeta.innerHTML = metaParts.join(' ');

    // Lede not currently emitted by the generator; keep hidden
    els.storylineLede.style.display = 'none';
  }

  function fixEncoding(s) {
    // Repair common UTF-8 mis-encoding artifacts from the narrative generator
    return s
      .replace(/â€"/g, '—')
      .replace(/â€™/g, "'")
      .replace(/â€œ/g, '"')
      .replace(/â€/g, '"')
      .replace(/â€¦/g, '…');
  }

  function timeAgo(iso) {
    if (!iso) return '';
    const then = new Date(iso).getTime();
    if (isNaN(then)) return '';
    const diffMs = Date.now() - then;
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1)    return 'just now';
    if (mins < 60)   return `${mins} min ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24)    return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
    const days = Math.floor(hrs / 24);
    if (days < 30)   return `${days} day${days === 1 ? '' : 's'} ago`;
    const months = Math.floor(days / 30);
    return `${months} month${months === 1 ? '' : 's'} ago`;
  }

  /* ───────────────────────────────────────────────────────────
   * The Read — model projection charts
   * ─────────────────────────────────────────────────────────── */

  function renderRead(data) {
    const p = data.projections;
    els.readStack.innerHTML = '';
    if (!p) return;

    const anchor = p.anchor || {};
    if (p.spread)    els.readStack.appendChild(buildDotPlot('Spread', p.spread, 'anchor_spread', anchor));
    if (p.total)     els.readStack.appendChild(buildDotPlot('Total',  p.total,  'total', anchor));
    if (p.moneyline) els.readStack.appendChild(buildMLRows(data, p.moneyline, anchor));
  }

  /**
   * Single-axis strip plot.
   *
   * Layout:
   *   - One horizontal axis across the card.
   *   - Vegas line: vertical tick across the axis with label above.
   *   - All model dots sit ON the axis at their projected value.
   *   - PressBox blend: larger gold dot, slightly offset above axis.
   *   - Labels (model name + value) attach to each dot, stacked above
   *     or below to avoid overlap.
   */
  function buildDotPlot(label, section, key, anchor) {
    const card = document.createElement('div');
    card.className = 'read-card';

    const vegasPos     = key === 'anchor_spread' ? section.vegas_anchor_spread : section.vegas_line;
    const blendPos     = section.pressbox_blend;
    const blendDisplay = section.pressbox_display;
    const vegasDisplay = section.vegas_display;

    // Collect model points
    const points = [];
    (section.models || []).forEach(m => {
      if (m[key] == null) return;
      points.push({
        name:    m.name,
        value:   m[key],
        display: m.display || String(m[key]),
        kind:    'model',
      });
    });

    if (points.length === 0 && vegasPos == null && blendPos == null) {
      card.innerHTML = `
        <div class="read-card-head">
          <div class="read-card-label">${escape(label)}</div>
          <div class="read-card-vegas">—</div>
        </div>
        <div class="read-empty">No data available yet for this matchup.</div>
      `;
      return card;
    }

    // Axis range — Vegas ± 8, padded by any model values further out.
    // The historical band does NOT participate in axis bounds. The band
    // will be clipped to whatever the axis ends up being. Letting it
    // drive bounds caused the band to swallow the entire chart.
    const histRange = section.historical_range || null;
    const histLow   = histRange?.low ?? null;
    const histHigh  = histRange?.high ?? null;
    const allVals = [vegasPos, blendPos, ...points.map(p => p.value)].filter(v => v != null);
    const minVal = Math.min(...allVals);
    const maxVal = Math.max(...allVals);
    let axisMin = vegasPos != null ? Math.min(minVal, vegasPos - 8) : minVal - 4;
    let axisMax = vegasPos != null ? Math.max(maxVal, vegasPos + 8) : maxVal + 4;
    // Spread chart: always include 0 in the axis so the zero anchor is visible
    if (key === 'anchor_spread') {
      axisMin = Math.min(axisMin, -2);
      axisMax = Math.max(axisMax, 2);
    }
    // Pad outward to a clean tick
    const tickStep = (axisMax - axisMin) > 30 ? 5 : (axisMax - axisMin) > 15 ? 3 : 1;
    axisMin = Math.floor(axisMin / tickStep) * tickStep;
    axisMax = Math.ceil(axisMax / tickStep) * tickStep;
    if (axisMax - axisMin < 4) {
      axisMin -= 2; axisMax += 2;
    }
    const range = axisMax - axisMin;
    const xPct = (v) => clamp(((v - axisMin) / range) * 100, 0, 100);

    // Header
    card.innerHTML = `
      <div class="read-card-head">
        <div class="read-card-label">${escape(label)}</div>
        <div class="read-card-vegas">Vegas: <strong>${escape(vegasDisplay || '—')}</strong></div>
      </div>
      <div class="strip-plot">
        <div class="strip-labels strip-labels-above"></div>
        <div class="strip-axis-wrap">
          <div class="strip-axis"></div>
        </div>
        <div class="strip-labels strip-labels-below"></div>
        <div class="strip-ticks"></div>
      </div>
    `;

    const axisEl  = card.querySelector('.strip-axis');
    const above   = card.querySelector('.strip-labels-above');
    const below   = card.querySelector('.strip-labels-below');
    const ticksEl = card.querySelector('.strip-ticks');

    // Axis tick labels
    for (let t = Math.ceil(axisMin / tickStep) * tickStep; t <= axisMax; t += tickStep) {
      const tick = document.createElement('div');
      tick.className = 'strip-tick';
      tick.style.left = `${xPct(t)}%`;
      ticksEl.appendChild(tick);
      const lab = document.createElement('div');
      lab.className = 'strip-tick-label';
      lab.style.left = `${xPct(t)}%`;
      lab.textContent = (key === 'anchor_spread')
        ? (t > 0 ? '+' + t : t)
        : t;
      ticksEl.appendChild(lab);
    }

    // Historical density curve — mirrored shape rendered as inline SVG.
    // The curve carries SHAPE (where outcomes pool); the y-values are
    // normalized to peak=1 by the backend so every game's curve renders
    // to the same pixel height. Drawn FIRST so it sits behind everything.
    const densityCurve = histRange?.density_curve || [];
    if (densityCurve.length >= 3) {
      // Build the mirrored polygon: top edge left-to-right, then bottom
      // edge right-to-left, all expressed in viewBox units (0-1000 x,
      // 0-100 y centered on 50).
      const VBW = 1000;       // viewBox width
      const VBH = 100;        // viewBox height
      const CENTER_Y = 50;
      const PEAK_PX  = 32;    // max half-height of the lobe (each side)

      const topPts = [];
      const botPts = [];
      for (const [x, y] of densityCurve) {
        const xv = clamp(((x - axisMin) / range) * VBW, 0, VBW);
        const yPx = clamp(y, 0, 1) * PEAK_PX;
        topPts.push([xv, CENTER_Y - yPx]);
        botPts.push([xv, CENTER_Y + yPx]);
      }
      // Polygon path: top L→R, then bottom R→L
      const pathPts = [
        ...topPts,
        ...[...botPts].reverse(),
      ];
      const d = 'M' + pathPts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' L') + ' Z';

      const svgNS = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(svgNS, 'svg');
      svg.setAttribute('class', 'strip-hist-curve');
      svg.setAttribute('viewBox', `0 0 ${VBW} ${VBH}`);
      svg.setAttribute('preserveAspectRatio', 'none');
      const path = document.createElementNS(svgNS, 'path');
      path.setAttribute('d', d);
      svg.appendChild(path);
      const tip = histRange?.sample_size
        ? `Historical outcome density for games at this Vegas line (n=${histRange.sample_size})`
        : '';
      if (tip) svg.setAttribute('aria-label', tip);
      axisEl.appendChild(svg);
    } else if (histLow != null && histHigh != null) {
      // Fallback to flat band if we somehow have edges but no curve
      // (e.g. an older row that hasn't been re-backfilled yet).
      const band = document.createElement('div');
      band.className = 'strip-hist-band';
      const lP = xPct(histLow);
      const hP = xPct(histHigh);
      band.style.left  = `${lP}%`;
      band.style.width = `${Math.max(0, hP - lP)}%`;
      axisEl.appendChild(band);
    }

    // Zero anchor — spread chart only. Distinct red vertical line at 0,
    // signals pick'em as the reference point.
    if (key === 'anchor_spread' && axisMin <= 0 && axisMax >= 0) {
      const zero = document.createElement('div');
      zero.className = 'strip-zero';
      zero.style.left = `${xPct(0)}%`;
      axisEl.appendChild(zero);
    }

    // Vegas vertical line + label above axis
    if (vegasPos != null) {
      const v = document.createElement('div');
      v.className = 'strip-vegas';
      v.style.left = `${xPct(vegasPos)}%`;
      axisEl.appendChild(v);
    }

    // PressBox blend marker — slightly larger, gold star/dot
    if (blendPos != null) {
      const b = document.createElement('div');
      b.className = 'strip-dot strip-dot-blend';
      b.style.left = `${xPct(blendPos)}%`;
      b.title = `PressBox blend: ${blendDisplay || ''}`;
      axisEl.appendChild(b);

      const bLab = document.createElement('div');
      bLab.className = 'strip-label strip-label-blend';
      bLab.style.left = `${xPct(blendPos)}%`;
      bLab.innerHTML = `<span class="strip-label-name">PressBox</span><span class="strip-label-value">${escape(blendDisplay || '')}</span>`;
      above.appendChild(bLab);
    }

    // Model dots — sort by value to do simple anti-overlap label stacking.
    // Position labels alternating above/below if they cluster.
    const sortedPts = [...points].sort((a, b) => a.value - b.value);

    sortedPts.forEach((p, i) => {
      const dot = document.createElement('div');
      dot.className = 'strip-dot';
      dot.style.left = `${xPct(p.value)}%`;
      dot.title = `${p.name}: ${p.display}`;
      axisEl.appendChild(dot);

      const lbl = document.createElement('div');
      lbl.className = 'strip-label';
      lbl.style.left = `${xPct(p.value)}%`;
      lbl.innerHTML = `<span class="strip-label-name">${escape(p.name)}</span><span class="strip-label-value">${escape(p.display)}</span>`;
      // Alternate above/below to reduce overlap
      if (i % 2 === 0) above.appendChild(lbl);
      else             below.appendChild(lbl);
    });

    return card;
  }

  /**
   * Moneyline section — center-divider bar style like stat rows.
   * Each row shows anchor probability radiating LEFT from center,
   * other probability radiating RIGHT. Numbers at the outer edges.
   *
   * Layout per row:
   *   [anchor_odds]  [    ←anchor bar  |  other bar→    ]  [other_odds]
   *
   * 7 rows total: Vegas, 5 models, PressBox.
   */
  function buildMLRows(data, mlSection, anchor) {
    const card = document.createElement('div');
    card.className = 'read-card';

    const anchorTeam = anchor.team || 'Anchor';
    const otherTeam  = anchor.other_team || 'Other';

    // Header with team name columns
    card.innerHTML = `
      <div class="read-card-head">
        <div class="read-card-label">Moneyline</div>
      </div>
      <div class="ml-teamhead">
        <div class="ml-teamhead-left">${escape(anchorTeam)}</div>
        <div class="ml-teamhead-right">${escape(otherTeam)}</div>
      </div>
      <div class="ml-bars"></div>
    `;
    const barsEl = card.querySelector('.ml-bars');

    function row(label, anchorProb, otherProb, anchorOdds, otherOdds, kind) {
      const klass = kind === 'vegas' ? ' is-vegas' : kind === 'blend' ? ' is-blend' : '';

      // Convert probability to bar width (0-50% from center)
      const aWidth = (anchorProb != null) ? clamp(anchorProb * 100, 0, 100) : 0;
      const oWidth = (otherProb  != null) ? clamp(otherProb  * 100, 0, 100) : 0;

      // Determine which side is "winning" for color emphasis
      const anchorFav = anchorProb != null && otherProb != null && anchorProb > otherProb;
      const otherFav  = otherProb  != null && anchorProb != null && otherProb  > anchorProb;
      const aQual = anchorFav ? 'fav' : 'dog';
      const oQual = otherFav  ? 'fav' : 'dog';

      barsEl.insertAdjacentHTML('beforeend', `
        <div class="ml-row${klass}">
          <div class="ml-odds ml-odds-left">${escape(anchorOdds || '—')}</div>
          <div class="ml-bar-pair">
            <div class="ml-bar-half ml-bar-left">
              <div class="ml-bar-fill ml-bar-fill-${aQual}" style="width:${aWidth}%;"></div>
            </div>
            <div class="ml-bar-divider"></div>
            <div class="ml-bar-half ml-bar-right">
              <div class="ml-bar-fill ml-bar-fill-${oQual}" style="width:${oWidth}%;"></div>
            </div>
          </div>
          <div class="ml-odds ml-odds-right">${escape(otherOdds || '—')}</div>
          <div class="ml-label">${escape(label)}</div>
        </div>
      `);
    }

    row('Vegas',
        mlSection.vegas_anchor_implied,
        mlSection.vegas_other_implied,
        mlSection.vegas_anchor_display,
        mlSection.vegas_other_display,
        'vegas');

    MODEL_ORDER.forEach(modelName => {
      const m = (mlSection.models || []).find(x => x.name === modelName);
      row(modelName,
          m?.anchor_prob,
          m?.other_prob,
          m?.anchor_display,
          m?.other_display,
          'model');
    });

    row('PressBox',
        mlSection.pressbox_anchor_prob,
        mlSection.pressbox_other_prob,
        mlSection.pressbox_anchor_american,
        mlSection.pressbox_other_american,
        'blend');

    return card;
  }

  /* ───────────────────────────────────────────────────────────
   * The Pick
   * ─────────────────────────────────────────────────────────── */

  function renderPicks(data) {
    els.pickStack.innerHTML = '';
    const picks = (data.picks || []).filter(p => p.tier && p.tier !== 'no_edge');
    if (!picks.length) {
      els.pickStack.innerHTML = `
        <div class="pick-empty">
          <div class="pick-empty-icon">i</div>
          <div>No active pick on this game. Our system considered it but didn't find a tier-eligible edge.</div>
        </div>
      `;
      return;
    }

    picks.forEach(p => {
      const card = document.createElement('div');
      card.className = 'pick-card';
      const tierClass = TIER_CLASS[p.tier] || 'tier-no-edge';
      const marketLabel = (p.market_display || MARKET_DISPLAY[p.market] || p.market || '').toUpperCase();

      const lineDisplay = (() => {
        if (p.market === 'total') {
          return `${p.side_display} ${p.line ?? ''}`.trim();
        }
        if (p.market === 'spread') {
          const ln = p.line != null ? formatSignedNumber(p.line) : '';
          return `${p.side_display} ${ln}`.trim();
        }
        // moneyline
        return `${p.side_display}${p.line != null ? ' ' + formatSignedNumber(p.line) : ''}`;
      })();

      const outcomeBadge = p.outcome
        ? `<span class="pick-outcome ${
            p.outcome === 'W' ? 'win' : p.outcome === 'L' ? 'loss' : 'push'
          }">${p.outcome === 'W' ? 'Won' : p.outcome === 'L' ? 'Lost' : 'Push'}</span>`
        : '';

      card.innerHTML = `
        <div class="pick-head">
          <span class="pick-tier-badge ${tierClass}">${escape(p.tier_display || p.tier)}</span>
          <span class="pick-market">${escape(marketLabel)}</span>
        </div>
        <div class="pick-line">${escape(lineDisplay)}</div>
        <div class="pick-meta">
          ${p.book ? `<span>${escape(p.book)}</span>` : ''}
          ${p.book && p.released_at ? `<span class="pick-meta-dot"></span>` : ''}
          ${p.released_at ? `<span>Released ${timeAgo(p.released_at)}</span>` : ''}
          ${outcomeBadge ? `<span class="pick-meta-dot"></span>${outcomeBadge}` : ''}
        </div>
      `;
      els.pickStack.appendChild(card);
    });
  }

  function formatSignedNumber(n) {
    if (n == null) return '';
    if (n > 0) return '+' + n;
    return String(n);
  }

  /* ───────────────────────────────────────────────────────────
   * The Numbers — stat comparison
   * ─────────────────────────────────────────────────────────── */

  function renderNumbers(data) {
    els.numbersStack.innerHTML = '';
    const cats = data.stats?.categories || [];
    const awayName = data.game?.away?.name || 'Away';
    const homeName = data.game?.home?.name || 'Home';

    cats.forEach(cat => {
      const card = document.createElement('div');
      card.className = 'numbers-card';

      // Special-case: Defense — Advanced splits into "Allowed" (lower better)
      // and "Generated" (higher better) sub-groups. Headed with explanatory
      // italic subheads so the reader knows which direction = good.
      let bodyHtml;
      if (cat.name === 'Defense — Advanced') {
        const allowedRows = (cat.rows || []).filter(r => r.lower_better);
        const generatedRows = (cat.rows || []).filter(r => !r.lower_better);

        const sections = [];
        if (allowedRows.length) {
          sections.push(`
            <div class="numbers-subhead">What this defense allows <span class="numbers-subhead-hint">(shorter bar = better)</span></div>
            ${allowedRows.map(r => renderStatRow(r)).join('')}
          `);
        }
        if (generatedRows.length) {
          sections.push(`
            <div class="numbers-subhead">What this defense generates <span class="numbers-subhead-hint">(longer bar = better)</span></div>
            ${generatedRows.map(r => renderStatRow(r)).join('')}
          `);
        }
        bodyHtml = sections.join('');
      } else {
        bodyHtml = (cat.rows || []).map(r => renderStatRow(r)).join('');
      }

      card.innerHTML = `
        <div class="numbers-card-head">
          <h3 class="numbers-card-title">${escape(cat.name)}</h3>
        </div>
        <div class="numbers-teamhead">
          <div class="numbers-teamhead-away">${escape(awayName)}</div>
          <div class="numbers-teamhead-spacer"></div>
          <div class="numbers-teamhead-home">${escape(homeName)}</div>
        </div>
        <div class="numbers-rows">${bodyHtml}</div>
      `;
      els.numbersStack.appendChild(card);
    });
  }

  /**
   * Render a single stat row with value-anchored bars.
   *
   * Bar width = RAW position in league range (bigger number = longer bar).
   * Bar color = QUALITY (lower_better-aware).
   *
   * So a defense allowing 39.5 pts/g (league worst) gets a long bar in a
   * BAD color. A defense allowing 9.3 pts/g (league best) gets a short
   * bar in a GOOD color. Width and color carry separate signals.
   */
  function renderStatRow(row) {
    const a = row.away;
    const h = row.home;
    const aDisplay = row.away_display ?? (a != null ? String(a) : '—');
    const hDisplay = row.home_display ?? (h != null ? String(h) : '—');
    const lead = row.lead; // "away" | "home" | "tie" | null

    const aLead = lead === 'away';
    const hLead = lead === 'home';

    // Compute value-anchored bar width + quality color per side.
    const aBar = computeBar(a, row);
    const hBar = computeBar(h, row);

    return `
      <div class="numbers-row">
        <div class="numbers-row-val away ${aLead ? 'lead' : ''} ${a == null ? 'missing' : ''}">${escape(aDisplay)}</div>
        <div class="numbers-row-track away">
          <div class="numbers-row-fill away ${aBar.qual}" style="width:${aBar.width}%;"></div>
        </div>
        <div class="numbers-row-label">${escape(row.label)}</div>
        <div class="numbers-row-track home">
          <div class="numbers-row-fill home ${hBar.qual}" style="width:${hBar.width}%;"></div>
        </div>
        <div class="numbers-row-val home ${hLead ? 'lead' : ''} ${h == null ? 'missing' : ''}">${escape(hDisplay)}</div>
      </div>
    `;
  }

  /**
   * Compute bar width (0-100%) and quality class for a single value.
   *
   * Width tracks RAW position in the league range.
   *   - League min  → 0% bar
   *   - League max  → 100% bar
   * Width does NOT care about lower_better. Bigger number = longer bar.
   * Always.
   *
   * Color tracks QUALITY in 5 tiers. Lower_better-aware.
   *   - elite      (top 20%)
   *   - above-avg  (60–80%)
   *   - mid        (40–60%)
   *   - below-avg  (20–40%)
   *   - poor       (bottom 20%)
   *
   * So a defense allowing the most points/game in FBS gets a LONG bar
   * in a BAD color. A defense allowing the fewest points gets a SHORT
   * bar in a GOOD color. The eye stops fighting "big number = small bar"
   * and the color tells you whether big is good or bad.
   */
  function computeBar(value, row) {
    if (value == null) return { width: 0, qual: 'missing' };
    const min = row.league_min;
    const max = row.league_max;
    const lowerBetter = row.lower_better;

    if (min == null || max == null || min === max) {
      // No league context — render a fixed half-width neutral bar
      return { width: 30, qual: 'below-avg' };
    }

    // rawPct: 0% = league min, 100% = league max. Used for WIDTH.
    let rawPct = ((value - min) / (max - min)) * 100;
    rawPct = clamp(rawPct, 0, 100);

    // qualityPct: 0% = league worst, 100% = league best. Used for COLOR.
    const qualityPct = lowerBetter ? (100 - rawPct) : rawPct;

    // Bar width tracks raw value. Minimum visible bar even at league min.
    const width = Math.max(4, Math.round(rawPct));

    let qual;
    if (qualityPct >= 80)      qual = 'elite';
    else if (qualityPct >= 60) qual = 'above-avg';
    else if (qualityPct >= 40) qual = 'mid';
    else if (qualityPct >= 20) qual = 'below-avg';
    else                       qual = 'poor';

    return { width, qual };
  }

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  /* ───────────────────────────────────────────────────────────
   * The Series
   * ─────────────────────────────────────────────────────────── */

  function renderSeries(data) {
    const s = data.series;
    if (!s || !s.games || !s.games.length) {
      els.seriesSection.style.display = 'none';
      return;
    }
    els.seriesSection.style.display = '';
    els.seriesSummary.textContent = s.summary || '';
    els.seriesList.innerHTML = (s.games || []).map(g => {
      const score = `${escape(g.home_team)} ${g.home_points}, ${escape(g.away_team)} ${g.away_points}`;
      return `
        <div class="series-row">
          <div class="series-year">${escape(g.year ?? '')}</div>
          <div class="series-score">${score}</div>
        </div>
      `;
    }).join('');
  }

  /* ───────────────────────────────────────────────────────────
   * Util
   * ─────────────────────────────────────────────────────────── */

  function escape(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* ───────────────────────────────────────────────────────────
   * Boot
   * ─────────────────────────────────────────────────────────── */

  async function boot() {
    const gameId = getGameId();
    if (!gameId) {
      showState('notfound');
      return;
    }

    showState('loading');

    // Subscriber gate
    const token = await checkAuth();
    if (!token) {
      showState('paywall');
      return;
    }

    let data;
    try {
      data = await fetchBreakdown(gameId, token);
    } catch (e) {
      console.error('fetch failed:', e);
      showState('error');
      return;
    }

    if (data.notFound) {
      showState('notfound');
      return;
    }

    // Render everything
    try {
      renderHero(data);
      renderStoryline(data);
      renderRead(data);
      renderPicks(data);
      renderNumbers(data);
      renderSeries(data);
    } catch (e) {
      console.error('render failed:', e);
      showState('error');
      return;
    }

    showState('content');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
