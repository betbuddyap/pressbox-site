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
    'A+':           'tier-aplus', // corroborated — ink bg, gold text
    'A':            'tier-a',   // gold
    'B':            'tier-b',   // silver
    'C':            'tier-c',   // bronze
    'smart_money':  'tier-sm',
    'goldilocks':   'tier-gl',
    'lottery':      'tier-ls',
    'ml_pickem':    'tier-aplus', // A+ ML expression rides the A+ treatment
    'no_edge':      'tier-no-edge',
  };
  const TIER_DISPLAY = {
    'A+':           'A+',
    'A':            'A',
    'B':            'B',
    'C':            'C',
    'smart_money':  'Smart Money',
    'goldilocks':   'Goldilocks',
    'lottery':      'Lottery',
    'ml_pickem':    'A+ Moneyline',
    'no_edge':      'No Edge',
  };
  const MARKET_DISPLAY = {
    'spread':    'Spread',
    'total':     'Total',
    'ml':        'Moneyline',
    'moneyline': 'Moneyline',
  };
  const MODEL_ORDER = ['SP+', 'Elo', 'PPA', 'Advanced', 'Pace+'];

  // Map between picks-engine model keys and chart display names.
  // Backend's firing_model field uses raw keys (sp_plus, elo, etc.).
  // Chart points use display names (SP+, Elo, etc.). When highlighting
  // the model that fired a cell, we match keys to display names here.
  const MODEL_KEY_TO_NAME = {
    sp_plus:  'SP+',
    elo:      'Elo',
    ppa:      'PPA',
    advanced: 'Advanced',
    tempo:    'Pace+',
  };

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
    pgLive:           $('pgLive'),
    pgLiveClock:      $('pgLiveClock'),
    pgLiveAwayName:   $('pgLiveAwayName'),
    pgLiveAwayNum:    $('pgLiveAwayNum'),
    pgLiveHomeName:   $('pgLiveHomeName'),
    pgLiveHomeNum:    $('pgLiveHomeNum'),
    pgLiveSituation:  $('pgLiveSituation'),
    pgLiveLastPlay:   $('pgLiveLastPlay'),
    preGame:   $('preGameContent'),
    projected: $('ctxProjected'),
    projAway:  $('ctxProjAway'),
    projHome:  $('ctxProjHome'),
    projAwayLbl: $('ctxProjAwayLbl'),
    projHomeLbl: $('ctxProjHomeLbl'),
    meta:      $('ctxMeta'),

    // Sections (4-beat layout)
    dnaStrip:       $('dnaStrip'),
    beat1Stack:     $('beat1Stack'),
    beat2Stack:     $('beat2Stack'),
    beat3Stack:     $('beat3Stack'),
    receiptStack:   $('receiptStack'),
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

    // Grade strip — one current-look badge per market (replaces the old
    // single-tier corner ribbon). Beat order: moneyline, spread, total.
    const gradePicks = {};
    (data.picks || []).forEach(p => { if (!gradePicks[p.market]) gradePicks[p.market] = p; });
    const gradesHtml = ['moneyline', 'spread', 'total']
      .filter(mk => gradePicks[mk])
      .map(mk => {
        const p = gradePicks[mk];
        return `<div class="ctx-grade">` +
               `<span class="ctx-grade-mkt">${escape(MARKET_DISPLAY[mk] || mk)}</span>` +
               llBadge(p.tier, p.bolt) + `</div>`;
      }).join('');
    els.ribbon.outerHTML = gradesHtml
      ? `<div class="ctx-grades" id="ctxRibbon">${gradesHtml}</div>`
      : `<div id="ctxRibbon"></div>`;
    document.getElementById('ctxHero')?.classList.toggle('has-grades', !!gradesHtml);

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

    // Score state: live / final / upcoming. Each state shows ONE of
    // pgLive (hero broadcast block), pgScore (final-score block),
    // preGameContent (projected-score block). Others are hidden.
    const isLive  = g.status === 'in_progress';
    const isFinal = g.status === 'final' && g.away_points != null && g.home_points != null;

    if (isLive) {
      els.pgLive.style.display = '';
      els.pgScore.style.display = 'none';
      els.preGame.style.display = 'none';
      renderLiveHero(data);
    } else if (isFinal) {
      els.pgLive.style.display = 'none';
      els.pgScore.style.display = '';
      els.pgAway.textContent = g.away_points;
      els.pgHome.textContent = g.home_points;
      const awayWon = g.away_points > g.home_points;
      els.pgAway.classList.toggle('loser', !awayWon && g.away_points !== g.home_points);
      els.pgHome.classList.toggle('loser',  awayWon && g.away_points !== g.home_points);
      els.preGame.style.display = 'none';
    } else {
      els.pgLive.style.display = 'none';
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

  // ────── LIVE HERO BLOCK ──────
  // Populates the pg-live broadcast hero with ESPN-sourced live data.
  // Score, possession ball next to team with the ball, period+clock,
  // down/distance/yard-line, last play description.
  function renderLiveHero(data) {
    const g = data.game;
    if (!els.pgLive) return;

    const period = g.current_period;
    const clock  = g.current_clock;
    let periodLabel = '';
    if (period) periodLabel = period <= 4 ? `Q${period}` : `OT${period - 4}`;
    const clockLine = [periodLabel, clock].filter(Boolean).join(' · ');
    els.pgLiveClock.textContent = clockLine || '';

    const awayName = g.away?.team || '';
    const homeName = g.home?.team || '';
    const possessionTeam = g.current_possession_team || '';
    const awayHasBall = possessionTeam === awayName;
    const homeHasBall = possessionTeam === homeName;
    const ballHTML = '<span class="pg-live-ball" title="Possession">●</span>';

    els.pgLiveAwayName.innerHTML = escape(awayName.toUpperCase()) +
      (awayHasBall ? ' ' + ballHTML : '');
    els.pgLiveHomeName.innerHTML = (homeHasBall ? ballHTML + ' ' : '') +
      escape(homeName.toUpperCase());

    const awayPts = g.away_points;
    const homePts = g.home_points;
    els.pgLiveAwayNum.textContent = awayPts != null ? awayPts : '—';
    els.pgLiveHomeNum.textContent = homePts != null ? homePts : '—';

    // Loser-dim
    if (awayPts != null && homePts != null && awayPts !== homePts) {
      const awayWinning = awayPts > homePts;
      els.pgLiveAwayNum.classList.toggle('loser', !awayWinning);
      els.pgLiveHomeNum.classList.toggle('loser',  awayWinning);
    } else {
      els.pgLiveAwayNum.classList.remove('loser');
      els.pgLiveHomeNum.classList.remove('loser');
    }

    // Down + distance + yard line
    const down = g.current_down;
    const distance = g.current_distance;
    const yardLine = g.current_yard_line;
    let situation = '';
    if (down && distance != null) {
      const ord = ({1:'1st', 2:'2nd', 3:'3rd', 4:'4th'})[down] || `${down}th`;
      const distText = distance === 0 ? 'goal' : distance;
      situation = `${ord} & ${distText}`;
      if (yardLine) situation += ` · ${yardLine}`;
    } else if (yardLine) {
      situation = yardLine;
    }
    els.pgLiveSituation.textContent = situation;

    // Last play description
    const lastPlay = g.last_play_text;
    if (lastPlay) {
      els.pgLiveLastPlay.style.display = '';
      els.pgLiveLastPlay.textContent = lastPlay;
    } else {
      els.pgLiveLastPlay.style.display = 'none';
    }

    // Red-zone highlight on the hero block
    if (g.is_red_zone) {
      els.pgLive.classList.add('red-zone');
    } else {
      els.pgLive.classList.remove('red-zone');
    }
  }

  // Map market -> firing model DISPLAY name, from picks data. A null
  // firing_model means no cell fired for that market (no highlight, no override).
  function firingModelByMarket(data) {
    const out = {};
    (data.picks || []).forEach(pick => {
      if (pick.firing_model) {
        const dn = MODEL_KEY_TO_NAME[pick.firing_model];
        if (dn) out[pick.market] = dn;
      }
    });
    return out;
  }

  // The value to drive a projection axis: the firing model's read when a cell
  // fired for that market, otherwise the aggregate blend. Spread and total are
  // resolved independently so the projected score never contradicts the pick.
  function projAxisValue(section, key, firingName, blendVal) {
    if (firingName && section) {
      const m = (section.models || []).find(mm => mm.name === firingName && mm[key] != null);
      if (m) return m[key];
    }
    return blendVal;
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
    // Projected score sources, per market (Austin's rule: the hero must
    // reflect the picks): a GRADED pick projects from its fired signal's
    // historical outcome mean — pick-side frame, so an Under pick's mean
    // lands under the number by construction. No graded pick → the old
    // firing-model / blend chain.
    const pkByMkt = {};
    (data.picks || []).forEach(pk => { if (!pkByMkt[pk.market]) pkByMkt[pk.market] = pk; });
    const ruleMean = (sec, pk) =>
      (pk && pk.tier && pk.tier !== 'no_edge'
       && sec?.historical_range?.source === 'rule'
       && sec.historical_range.mean != null)
        ? sec.historical_range.mean : null;
    const spreadRuleMean = ruleMean(p.spread, pkByMkt.spread);
    const totalRuleMean  = ruleMean(p.total,  pkByMkt.total);

    const firing = firingModelByMarket(data);
    const effAnchorSpread = spreadRuleMean ?? projAxisValue(p.spread, 'anchor_spread', firing.spread, blendAnchorSpread);
    const effTotal        = totalRuleMean  ?? projAxisValue(p.total,  'total',        firing.total,  blendTotal);

    // Convert anchor spread back to home margin:
    //   if anchor is home: home_margin = -anchor_spread
    //   if anchor is away: home_margin = anchor_spread
    let homeMargin = anchorIsHome ? -effAnchorSpread : effAnchorSpread;

    // A graded ML pick NAMES a winner — the hero must never contradict it
    // (Austin's rule). Clamp the margin to a minimal win when the blend
    // leans the other way.
    const mlPk = pkByMkt.moneyline;
    if (mlPk && mlPk.tier && mlPk.tier !== 'no_edge') {
      const s = mlPk.history?.current?.side_raw;
      if (s === 'home' && homeMargin <= 0) homeMargin = 1;
      if (s === 'away' && homeMargin >= 0) homeMargin = -1;
    }

    const homePts = (effTotal + homeMargin) / 2;
    const awayPts = (effTotal - homeMargin) / 2;

    // Rounding can collapse a small margin into a displayed TIE (22.15 /
    // 21.85 -> 22-22). CFB has no ties — break toward the projected winner
    // (the ML pick's side when graded, else the margin's sign).
    let rHome = Math.round(homePts);
    let rAway = Math.round(awayPts);
    if (rHome === rAway) {
      const mlSide = (mlPk && mlPk.tier && mlPk.tier !== 'no_edge')
        ? mlPk.history?.current?.side_raw : null;
      const homeWins = mlSide ? mlSide === 'home' : homeMargin >= 0;
      if (homeWins) rHome += 1; else rAway += 1;
    }
    els.projAway.textContent = rAway;
    els.projHome.textContent = rHome;
    els.projAwayLbl.textContent = data.game?.away?.name || '';
    els.projHomeLbl.textContent = data.game?.home?.name || '';

    // Caption the projection with its source; when a market still runs on
    // the blend and a graded pick fades it, say so explicitly so the hero
    // never silently contradicts the pick cards below (Austin's rule).
    const usedSignal = spreadRuleMean != null || totalRuleMean != null;
    const conflicts = [];
    const tPick = pkByMkt.total, vTot = p.total?.vegas_line;
    if (tPick && tPick.tier !== 'no_edge' && vTot != null) {
      const s = tPick.history?.current?.side_raw;
      if ((s === 'under' && effTotal > vTot) || (s === 'over' && effTotal < vTot)) {
        conflicts.push(`the graded ${s === 'under' ? 'Under' : 'Over'} ${vTot} fades this total`);
      }
    }
    const sPick = pkByMkt.spread, vAnch = p.spread?.vegas_anchor_spread;
    if (sPick && sPick.tier !== 'no_edge' && vAnch != null) {
      const s = sPick.history?.current?.side_raw;   // 'home' | 'away'
      const vegasHomeMargin = anchorIsHome ? -vAnch : vAnch;
      const agrees = s === 'home' ? homeMargin > vegasHomeMargin
                   : s === 'away' ? homeMargin < vegasHomeMargin : true;
      if (!agrees) conflicts.push('the graded spread pick fades this margin');
    }
    let noteEl = document.getElementById('projBlendNote');
    if (!noteEl) {
      noteEl = document.createElement('div');
      noteEl.id = 'projBlendNote';
      noteEl.className = 'proj-blend-note';
      els.projected.appendChild(noteEl);
    }
    noteEl.textContent = conflicts.length
      ? `Model blend — ${conflicts.join('; ')}. Graded signals outrank the blend.`
      : usedSignal
      ? 'Projected from the fired signals’ historical outcomes'
      : 'Model blend';

    // Winner emphasis follows the DISPLAYED scores (tie-break included).
    if (rAway > rHome) {
      els.projAway.classList.add('winner');
      els.projHome.classList.remove('winner');
    } else if (rHome > rAway) {
      els.projHome.classList.add('winner');
      els.projAway.classList.remove('winner');
    }

    els.projected.style.display = '';
  }

  /* ───────────────────────────────────────────────────────────
   * Storyline
   * ─────────────────────────────────────────────────────────── */

  // Entry-type labels for the timeline chips
  const ENTRY_TYPE_LABEL = {
    'release':             '',                  // release is the lede; no chip
    'tier_change':         'Tier change',
    'side_flip':           'Lean flip',
    'firing_model_change': 'Firing model change',
    'line_movement':       'Line movement',
    'gameday':             'Daily check-in',
  };

  function formatEntryDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    // "Wednesday, May 29"
    const opts = { weekday: 'long', month: 'long', day: 'numeric' };
    return d.toLocaleDateString('en-US', opts);
  }

  function renderStoryline(data) {
    const n = data.narrative || {};
    const entries = Array.isArray(n.entries) ? n.entries : [];

    // Timeline path — preferred when entries exist
    if (entries.length > 0) {
      renderStorylineTimeline(entries);
      return;
    }

    // Legacy single-blurb fallback (no timeline rows yet)
    if (!n.text) {
      els.storylineText.innerHTML = '<p style="color:var(--text-light);font-style:italic;">No editorial read available for this game.</p>';
      els.storylineMeta.textContent = '';
      els.storylineLede.style.display = 'none';
      return;
    }
    const usePostGame = data.game?.status === 'final' && n.post_game_text;
    const text = usePostGame ? n.post_game_text : n.text;
    const paragraphs = text
      .split(/\n\n+/)
      .map(p => p.trim())
      .filter(Boolean)
      .map(p => fixEncoding(p));
    els.storylineText.innerHTML = paragraphs.map(p =>
      `<p>${escape(p)}</p>`
    ).join('');
    const metaParts = [];
    if (n.generated_at) {
      metaParts.push(`Generated ${timeAgo(n.generated_at)}.`);
    }
    if (n.last_input_change && n.generated_at &&
        new Date(n.last_input_change) > new Date(n.generated_at)) {
      metaParts.push(`<span class="stale-warn">⚠ Lines have moved since this was written.</span>`);
    }
    els.storylineMeta.innerHTML = metaParts.join(' ');
    els.storylineLede.style.display = 'none';
  }

  /**
   * Render the running-editorial timeline.
   *
   * Layout: a vertical connecting bar runs down the side. Each entry is
   * a "node" on the bar with a dot at the date. The original release
   * entry sits at top with full body. Newest entries directly below.
   * After the first 2 entries (release + most-recent follow-up), the
   * rest collapse behind a "View earlier entries" toggle.
   *
   * Entries arrive oldest-first from the backend; we keep that order
   * so the release is at top and the chronology reads downward.
   */
  function renderStorylineTimeline(entries) {
    // Hide legacy meta line; the timeline has its own per-entry dates
    els.storylineMeta.innerHTML = '';
    els.storylineLede.style.display = 'none';

    // Split: release entry (or first entry if none is tagged release)
    // and the rest.
    const releaseIdx = entries.findIndex(e => e.entry_type === 'release');
    const release = releaseIdx >= 0 ? entries[releaseIdx] : entries[0];
    const others = entries.filter(e => e !== release);

    // Show release + most-recent follow-up by default; collapse the
    // rest behind a toggle. "Most recent" is the last in chronological
    // order since entries are oldest-first.
    const visible = [];
    const hidden = [];
    if (others.length === 0) {
      // Just the release
    } else if (others.length === 1) {
      visible.push(others[0]);
    } else {
      // Show the most-recent follow-up; hide the older follow-ups
      // (which are everything BETWEEN release and the latest).
      visible.push(others[others.length - 1]);
      for (let i = 0; i < others.length - 1; i++) {
        hidden.push(others[i]);
      }
    }

    const html = [];
    html.push('<div class="storyline-timeline">');

    html.push(renderEntryNode(release, /*isLede*/true));

    if (hidden.length > 0) {
      html.push(
        `<div class="storyline-collapse-toggle" data-state="closed" role="button" tabindex="0">` +
        `View ${hidden.length} earlier ${hidden.length === 1 ? 'entry' : 'entries'}` +
        `</div>`
      );
      html.push('<div class="storyline-hidden" hidden>');
      hidden.forEach(e => html.push(renderEntryNode(e, false)));
      html.push('</div>');
    }

    visible.forEach(e => html.push(renderEntryNode(e, false)));

    html.push('</div>');
    els.storylineText.innerHTML = html.join('');

    // Wire collapse toggle
    const toggle = els.storylineText.querySelector('.storyline-collapse-toggle');
    if (toggle) {
      const hiddenEl = els.storylineText.querySelector('.storyline-hidden');
      const handler = () => {
        const isOpen = toggle.dataset.state === 'open';
        toggle.dataset.state = isOpen ? 'closed' : 'open';
        if (hiddenEl) hiddenEl.hidden = isOpen;
        toggle.textContent = isOpen
          ? `View ${hidden.length} earlier ${hidden.length === 1 ? 'entry' : 'entries'}`
          : `Hide earlier entries`;
      };
      toggle.addEventListener('click', handler);
      toggle.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          handler();
        }
      });
    }
  }

  function renderEntryNode(entry, isLede) {
    if (!entry) return '';
    const dateLabel = formatEntryDate(entry.written_at);
    const typeLabel = ENTRY_TYPE_LABEL[entry.entry_type] || '';
    const body = (entry.body || '')
      .split(/\n\n+/)
      .map(p => fixEncoding(p.trim()))
      .filter(Boolean)
      .map(p => `<p>${escape(p)}</p>`)
      .join('');

    return `
      <div class="storyline-entry${isLede ? ' is-lede' : ''}">
        <div class="storyline-entry-marker"></div>
        <div class="storyline-entry-content">
          <div class="storyline-entry-head">
            <span class="storyline-entry-date">${escape(dateLabel)}</span>
            ${typeLabel ? `<span class="storyline-entry-type">${escape(typeLabel)}</span>` : ''}
          </div>
          <div class="storyline-entry-body">${body}</div>
        </div>
      </div>
    `;
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

    // Market → firing_model display name (shared with the projected-score
    // header so the highlighted read and the projection stay in lockstep).
    const firingByMarket = firingModelByMarket(data);

    const anchor = p.anchor || {};
    if (p.spread)    els.readStack.appendChild(buildDotPlot('Spread', p.spread, 'anchor_spread', anchor, firingByMarket.spread));
    if (p.total)     els.readStack.appendChild(buildDotPlot('Total',  p.total,  'total', anchor, firingByMarket.total));
    if (p.moneyline) els.readStack.appendChild(buildMLRows(data, p.moneyline, anchor, firingByMarket.moneyline));
  }

  /* ───────────────────────────────────────────────────────────
   * 4-BEAT LAYOUT — Matchup DNA, beats 1-3, The Receipt
   * ─────────────────────────────────────────────────────────── */

  function renderDNA(data) {
    const el = els.dnaStrip;
    if (!el) return;
    const d = data.dna;
    if (!d || !Object.keys(d).length) { el.style.display = 'none'; return; }
    const away = data.game?.away?.name || 'Away';
    const home = data.game?.home?.name || 'Home';
    const sideName = s => (s === 'home' ? home : away);
    const item = (k, m) => {
      const mag = Math.max(4, Math.min(46, Math.abs(m.sigma) * 24));
      const left = m.side === 'home' ? 50 : 50 - mag;
      const v = m.label === 'even'
        ? '<b>even</b>'
        : `<b>${escape(sideName(m.side))}</b> · ${escape(m.label)}`;
      return `<div class="dna-item"><div class="dna-k">${k}</div>` +
             `<div class="dna-bar"><i style="left:${left}%;width:${mag}%"></i></div>` +
             `<div class="dna-v">${v}</div></div>`;
    };
    const items = [];
    if (d.talent)        items.push(item('Talent', d.talent));
    if (d.trench)        items.push(item('Trenches', d.trench));
    if (d.explosiveness) items.push(item('Explosiveness', d.explosiveness));
    if (d.efficiency)    items.push(item('Efficiency', d.efficiency));
    if (d.pace) {
      // Bar anchored at center like the team bars — extends right = faster
      // than FBS average, left = slower. Tiny bar at center reads "average".
      const mag = Math.max(4, Math.min(46, Math.abs(d.pace.sigma) * 24));
      const left = d.pace.sigma >= 0 ? 50 : 50 - mag;
      items.push(`<div class="dna-item"><div class="dna-k">Pace</div>` +
        `<div class="dna-bar"><i style="left:${left.toFixed(1)}%;width:${mag.toFixed(1)}%"></i></div>` +
        `<div class="dna-v"><b>${escape(d.pace.label)}</b> · ~${d.pace.plays} plays/team</div></div>`);
    }
    if (d.homefield) items.push(item('Home field', d.homefield));
    // Header anchors the bar directions: away team owns the left half,
    // home team the right — a bar leaning left = edge to the away side.
    el.innerHTML =
      `<div class="dna-head"><span>← ${escape(away)}</span>` +
      `<span class="dna-head-mid">Matchup DNA</span>` +
      `<span>${escape(home)} →</span></div>` +
      `<div class="dna-items">${items.join('')}</div>`;
    el.style.display = '';
  }

  function buildMLChart(data, ml, spreadSection, anchor, mlPick) {
    // The moneyline chart IS the spread chart recentered on ZERO (Austin's
    // spec): moneyline only asks who wins, and in margin space the win/lose
    // boundary is 0. Same axis, same curve, same dots — the divider moves
    // from the Vegas number to zero, and each dot's label shows that model's
    // win probability for the anchor side instead of its margin.
    const away = data.game?.away?.name || 'Away';
    const home = data.game?.home?.name || 'Home';
    const anchorIsHome = !!(anchor || {}).is_home;
    const anchorName = anchorIsHome ? home : away;
    const otherName  = anchorIsHome ? away : home;
    // Labels carry the HOME team's win% — the axis is hero-oriented (home
    // owns the right side), so bigger % sits further right, matching the dots.
    const probByName = {};
    (ml.models || []).forEach(m => {
      const hp = anchorIsHome ? m.anchor_prob : m.other_prob;
      if (hp != null) probByName[m.name] = `${Math.round(hp * 100)}%`;
    });
    const vg = ml.vegas_anchor_implied;
    const vegasHead = (vg != null)
      ? `Vegas: <strong>${escape(anchorName)} ${escape(ml.vegas_anchor_display || '')}</strong>` +
        ` <span class="read-card-vegas-price">(${Math.round(vg * 100)}% implied)</span>`
      : `<span class="read-card-vegas-pending">Moneyline pending</span>`;
    let note = '';
    const cal = ml.calibration;
    if (cal) {
      const favName = (ml.fav_is_anchor === false) ? otherName : anchorName;
      note = `History check: favorites priced like ${escape(favName)} won ` +
             `<b>${Math.round(cal.fav_win_rate * 100)}%</b> of the time ` +
             `(${cal.n} games, 2023–25).`;
    }
    // Blend dot: same gold marker as the spread chart (position = blend
    // margin), labeled with the blend's HOME win probability.
    const blendHomeProb = anchorIsHome ? ml.pressbox_anchor_prob : ml.pressbox_other_prob;
    const section = {
      models:           (spreadSection && spreadSection.models) || [],
      historical_range: ml.historical_range
                        || (spreadSection && spreadSection.historical_range) || null,
      pressbox_blend:   (spreadSection && spreadSection.pressbox_blend != null
                         && blendHomeProb != null)
                        ? spreadSection.pressbox_blend : null,
      pressbox_display: blendHomeProb != null ? `${Math.round(blendHomeProb * 100)}%` : null,
      vegas_display:    null,
    };
    return buildDotPlot(`Moneyline — chance ${home} wins`, section, 'anchor_spread',
                        anchor, null, mlPick,
                        { ml: { vegasHead, probByName, note,
                                ends: [`${away} wins`, `${home} wins`] } });
  }

  function buildTally(p) {
    const det = p.voter_details || [];
    if (!det.length) return null;
    const detAgainst = p.voter_details_against || [];
    // Counts derive from the chip lists when the against side is known —
    // one source of truth, so the headline always matches the chips shown.
    const against = detAgainst.length
      || Math.max(0, det.length - (p.net_votes != null ? p.net_votes : det.length));
    const net = det.length - against;
    const wrap = document.createElement('div');
    wrap.className = 'game-card tally-card';
    const chip = (v, mod, tipText) => {
      const tip = tipText ? ` title="${tipText}"` : '';
      return `<span class="vchip vchip--${escape(v.family)}${mod || ''}"${tip}>` +
             `<span class="vsq"></span>${escape(v.label)}</span>`;
    };
    const chips = det.map(v => chip(v, '', v.family === 'counter'
      ? 'Counter-signal: one of our own reads leans the other way — in a spot where it has been reliably wrong, so its lean counts FOR this side.'
      : '')).join('');
    // Opposing signals get NAMED, muted chips — they explain the net math
    // (2 for, 1 against = net 1 = C) and they're graded in the ledger like
    // every other fire. Legacy payloads without ids fall back to the count.
    const oppChips = detAgainst.length
      ? detAgainst.map(v => chip(v, ' vchip--against',
          'Opposing signal: voted the other side of this market — it subtracts from the net.')).join('')
      : `<span class="vopp">${against
          ? against + ' opposing signal' + (against > 1 ? 's' : '')
          : 'no opposing signals'}</span>`;
    wrap.innerHTML =
      `<div class="tally-grid">` +
      `<div class="vchips">${chips}</div>` +
      `<div class="tally-net"><div class="n">${det.length}–${against}</div>` +
      `<div class="k">net ${net} · ${escape(p.tier_display || p.tier || '')}</div></div>` +
      `<div class="vchips vchips--right">${oppChips}</div>` +
      `</div>`;
    return wrap;
  }

  function renderBeats(data) {
    const proj = data.projections || {};
    const anchor = proj.anchor || {};
    const awayN = data.game?.away?.name || 'Away';
    const homeN = data.game?.home?.name || 'Home';
    const byMkt = {};
    (data.picks || []).forEach(p => { byMkt[p.market] = p; });

    if (els.beat1Stack) {
      els.beat1Stack.innerHTML = '';
      if (byMkt.moneyline) els.beat1Stack.appendChild(buildPickArticle(byMkt.moneyline));
      if (proj.moneyline)  els.beat1Stack.appendChild(
        buildMLChart(data, proj.moneyline, proj.spread, anchor, byMkt.moneyline));
      // ML expressions ride the A+ spread's voters — show the tally here too
      // so a banded ML pick names the signals behind it.
      if (byMkt.moneyline) { const t = buildTally(byMkt.moneyline); if (t) els.beat1Stack.appendChild(t); }
    }
    if (els.beat2Stack) {
      els.beat2Stack.innerHTML = '';
      if (byMkt.spread) els.beat2Stack.appendChild(buildPickArticle(byMkt.spread));
      if (proj.spread)  els.beat2Stack.appendChild(buildDotPlot('Spread', proj.spread, 'anchor_spread', anchor, null, byMkt.spread, { ends: [awayN, homeN] }));
      if (byMkt.spread) { const t = buildTally(byMkt.spread); if (t) els.beat2Stack.appendChild(t); }
    }
    if (els.beat3Stack) {
      els.beat3Stack.innerHTML = '';
      if (byMkt.total) els.beat3Stack.appendChild(buildPickArticle(byMkt.total));
      if (proj.total)  els.beat3Stack.appendChild(buildDotPlot('Total', proj.total, 'total', anchor, null, byMkt.total, { ends: ['Under', 'Over'] }));
      if (byMkt.total) { const t = buildTally(byMkt.total); if (t) els.beat3Stack.appendChild(t); }
    }
  }

  function opiBox(name, o) {
    if (!o || o.score == null) {
      return `<div class="opi-box"><div class="t">${escape(name)}</div>` +
             `<div class="s">Not enough games yet — the index starts after three played.</div></div>`;
    }
    const bandTxt = {
      hot_hype:    'running hot — the market historically overprices this band',
      hot_breakout:'breakout pace — keeps beating projections',
      cold_deep:   'deep cold — the market historically over-fades this band',
      cold_mild:   'mildly under projection',
    }[o.band] || 'playing to projection';
    const mag = Math.max(3, Math.min(46, Math.abs(o.score) * 5));
    const left = o.score >= 0 ? 50 : 50 - mag;
    return `<div class="opi-box"><div class="t">${escape(name)}</div>` +
           `<div class="opi-bar"><i style="left:${left}%;width:${mag}%"></i></div>` +
           `<div class="s"><b>${o.score > 0 ? '+' : ''}${o.score}/gm</b> vs projection ` +
           `over ${o.games} games · ${bandTxt}</div></div>`;
  }

  function renderReceipt(data) {
    const el = els.receiptStack;
    if (!el) return;
    el.innerHTML = '';
    const away = data.game?.away?.name || 'Away';
    const home = data.game?.home?.name || 'Home';
    if (data.opi) {
      const box = document.createElement('div');
      box.className = 'game-card';
      box.innerHTML = `<div class="receipt-eyebrow">Form vs our projections — the Overperformance Index</div>` +
        `<div class="opi-grid">${opiBox(home, data.opi.home)}${opiBox(away, data.opi.away)}</div>`;
      el.appendChild(box);
    }
    // UNION of every signal that voted on this game — all three markets,
    // BOTH sides (against-voters count; they explain the nets).
    const seen = {};
    const addSig = v => { if (v && v.id && !seen[v.id]) seen[v.id] = v; };
    (data.picks || []).forEach(p => {
      (p.voter_details || []).forEach(addSig);
      (p.voter_details_against || []).forEach(addSig);
    });
    const sigs = Object.values(seen);
    if (sigs.length) {
      const box = document.createElement('div');
      box.className = 'game-card';
      box.innerHTML = `<div class="receipt-eyebrow">The signals behind this game</div>` +
        `<table class="sig-table"><thead><tr><th>Signal</th><th>Family</th><th>2026 record</th></tr></thead><tbody>` +
        sigs.map(v => `<tr data-rule="${escape(v.id)}"><td>${escape(v.label)}</td>` +
          `<td>${escape(v.family)}</td><td class="sig-rec">—</td></tr>`).join('') +
        `</tbody></table>` +
        `<div class="receipt-hash">Every signal above was pre-registered and sealed before the season ` +
        `— nothing added, nothing curated. Verify: <code>sha256 e4776fd1…3a145e</code> (spread/total) · ` +
        `<code>fdc3bf0c…c73104</code> (moneyline) · ` +
        `<a href="${API_BASE}/canonical/ledger.csv?season=2026">full ledger CSV ↗</a></div>`;
      el.appendChild(box);
      fillSigRecords(box);
    }
  }

  async function fillSigRecords(box) {
    try {
      const res = await fetch(`${API_BASE}/canonical/ledger?season=2026`);
      const j = await res.json();
      const last = {};
      (j.rows || []).forEach(r => {
        if (r.line && r.line.indexOf('rule:') === 0) last[r.line.slice(5)] = r;
      });
      box.querySelectorAll('tr[data-rule]').forEach(tr => {
        const r = last[tr.getAttribute('data-rule')];
        tr.querySelector('.sig-rec').textContent = r
          ? `${r.running_wins}–${r.running_losses} (${r.running_pct != null ? r.running_pct + '%' : '—'})`
          : '0–0 · frozen Aug 5';
      });
    } catch (e) { /* records stay as dashes */ }
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
  function buildDotPlot(label, section, key, anchor, firingModel, pick, opts) {
    const card = document.createElement('div');
    card.className = 'read-card';

    // ML mode (opts.ml): the SAME margin chart recentered on ZERO — moneyline
    // only asks who wins, and in margin space the win/lose boundary is 0.
    // Dots stay at each model's projected margin; labels show win probability.
    const ml = (opts && opts.ml) || null;
    // HERO ORIENTATION (site rule): the page's left side belongs to the away
    // team, the right to the home team — every chart follows the hero. The
    // backend serves spreads in ANCHOR frame (anchor = the favorite), so when
    // the anchor is the HOME team the whole axis mirrors (x -> -x) into
    // home-margin space: right of zero = home wins/covers by more.
    // GEOMETRY flips into hero space; PRINTED NUMBERS stay in betting
    // convention (Vegas favorite is always negative — site rule), i.e. the
    // anchor-frame quotes: tick labels negate back under heroFlip and dot
    // labels keep their backend quote strings.
    const heroFlip = key === 'anchor_spread' && !!(anchor && anchor.is_home);
    const hv   = v => (v == null ? null : (heroFlip ? -v : v));
    const vegasPos     = ml ? 0
                        : key === 'anchor_spread' ? hv(section.vegas_anchor_spread) : section.vegas_line;
    // When a graded pick exists, suppress the aggregate blend dot — the pick
    // came from the ladder's votes, not the blend; the gold zone marks the
    // side instead, so the chart and verdict tell one story.
    const hasPick      = !!(pick && pick.tier && pick.tier !== 'no_edge');
    const blendRaw     = (firingModel || hasPick) ? null : section.pressbox_blend;
    const blendPos     = key === 'anchor_spread' ? hv(blendRaw) : blendRaw;
    const blendDisplay = section.pressbox_display;
    const vegasDisplay = section.vegas_display;

    // Optional Vegas price tag. e.g. "Vegas: TCU -2.5 (-110)"
    // For spread: anchor side's price. For total: over price.
    let vegasPriceDisplay = '';
    if (key === 'anchor_spread' && section.vegas_anchor_price_display) {
      vegasPriceDisplay = section.vegas_anchor_price_display;
    } else if (key === 'total' && section.vegas_over_price_display) {
      vegasPriceDisplay = section.vegas_over_price_display;
    }

    // Collect model points
    const points = [];
    (section.models || []).forEach(m => {
      if (m[key] == null) return;
      const v = key === 'anchor_spread' ? hv(m[key]) : m[key];
      points.push({
        name:    m.name,
        value:   v,
        display: ml ? (ml.probByName[m.name] || m.display || String(m[key]))
                    : (m.display || String(m[key])),
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

    // Axis range — Vegas ± 13, padded by model values further out
    // BUT capped at Vegas ± 18 so one extreme model (e.g. Pace+ at -24
    // on a -1 game) doesn't stretch the entire chart. Out-of-range
    // dots will sit at the axis edge; the chart stays readable.
    const histRange = section.historical_range || null;
    const pickSideRaw = hasPick ? (pick.history?.current?.side_raw || null) : null;
    let histLow   = histRange?.low ?? null;
    let histHigh  = histRange?.high ?? null;
    if (heroFlip && histLow != null && histHigh != null) {
      const a = -histLow, b = -histHigh;
      histLow = Math.min(a, b); histHigh = Math.max(a, b);
    }
    // Frame the axis to FIT everything — model dots, Vegas, the blend, and the
    // outcome bubble — centered on the model cluster, so no read sits stranded
    // in empty space. A single wild model can't squash the rest: if the full
    // span exceeds MAX_SPAN, clamp to a window centered on the median model and
    // the outlier sits at the chart edge. (Most games fit inside MAX_SPAN.)
    const modelVals = points.map(p => p.value);
    const fitVals = [vegasPos, blendPos, histLow, histHigh, ...modelVals].filter(v => v != null);
    let loVal = Math.min(...fitVals);
    let hiVal = Math.max(...fitVals);
    const MAX_SPAN = 40;
    const sortedModels = modelVals.slice().sort((a, b) => a - b);
    const clusterCenter = sortedModels.length
      ? sortedModels[Math.floor(sortedModels.length / 2)]
      : (vegasPos != null ? vegasPos : (loVal + hiVal) / 2);
    if (hiVal - loVal > MAX_SPAN) {
      loVal = clusterCenter - MAX_SPAN / 2;
      hiVal = clusterCenter + MAX_SPAN / 2;
    }
    const pad = Math.max(3, (hiVal - loVal) * 0.14);
    let axisMin = loVal - pad;
    let axisMax = hiVal + pad;
    // Spread chart: always include 0 in the axis so the zero anchor is visible
    if (key === 'anchor_spread') {
      axisMin = Math.min(axisMin, -2);
      axisMax = Math.max(axisMax, 2);
    }
    // Pad outward to a clean tick
    // Tick step adapts to both the axis range AND the viewport. On a
    // narrow phone screen, even 3-pt ticks crowd into each other; bump
    // up to 6 or 10. On desktop with a wide chart, 3-pt is fine.
    const viewportPx = window.innerWidth || 1200;
    const isNarrow = viewportPx < 600;
    let tickStep;
    if (isNarrow) {
      // Fewer ticks on phones — each one needs ~50px to render its label
      tickStep = (axisMax - axisMin) > 30 ? 10 : (axisMax - axisMin) > 15 ? 6 : 3;
    } else {
      tickStep = (axisMax - axisMin) > 30 ? 5 : (axisMax - axisMin) > 15 ? 3 : 1;
    }
    axisMin = Math.floor(axisMin / tickStep) * tickStep;
    axisMax = Math.ceil(axisMax / tickStep) * tickStep;
    if (axisMax - axisMin < 4) {
      axisMin -= 2; axisMax += 2;
    }
    const range = axisMax - axisMin;
    const xPct = (v) => clamp(((v - axisMin) / range) * 100, 0, 100);

    // Header
    // Vegas line label. When the line isn't posted at enough books yet
    // (backend returns null), say so explicitly rather than rendering
    // "Vegas: —" which reads like a data problem.
    const vegasHeadHtml = ml ? ml.vegasHead
      : vegasDisplay
      ? `Vegas: <strong>${escape(vegasDisplay)}</strong>${vegasPriceDisplay ? ` <span class="read-card-vegas-price">(${escape(vegasPriceDisplay)})</span>` : ''}`
      : `<span class="read-card-vegas-pending">Vegas line pending</span>`;

    card.innerHTML = `
      <div class="read-card-head">
        <div class="read-card-label">${escape(label)}</div>
        <div class="read-card-vegas">${vegasHeadHtml}</div>
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

    // Picked-side geometry — which stretch of the axis cashes the pick.
    // Anchor-frame spreads: values MORE NEGATIVE than the line favor the
    // anchor side; totals: over cashes above the line, under below.
    // Rendered as a GRADIENT on the historical curve (gold side = we cash,
    // blue side = we don't); the flat gold zone is only the no-curve fallback.
    let pickZone = null;
    if (hasPick && vegasPos != null && pickSideRaw) {
      if (key === 'anchor_spread' && (pickSideRaw === 'home' || pickSideRaw === 'away')) {
        // Hero frame: right of the line = home covers/wins, left = away.
        pickZone = (pickSideRaw === 'home')
          ? { z0: xPct(vegasPos), z1: 100, goldLeft: false }
          : { z0: 0, z1: xPct(vegasPos), goldLeft: true };
      } else if (key === 'total' && (pickSideRaw === 'over' || pickSideRaw === 'under')) {
        pickZone = (pickSideRaw === 'over')
          ? { z0: xPct(vegasPos), z1: 100, goldLeft: false }
          : { z0: 0, z1: xPct(vegasPos), goldLeft: true };
      }
    }
    if (pickZone && pickZone.z1 - pickZone.z0 > 0
        && !((histRange?.density_curve || []).length >= 3)) {
      const zone = document.createElement('div');
      zone.className = 'strip-zone';
      zone.style.left = pickZone.z0 + '%';
      zone.style.width = (pickZone.z1 - pickZone.z0) + '%';
      zone.title = 'Where our pick cashes';
      axisEl.insertBefore(zone, axisEl.firstChild);
    }

    // Axis tick labels. Positions are hero-space; printed numbers are the
    // betting quote (negated back under heroFlip so the favorite's side
    // reads negative — "Memphis only has to lose by less than 5.5" means
    // the tick at UNLV's -5.5, never a +5.5).
    // The Vegas label lives in THIS row (at the tick, where the line meets
    // the scale) — never in the dot-label lanes, where it crowded them into
    // overlap. Tick numbers within its span are suppressed.
    const vegasTickLabel = (vegasPos != null && !ml && vegasDisplay);
    for (let t = Math.ceil(axisMin / tickStep) * tickStep; t <= axisMax; t += tickStep) {
      const tick = document.createElement('div');
      tick.className = 'strip-tick';
      tick.style.left = `${xPct(t)}%`;
      ticksEl.appendChild(tick);
      if (vegasTickLabel && Math.abs(xPct(t) - xPct(vegasPos)) < 7) continue;
      const lab = document.createElement('div');
      lab.className = 'strip-tick-label';
      if (key === 'anchor_spread' && t === 0) lab.classList.add('strip-tick-label-zero');
      lab.style.left = `${xPct(t)}%`;
      const dt = (heroFlip && t !== 0) ? -t : t;
      lab.textContent = (key === 'anchor_spread')
        ? (dt > 0 ? '+' + dt : dt)
        : dt;
      ticksEl.appendChild(lab);
    }
    if (vegasTickLabel) {
      const vLab = document.createElement('div');
      vLab.className = 'strip-tick-label strip-tick-label-vegas';
      vLab.style.left = `${xPct(vegasPos)}%`;
      vLab.textContent = `Vegas ${vegasDisplay}`;
      ticksEl.appendChild(vLab);
    }

    // Historical density curve — mirrored shape rendered as inline SVG.
    // The curve carries SHAPE (where outcomes pool); the y-values are
    // normalized to peak=1 by the backend so every game's curve renders
    // to the same pixel height. Drawn FIRST so it sits behind everything.
    let densityCurve = histRange?.density_curve || [];
    if (heroFlip && densityCurve.length) {
      densityCurve = densityCurve.map(([x, y]) => [-x, y]).sort((p, q) => p[0] - q[0]);
    }
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
      // Power exponent applied to the normalized density. y is already
      // in 0..1 with peak at 1. Raising to the power leaves the peak at
      // 1 but drops everything else toward 0 — sharpens the peak and
      // narrows the lobe visually. Pure visualization tweak; backend
      // density data unchanged.
      const POWER = 2.0;
      // Edge taper: ease the lobe height to 0 at its two ends so it comes to a
      // smooth point instead of cutting off flat at a non-zero height (the
      // "flat spots"). Tukey-style window — flat (=1) across the middle, cosine
      // ease-to-zero over the outer TAPER fraction of each side. Pure visual;
      // the backend density data is unchanged.
      const TAPER = 0.35;
      const NPTS = densityCurve.length;
      const edgeWindow = (p) => {
        if (p <= TAPER)     return 0.5 * (1 - Math.cos(Math.PI * p / TAPER));
        if (p >= 1 - TAPER) return 0.5 * (1 - Math.cos(Math.PI * (1 - p) / TAPER));
        return 1;
      };
      densityCurve.forEach(([x, y], i) => {
        const xv = clamp(((x - axisMin) / range) * VBW, 0, VBW);
        const p  = NPTS > 1 ? i / (NPTS - 1) : 0.5;
        const ySharp = Math.pow(clamp(y, 0, 1), POWER) * edgeWindow(p);
        const yPx = ySharp * PEAK_PX;
        topPts.push([xv, CENTER_Y - yPx]);
        botPts.push([xv, CENTER_Y + yPx]);
      });
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
      // Pick-aware two-tone: the curve keeps its shape, but the side of the
      // Vegas line where OUR PICK CASHES turns gold; the rest stays blue.
      // Hard gradient stop at the line — no mud, one element, real meaning.
      if (pickZone && vegasPos != null) {
        const gid = 'histgrad-' + (ml ? 'ml-' : '') + key + '-' + Math.round(xPct(vegasPos) * 10);
        const frac = Math.max(0, Math.min(1, xPct(vegasPos) / 100));
        const GOLD = 'rgba(184,146,42,0.30)', BLUE = 'rgba(76,124,168,0.18)';
        const L = pickZone.goldLeft ? GOLD : BLUE;
        const R = pickZone.goldLeft ? BLUE : GOLD;
        const defs = document.createElementNS(svgNS, 'defs');
        const grad = document.createElementNS(svgNS, 'linearGradient');
        grad.setAttribute('id', gid);
        // Anchor the gradient to the AXIS, not the path's bounding box —
        // otherwise the color boundary drifts off the Vegas tick whenever
        // the curve doesn't span the full viewBox width.
        grad.setAttribute('gradientUnits', 'userSpaceOnUse');
        grad.setAttribute('x1', '0');
        grad.setAttribute('y1', '0');
        grad.setAttribute('x2', String(VBW));
        grad.setAttribute('y2', '0');
        [[0, L], [frac, L], [frac, R], [1, R]].forEach(([off, col]) => {
          const st = document.createElementNS(svgNS, 'stop');
          st.setAttribute('offset', off);
          st.setAttribute('stop-color', col);
          grad.appendChild(st);
        });
        defs.appendChild(grad);
        svg.appendChild(defs);
        path.style.fill = `url(#${gid})`;
        path.style.stroke = 'rgba(107,100,85,0.35)';
      }
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
    // signals pick'em as the reference point. (ML mode: the divider tick
    // already sits at 0 — skip the extra red line.)
    if (!ml && key === 'anchor_spread' && axisMin <= 0 && axisMax >= 0) {
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
      // Note: blend label intentionally does NOT include team name —
      // the team is already shown in the card header. Keeping every
      // label consistently-sized makes the collision-detection cleaner.
      above.appendChild(bLab);
    }

    // Model dots — labels get placed via 4-lane collision detection.
    // Each label has an xPct center. We try to place it in the
    // most-preferred lane (above-near), and if it would overlap a label
    // already in that lane, fall through to below-near, above-far,
    // below-far in order. Minimum gap between label centers in the
    // same lane is the sum of their half-widths in xPct space.
    //
    // The Pressbox blend label is placed FIRST (lane 0 = above-near)
    // so it always gets the prime spot. Other labels work around it.

    // Estimated label half-width as a percent of chart width. Labels
    // are ~70px wide regardless of screen, so the percentage they
    // occupy changes with viewport. On desktop (~1200px), 35px ≈ 3%.
    // On mobile (~380px), 35px ≈ 9%. Compute from actual measured width.
    const chartPx = axisEl.parentElement?.offsetWidth || axisEl.offsetWidth || 1200;
    const LABEL_HALF_PCT = Math.min(15, (35 / chartPx) * 100 + 1);  // +1 padding
    const BLEND_HALF_PCT = Math.min(16, (38 / chartPx) * 100 + 1);

    // Lane registry: each lane tracks the placed labels [{x, halfW}]
    const lanes = [[], [], [], []];
    const laneNodes = [above, below, above, below];
    const laneClasses = ['', '', 'far', 'far'];

    function tryPlace(xCenter, halfW) {
      for (let i = 0; i < lanes.length; i++) {
        const occupants = lanes[i];
        const overlaps = occupants.some(occ => {
          const gap = Math.abs(occ.x - xCenter);
          const required = (occ.halfW + halfW);
          return gap < required;
        });
        if (!overlaps) {
          occupants.push({ x: xCenter, halfW });
          return i;
        }
      }
      // All lanes full — no room without stacking text on text. Signal the
      // caller to skip the label; the dot keeps its hover tooltip.
      return -1;
    }

    // Reserve lane 0 for the blend label if present
    if (blendPos != null) {
      const blendX = xPct(blendPos);
      lanes[0].push({ x: blendX, halfW: BLEND_HALF_PCT });
      // The blend label was already appended above; tag its lane class
      // (already in `above` which is lane 0, so no movement needed).
    }

    const sortedPts = [...points].sort((a, b) => a.value - b.value);

    // Coincident-dot handling: when models agree (dots within ~1.5% of the
    // axis), fan them vertically so four stacked reads don't render as one
    // blob — the "models cluster at pick'em while Vegas sits at -10" game
    // must still show four distinct dots.
    const placedX = [];
    sortedPts.forEach((p) => {
      const isPick = firingModel && p.name === firingModel;
      const x = xPct(p.value);
      const clash = placedX.filter(v => Math.abs(v - x) < 1.6).length;
      placedX.push(x);
      const dot = document.createElement('div');
      dot.className = isPick ? 'strip-dot strip-dot-pick' : 'strip-dot';
      if (clash) {
        const dir = clash % 2 ? 1 : -1;
        const step = Math.ceil(clash / 2) * 9;
        dot.style.marginTop = `${dir * step}px`;
      }
      dot.style.left = `${x}%`;
      dot.title = isPick
        ? `${p.name}: ${p.display} — this is the pick`
        : `${p.name}: ${p.display}`;
      axisEl.appendChild(dot);

      const lbl = document.createElement('div');
      lbl.className = isPick ? 'strip-label strip-label-pick' : 'strip-label';
      lbl.style.left = `${xPct(p.value)}%`;
      lbl.innerHTML = `<span class="strip-label-name">${escape(p.name)}</span><span class="strip-label-value">${escape(p.display)}</span>`;

      const xCenter = xPct(p.value);
      const lane = tryPlace(xCenter, LABEL_HALF_PCT);
      if (lane === -1) return;   // no clean slot — dot + tooltip only
      if (laneClasses[lane]) lbl.classList.add(`strip-label-${laneClasses[lane]}`);
      laneNodes[lane].appendChild(lbl);
    });

    // Side-ownership furniture: directional ends above the plot (hero rule —
    // away owns the left, home the right; total uses Under/Over), and the
    // ML history note below.
    const endsPair = ml ? ml.ends : (opts && opts.ends);
    if (endsPair) {
      const ends = document.createElement('div');
      ends.className = 'mlstrip-ends';
      ends.innerHTML = `<span>← ${escape(endsPair[0])}</span>` +
                       `<span>${escape(endsPair[1])} →</span>`;
      card.insertBefore(ends, card.querySelector('.strip-plot'));
    }
    // ML aggregate calibration note — only when the curve is NOT the fired
    // signal's own (a graded ML pick gets the signal-conditioned note below).
    const mlRuleCurve = ml && histRange?.source === 'rule' && densityCurve.length >= 3;
    if (ml && ml.note && !mlRuleCurve) {
      const note = document.createElement('div');
      note.className = 'mlstrip-note';
      note.innerHTML = ml.note;
      card.appendChild(note);
    }

    // History check — what share of these historical finals landed on each
    // side of TODAY'S number (trapezoid mass split of the curve). Applies to
    // spread/total always, and to the ML chart when a graded ML pick serves
    // its signal's own curve. Rule-sourced curves phrase it as the fired
    // signal's record.
    if ((!ml || mlRuleCurve) && densityCurve.length >= 3 && vegasPos != null
        && histRange?.sample_size && endsPair) {
      let left = 0, total = 0;
      for (let i = 1; i < densityCurve.length; i++) {
        const [x0, y0] = densityCurve[i - 1];
        const [x1, y1] = densityCurve[i];
        total += (x1 - x0) * (y0 + y1) / 2;
        if (x1 <= vegasPos) {
          left += (x1 - x0) * (y0 + y1) / 2;
        } else if (x0 < vegasPos) {
          const t = (vegasPos - x0) / (x1 - x0);
          const ym = y0 + (y1 - y0) * t;
          left += (vegasPos - x0) * (y0 + ym) / 2;
        }
      }
      if (total > 0) {
        const pctLeft = left / total;
        let sideName, pct;
        if (pickZone) {
          pct = pickZone.goldLeft ? pctLeft : 1 - pctLeft;
          sideName = pickZone.goldLeft ? endsPair[0] : endsPair[1];
        } else {
          pct = Math.max(pctLeft, 1 - pctLeft);
          sideName = pctLeft >= 0.5 ? endsPair[0] : endsPair[1];
        }
        const n = histRange.sample_size;
        const pctTxt = `<b>${Math.round(pct * 100)}%</b>`;
        const note = document.createElement('div');
        note.className = 'mlstrip-note';
        note.innerHTML = (histRange.source === 'rule')
          ? `History check: in the ${n} games where this pick's #1 signal fired, ` +
            `${pctTxt} of finals landed on the ${escape(sideName)} side of today's number.`
          : `History check: at numbers like today's, ${pctTxt} of finals landed ` +
            `on the ${escape(sideName)} side (${n} games, 2023–25).`;
        card.appendChild(note);
      }
    }

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
  /**
   * Moneyline card — styled exactly like a stats category card.
   *
   * One numbers-card with a teamhead, then one numbers-row per source
   * (Vegas + 5 models + PressBox blend). Each row:
   *   [away odds] [away bar] [SOURCE] [home bar] [home odds]
   *
   * Bar width = win probability (0–100). Bar color = 5-tier ladder
   * via computeBar with league_min=0, league_max=1, lower_better=false
   * so higher probability = better color, same as offense stat rows.
   *
   * Convention: AWAY on the left, HOME on the right. Matches the stats
   * cards and the page-wide team orientation. Anchor/other from the
   * backend gets unfolded into away/home using anchor.is_home.
   */
  function buildMLRows(data, mlSection, anchor, firingModel) {
    const card = document.createElement('div');
    card.className = 'numbers-card';

    const awayName = data.game?.away?.name || 'Away';
    const homeName = data.game?.home?.name || 'Home';
    const anchorIsHome = !!anchor.is_home;

    // Build per-source rows. We'll render them as numbers-rows below.
    const rows = [];

    // Vegas
    const vegasAwayProb = anchorIsHome ? mlSection.vegas_other_implied : mlSection.vegas_anchor_implied;
    const vegasHomeProb = anchorIsHome ? mlSection.vegas_anchor_implied : mlSection.vegas_other_implied;
    const vegasAwayOdds = anchorIsHome ? mlSection.vegas_other_display : mlSection.vegas_anchor_display;
    const vegasHomeOdds = anchorIsHome ? mlSection.vegas_anchor_display : mlSection.vegas_other_display;
    // Only include the Vegas row when prices are actually posted at
    // enough books. Otherwise the backend returns null and showing
    // "Vegas —" looks like a data error rather than a pending market.
    if (vegasAwayProb != null && vegasHomeProb != null) {
      rows.push({
        label: 'Vegas',
        awayProb: vegasAwayProb,
        homeProb: vegasHomeProb,
        awayOdds: vegasAwayOdds,
        homeOdds: vegasHomeOdds,
      });
    }

    // Models (in MODEL_ORDER)
    MODEL_ORDER.forEach(modelName => {
      const m = (mlSection.models || []).find(x => x.name === modelName);
      if (!m) return;
      const awayProb  = anchorIsHome ? m.other_prob   : m.anchor_prob;
      const homeProb  = anchorIsHome ? m.anchor_prob  : m.other_prob;
      const awayOdds  = anchorIsHome ? m.other_display : m.anchor_display;
      const homeOdds  = anchorIsHome ? m.anchor_display : m.other_display;
      const isPick = firingModel && modelName === firingModel;
      rows.push({ label: modelName, awayProb, homeProb, awayOdds, homeOdds, isPick });
    });

    // PressBox blend — suppressed when a cell fired (firingModel set).
    // The pick came from one model hitting cell bands, not from the
    // blend, so the aggregate would muddy the visual story.
    if (!firingModel && mlSection.pressbox_anchor_prob != null) {
      const blendAwayProb = anchorIsHome ? mlSection.pressbox_other_prob  : mlSection.pressbox_anchor_prob;
      const blendHomeProb = anchorIsHome ? mlSection.pressbox_anchor_prob : mlSection.pressbox_other_prob;
      const blendAwayOdds = anchorIsHome ? mlSection.pressbox_other_american : mlSection.pressbox_anchor_american;
      const blendHomeOdds = anchorIsHome ? mlSection.pressbox_anchor_american : mlSection.pressbox_other_american;
      rows.push({
        label: 'PressBox',
        awayProb: blendAwayProb,
        homeProb: blendHomeProb,
        awayOdds: blendAwayOdds,
        homeOdds: blendHomeOdds,
        isBlend: true,
      });
    }

    // Render each source row using the SAME shape as renderStatRow.
    // computeBar gets passed a synthetic "row" with the probability as
    // both value and league range (0–1, higher better).
    const rowsHtml = rows.map(r => {
      const aDisplay = r.awayOdds || '—';
      const hDisplay = r.homeOdds || '—';

      const aLead = (r.awayProb != null && r.homeProb != null && r.awayProb > r.homeProb);
      const hLead = (r.homeProb != null && r.awayProb != null && r.homeProb > r.awayProb);

      const aBar = computeBar(r.awayProb, { league_min: 0, league_max: 1, lower_better: false });
      const hBar = computeBar(r.homeProb, { league_min: 0, league_max: 1, lower_better: false });

      const labelClass = r.isBlend
        ? 'numbers-row-label is-blend'
        : r.isPick
          ? 'numbers-row-label is-pick'
          : 'numbers-row-label';

      return `
        <div class="numbers-row">
          <div class="numbers-row-val away ${aLead ? 'lead' : ''} ${r.awayProb == null ? 'missing' : ''}">${escape(aDisplay)}</div>
          <div class="numbers-row-track away">
            <div class="numbers-row-fill away ${aBar.qual}" style="width:${aBar.width}%;"></div>
          </div>
          <div class="${labelClass}">${escape(r.label)}</div>
          <div class="numbers-row-track home">
            <div class="numbers-row-fill home ${hBar.qual}" style="width:${hBar.width}%;"></div>
          </div>
          <div class="numbers-row-val home ${hLead ? 'lead' : ''} ${r.homeProb == null ? 'missing' : ''}">${escape(hDisplay)}</div>
        </div>
      `;
    }).join('');

    card.innerHTML = `
      <div class="numbers-card-head">
        <h3 class="numbers-card-title">Moneyline</h3>
      </div>
      <div class="numbers-teamhead">
        <div class="numbers-teamhead-away">${escape(awayName)}</div>
        <div class="numbers-teamhead-spacer"></div>
        <div class="numbers-teamhead-home">${escape(homeName)}</div>
      </div>
      <div class="numbers-rows">${rowsHtml}</div>
    `;

    return card;
  }

  /* ───────────────────────────────────────────────────────────
   * The Pick
   * ─────────────────────────────────────────────────────────── */

  /**
   * Pick section — pixel-for-pixel Live Lines accordion treatment.
   * Emits the same .ll-row + .ll-accordion DOM that live-lines.js uses,
   * with .ll-* CSS coming from /css/components/live-lines.css (loaded
   * at the top of game.html).
   *
   * The only divergence from Live Lines: for graded picks (outcome set),
   * the "Current/Now" event is replaced by an .rs-outcome win/loss/push
   * indicator from the Results page. For ungraded picks, we keep the
   * Live Lines "Current" event.
   *
   * Three cards always render (spread / total / moneyline), with
   * no-edge markets shown as collapsed-only .ll-row--no-edge cards.
   */

  // Tier badge mapping — copied verbatim from live-lines.js so the
  // markup matches exactly. CSS classes come from live-lines.css.
  const LL_BADGE_MAP = {
    'A+':          { label: 'A+', aria: 'A+ tier — corroborated top pick', key: 'aplus' },
    'A':           { label: 'A',  aria: 'A tier — gold',    key: 'A' },
    'B':           { label: 'B',  aria: 'B tier — silver',  key: 'B' },
    'C':           { label: 'C',  aria: 'C tier — bronze',  key: 'C' },
    'smart_money': { label: 'SM', aria: 'Smart Money tier', key: 'smart_money' },
    'goldilocks':  { label: 'GL', aria: 'Goldilocks tier',  key: 'goldilocks' },
    'lottery':     { label: 'LT', aria: 'Lottery tier',     key: 'lottery' },
    'ml_pickem':   { label: 'ML', aria: 'A+ moneyline expression — near-pickem price', key: 'aplus' },
    'no_edge':     { label: 'NE', aria: 'No edge — model aggregate without an actionable edge', key: 'no_edge' },
  };

  function llBadge(tier, bolt) {
    const m = LL_BADGE_MAP[tier] || { label: escape(tier), aria: escape(tier), key: 'no_edge' };
    const boltKey = ({ aplus: 'aplus', A: 'A', B: 'B', C: 'C' })[m.key];
    const boltHtml = (bolt && boltKey)
      ? `<span class="ll-bolt ll-bolt--${boltKey}" aria-hidden="true">` +
        `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M15 1 5.5 14.5h6L9.5 23l9.5-13.5h-6z"/></svg></span>`
      : '';
    const aria = bolt ? `${m.aria} — streak-aligned` : m.aria;
    return `<span class="ll-badge ll-badge--${m.key}" aria-label="${aria}">${m.label}${boltHtml}</span>`;
  }

  function llTierLabel(tier) {
    if (!tier) return '—';
    return TIER_DISPLAY[tier] || tier;
  }

  function llPickLine(p) {
    // Mirror live-lines.js renderPickLine. If no side, just em-dash.
    if (!p.side_display && !p.line && !p.history?.current?.side) {
      return '<span class="ll-row-pick-num">—</span>';
    }

    // Prefer the CURRENT (latest journal) side/line/book over the
    // released values. Live Lines does the same — the headline should
    // reflect where the pick is NOW, not where it started. Otherwise
    // the headline contradicts the history shown when expanded.
    const side = p.history?.current?.side || p.side_display || '';

    // No side at all = a CONTESTED verdict — the vote count tied, so there
    // is genuinely no lean. Say that instead of rendering a sideless quote
    // (a spread number without a team is meaningless).
    if (!side || side === '?') {
      return '<span class="ll-row-pick-num">Signals tied — no lean</span>';
    }
    const bookName = p.history?.current?.book?.name
      || p.book
      || '';
    const lineRaw = p.history?.current?.line
      || (p.line != null ? (p.market === 'spread' ? formatSignedNumber(p.line) : String(p.line)) : '');

    let bookText = bookName ? ' · ' + escape(bookName) : '';
    if (p.market === 'moneyline' || p.market === 'ml') {
      return `${escape(side)} ML <span class="ll-row-pick-num">${escape(lineRaw)}</span>${bookText}`;
    }
    return `${escape(side)} <span class="ll-row-pick-num">${escape(lineRaw)}</span>${bookText}`;
  }

  function llHistoryTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
      timeZone: 'America/New_York',
    });
  }

  function llOutcomeBlock(outcome) {
    // Returns the rs-outcome block when a pick has graded, else null.
    if (!outcome) return null;
    const klass = outcome === 'W' ? 'win' : outcome === 'L' ? 'loss' : 'push';
    const label = outcome === 'W' ? 'WIN' : outcome === 'L' ? 'LOSS' : 'PUSH';
    return `
      <span class="rs-outcome rs-outcome--${klass}">
        <span class="rs-outcome-dot" aria-hidden="true"></span>
        <span class="rs-outcome-label">${label}</span>
      </span>
    `;
  }

  function buildPickArticle(p) {
      const isNoEdge = p.tier === 'no_edge';
      const article = document.createElement('article');
      article.className = isNoEdge ? 'll-row ll-row--no-edge' : 'll-row';
      article.setAttribute('data-pick-id', String(p.pick_id || ''));
      article.setAttribute('aria-expanded', 'false');

      // Build the row header — same shape as live-lines.js renderPickRow
      const market = (p.market_display || MARKET_DISPLAY[p.market] || '');
      const matchupLabel = isNoEdge
        ? `${escape(market)} — No Edge`
        : escape(market);

      const headerHtml = `
        <button class="ll-row-header" data-action="toggle"
                aria-controls="ll-acc-${escape(String(p.pick_id || 'ne-' + p.market))}"
                aria-expanded="false">
          ${llBadge(p.tier, p.bolt)}
          <div class="ll-row-content">
            <div class="ll-row-matchup">${matchupLabel}</div>
            <div class="ll-row-pick">${llPickLine(p)}</div>
          </div>
          <svg class="ll-row-chevron" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      `;

      // Accordion body — render for ALL picks including no_edge, matching
      // Live Lines behavior. No-edge cards expand to show the same
      // history + other-books info as real picks.
      let bodyHtml = '';
      if (p.history) {
        const released = p.history.released;
        const transitions = p.history.transitions || [];
        const current = p.history.current;
        const currentBooks = p.history.current_books || [];

        const releasedDate = released?.at ? llHistoryTime(released.at) : '';

        const transitionsHtml = transitions.map(e => {
          const isBookOnly = e.is_book_change && !e.is_tier_change && !e.is_side_change && !e.is_line_change;
          const dot = isBookOnly
            ? `<span class="ll-event-dot" style="background:var(--text-mid);"></span>`
            : `<span class="ll-event-dot"></span>`;
          return `
            <div class="ll-event">
              ${dot}
              <div class="ll-event-title">${escape(e.summary || 'Pick updated')}</div>
              <div class="ll-event-time">${escape(llHistoryTime(e.observed_at))}</div>
            </div>
          `;
        }).join('');

        // Current/result event: graded → rs-outcome; else Live Lines "Now"
        const outcomeBlock = llOutcomeBlock(p.outcome);
        let currentEventHtml = '';
        if (outcomeBlock) {
          currentEventHtml = `
            <div class="ll-event">
              <span class="ll-event-dot"></span>
              <div class="ll-event-title">
                <strong>Result</strong>
                · ${outcomeBlock}
              </div>
              <div class="ll-event-time">Graded</div>
            </div>
          `;
        } else if (current) {
          const curTier = current.tier;
          const curSide = current.side || '—';
          const curLine = current.line || '';
          const curBook = current.book?.name || '—';
          currentEventHtml = `
            <div class="ll-event">
              <span class="ll-event-dot"></span>
              <div class="ll-event-title">
                <strong>Current</strong>
                · ${escape(curTier === 'no_edge' ? 'No Edge' : llTierLabel(curTier) + ' holding')}
                · ${escape(curSide)} ${escape(curLine)} at ${escape(curBook)}
              </div>
              <div class="ll-event-time">Now</div>
            </div>
          `;
        }

        // Other books expander
        const currentBookName = current?.book?.name || '';
        let primaryHidden = false;
        const otherBooks = currentBooks.filter(b => {
          if (!primaryHidden && b.book && b.book.name === currentBookName) {
            primaryHidden = true;
            return false;
          }
          return true;
        });

        const booksHtml = otherBooks.length ? otherBooks.map(b => {
          const url = b.book?.url || '#';
          const name = escape(b.book?.name || '?');
          const line = escape(b.line || '');
          const deltaClass =
            b.delta === 'match' ? 'll-book-delta--match' :
            (b.delta && String(b.delta).startsWith('+')) ? 'll-book-delta--better' :
            'll-book-delta--worse';
          return `
            <a class="ll-book-row" href="${escape(url)}" target="_blank" rel="noopener noreferrer"
               aria-label="Bet at ${name} (opens in new tab)">
              <span class="ll-book-name">
                ${name}
                <svg class="ll-book-name-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M6 4h6v6M12 4L4 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
              </span>
              <span>
                <span class="ll-book-line">${line}</span>
                <span class="${deltaClass}"> (${escape(String(b.delta))})</span>
              </span>
            </a>
          `;
        }).join('') : '';

        const currentBookUrl = current?.book?.url || '#';

        bodyHtml = `
          <div id="ll-acc-${escape(String(p.pick_id))}" class="ll-accordion">
            <div class="ll-accordion-section-label">History</div>
            <div class="ll-history">
              ${released ? `
                <div class="ll-event">
                  <span class="ll-event-dot"></span>
                  <div class="ll-event-title">
                    <strong>Released ${escape(llTierLabel(released.tier))}</strong>
                    · ${escape(released.side || '—')} ${escape(released.line || '')}
                    at ${escape(released.book?.name || '—')}
                  </div>
                  <div class="ll-event-time">${escape(releasedDate)}</div>
                </div>
              ` : ''}
              ${transitionsHtml}
              ${currentEventHtml}
            </div>

            ${booksHtml ? `
              <div class="ll-other-books" data-other-books="${escape(String(p.pick_id))}">
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

            ${currentBookName && !p.outcome ? `
              <a class="ll-bet-button" href="${escape(currentBookUrl)}"
                 target="_blank" rel="noopener noreferrer"
                 aria-label="Bet at ${escape(currentBookName)} (opens in new tab)"
                 style="margin-top:var(--space-4);">
                Bet at ${escape(currentBookName)} →
              </a>
            ` : ''}
          </div>
        `;
      } else {
        // No history data available — render an empty accordion to
        // match Live Lines shape (placeholder so click toggle works
        // without errors; user just sees an empty body).
        bodyHtml = `<div id="ll-acc-${escape(String(p.pick_id || 'ne-' + p.market))}" class="ll-accordion"></div>`;
      }

      article.innerHTML = headerHtml + bodyHtml;

      // Toggle handler — wire up for ALL rows including no_edge,
      // matching Live Lines behavior.
      const btn = article.querySelector('.ll-row-header');
      btn?.addEventListener('click', () => {
        const isOpen = article.getAttribute('aria-expanded') === 'true';
        article.setAttribute('aria-expanded', String(!isOpen));
        btn.setAttribute('aria-expanded', String(!isOpen));
      });
      // Other-books toggle
      const obToggle = article.querySelector('[data-action="toggle-books"]');
      if (obToggle) {
        obToggle.addEventListener('click', (e) => {
          e.stopPropagation();
          const wrap = obToggle.closest('.ll-other-books');
          const rows = wrap?.querySelector('.ll-other-books-rows');
          if (!rows) return;
          const isOpen = obToggle.getAttribute('aria-expanded') === 'true';
          obToggle.setAttribute('aria-expanded', String(!isOpen));
          rows.style.display = isOpen ? 'none' : 'block';
          const chev = obToggle.querySelector('.ll-other-books-chevron');
          if (chev) chev.style.transform = isOpen ? '' : 'rotate(180deg)';
        });
      }

      return article;
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

    // When the backend fell back to a prior season (current season has
    // no data yet — typical for upcoming games), surface that to the
    // reader so they don't think stale stats are this season's.
    if (data.stats?.fallback_used && data.stats?.source_season) {
      const note = document.createElement('div');
      note.className = 'numbers-fallback-note';
      note.textContent = `Stats shown are from the ${data.stats.source_season} season — current season hasn't started.`;
      els.numbersStack.appendChild(note);
    }

    // Two page-level groups: cards that break down a DNA strip bar, then
    // everything else. One group header each (Austin: "efficiency, scoring,
    // discipline aren't in the DNA — separate that out").
    const DNA_TAG = { talent: 'Talent', trench: 'Trenches',
                      explosiveness: 'Explosiveness', efficiency: 'Efficiency',
                      pace: 'Pace' };
    let dnaHeadDone = false, restHeadDone = false;

    cats.forEach(cat => {
      if (cat.dna && !dnaHeadDone) {
        dnaHeadDone = true;
        const gh = document.createElement('div');
        gh.className = 'numbers-grouphead';
        gh.textContent = 'Matchup DNA — the numbers behind the strip';
        els.numbersStack.appendChild(gh);
      } else if (!cat.dna && !restHeadDone) {
        restHeadDone = true;
        const gh = document.createElement('div');
        gh.className = 'numbers-grouphead';
        gh.textContent = 'Beyond the DNA — full profile';
        els.numbersStack.appendChild(gh);
      }

      const card = document.createElement('div');
      card.className = 'numbers-card';

      // Own metrics and opponent metrics read together: rows carrying a
      // group render under Offense / Defense subheads; ungrouped rows
      // (the DNA aggregate composites) lead the card.
      const rows = cat.rows || [];
      let bodyHtml;
      if (rows.some(r => r.group)) {
        const parts = [];
        const leadRows = rows.filter(r => !r.group);
        const offRows  = rows.filter(r => r.group === 'off');
        const defRows  = rows.filter(r => r.group === 'def');
        if (leadRows.length) parts.push(leadRows.map(r => renderStatRow(r)).join(''));
        if (offRows.length) {
          parts.push(`<div class="numbers-subhead">Offense</div>` +
                     offRows.map(r => renderStatRow(r)).join(''));
        }
        if (defRows.length) {
          parts.push(`<div class="numbers-subhead">Defense</div>` +
                     defRows.map(r => renderStatRow(r)).join(''));
        }
        bodyHtml = parts.join('');
      } else {
        bodyHtml = rows.map(r => renderStatRow(r)).join('');
      }

      const dnaTag = cat.dna && DNA_TAG[cat.dna]
        ? `<div class="numbers-dna-tag">DNA · ${escape(DNA_TAG[cat.dna])}</div>`
        : '';
      card.innerHTML = `
        <div class="numbers-card-head">
          ${dnaTag}
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
    // Show when there are games OR a summary — "first-ever meeting" is a
    // real data point, not a missing section.
    if (!s || (!(s.games || []).length && !s.summary)) {
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
    if (!token && location.hostname !== 'localhost') {
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
      renderDNA(data);
      renderBeats(data);
      renderReceipt(data);
      renderNumbers(data);
      renderSeries(data);
    } catch (e) {
      console.error('render failed:', e);
      showState('error');
      return;
    }

    showState('content');

    // ── Live polling ────────────────────────────────────────────
    // If the game is in progress, keep the broadcast hero block fresh
    // by re-fetching every 20 seconds. Stops automatically when the
    // game leaves live state, or when the tab is hidden. Re-resumes
    // when the tab regains focus.
    startLivePolling(data, gameId, token);
  }

  // ────── LIVE POLLING ──────
  let _livePollTimer = null;
  let _visibilityHooked = false;
  function startLivePolling(initialData, gameId, token) {
    stopLivePolling();
    const status = initialData.game?.status;
    if (status !== 'in_progress') return;   // only poll for live games

    const tick = async () => {
      if (document.hidden) return;          // skip while tab is backgrounded
      try {
        const refresh = await fetchBreakdown(gameId, token);
        if (!refresh || refresh.notFound || refresh.error) return;
        // Only re-render the parts that change live. Avoid re-rendering
        // the storyline / picks blocks which haven't changed.
        renderHero(refresh);
        // Once game leaves live state, stop polling.
        if (refresh.game?.status !== 'in_progress') {
          stopLivePolling();
        }
      } catch (e) {
        console.warn('live poll failed:', e);
      }
    };

    _livePollTimer = setInterval(tick, 20000);   // 20s cadence

    if (!_visibilityHooked) {
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden && _livePollTimer) tick();
      });
      _visibilityHooked = true;
    }
  }
  function stopLivePolling() {
    if (_livePollTimer) {
      clearInterval(_livePollTimer);
      _livePollTimer = null;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
