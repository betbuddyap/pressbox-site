/**
 * /js/badge.js — the ONE tier badge, and the markers that ride it.
 *
 * Five pages used to carry their own copy of this function (Live Lines,
 * Upcoming's hero, Parlay, Allocator, Results, the game page); every marker
 * change meant five edits and five cache stamps, and the copies had begun
 * to differ (Results had no legacy tiers, aria strings drifted). This is
 * the single source. Pages load it before their own script and keep a
 * thin local wrapper so call sites never changed:
 *
 *   PBBadge.render(tier, { bolt, chain })   -> the .ll-badge HTML
 *   PBBadge.loadChain(apiBase, season)      -> Promise<{game_id: fire}>
 *   PBBadge.chainAgrees(map, pick)          -> the Chain's chip rule
 *
 * Markers (both ride the badge without touching its grade):
 *   bolt  — the streak marker (hype-fade / cold-follow, section 01 of HIW)
 *   chain — the Chain's 2026 trial signal (handoff/CHAIN_PREREG_2026 §4):
 *           shown ONLY on a graded SPREAD pick whose side the Chain's locked
 *           fire is on. Solo marker top-right; both -> bolt top-right, chain
 *           top-left (.left). No Edge never wears a marker.
 *
 * CSS: .ll-badge / .ll-bolt / .ll-chain in css/components/live-lines.css.
 * No dependencies; plain script; exposes window.PBBadge.
 */
(function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // The superset of every page's map. `key` is the CSS suffix (case matters:
  // .ll-badge--aplus, .ll-badge--A ...). Legacy band tiers (retired
  // 2026-08-10) keep rendering for old rows; ml_pickem wears the A+ look.
  var TIERS = {
    'A+':          { label: 'A+', aria: 'A+ tier — corroborated top pick', key: 'aplus' },
    'A':           { label: 'A',  aria: 'A tier — gold',                   key: 'A' },
    'B':           { label: 'B',  aria: 'B tier — silver',                 key: 'B' },
    'C':           { label: 'C',  aria: 'C tier — bronze',                 key: 'C' },
    'smart_money': { label: 'SM', aria: 'Smart Money tier',                key: 'smart_money' },
    'goldilocks':  { label: 'GL', aria: 'Goldilocks tier',                 key: 'goldilocks' },
    'lottery':     { label: 'LT', aria: 'Lottery tier',                    key: 'lottery' },
    'ml_pickem':   { label: 'ML', aria: 'A+ moneyline expression — near-pickem price', key: 'aplus' },
    'no_edge':     { label: 'NE', aria: 'No edge — model aggregate without an actionable edge', key: 'no_edge' },
  };
  // Only the graded ladder tiers wear markers.
  var MARK_KEYS = { aplus: 'aplus', A: 'A', B: 'B', C: 'C' };

  var BOLT_GLYPH = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M15 1 5.5 14.5h6L9.5 23l9.5-13.5h-6z"/></svg>';
  var CHAIN_GLYPH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round">' +
    '<path d="M10.5 13.5a4.2 4.2 0 0 0 6 0l2.6-2.6a4.24 4.24 0 0 0-6-6l-1.4 1.4"/>' +
    '<path d="M13.5 10.5a4.2 4.2 0 0 0-6 0l-2.6 2.6a4.24 4.24 0 0 0 6 6l1.4-1.4"/></svg>';

  function render(tier, opts) {
    opts = opts || {};
    var m = TIERS[tier] || { label: esc(tier || '—'), aria: esc(tier || 'ungraded'), key: 'no_edge' };
    var mk = MARK_KEYS[m.key];
    var bolt = !!(opts.bolt && mk), chain = !!(opts.chain && mk);
    var boltHtml = bolt
      ? '<span class="ll-bolt ll-bolt--' + mk + '" aria-hidden="true">' + BOLT_GLYPH + '</span>' : '';
    var chainHtml = chain
      ? '<span class="ll-chain ll-chain--' + mk + (bolt ? ' left' : '') + '" aria-hidden="true">' + CHAIN_GLYPH + '</span>' : '';
    var notes = [];
    if (bolt) notes.push('streak-aligned');
    if (chain) notes.push('the Chain agrees');
    var aria = notes.length ? m.aria + ' — ' + notes.join(', ') : m.aria;
    return '<span class="ll-badge ll-badge--' + m.key + '" aria-label="' + aria + '">' +
           m.label + boltHtml + chainHtml + '</span>';
  }

  // The Chain's fires for the season -> {game_id: fire}. Never throws:
  // the marker is a nicety and no page waits on it.
  function loadChain(apiBase, season) {
    var url = (apiBase || '') + '/chain/fires?season=' + encodeURIComponent(season || 2026);
    return fetch(url).then(function (r) { return r.json(); }).then(function (j) {
      var map = {};
      (j && j.fires || []).forEach(function (f) { map[f.game_id] = f; });
      return map;
    }).catch(function () { return {}; });
  }

  // §4: graded SPREAD pick, side (team name) equal to the fire's team.
  function chainAgrees(map, p) {
    if (!map || !p) return false;
    var f = map[p.game_id];
    return !!(f && p.market === 'spread' && p.tier && p.tier !== 'no_edge'
              && p.side && f.team && String(p.side).toLowerCase() === String(f.team).toLowerCase());
  }

  window.PBBadge = {
    render: render, loadChain: loadChain, chainAgrees: chainAgrees,
    TIERS: TIERS, MARK_KEYS: MARK_KEYS, BOLT_GLYPH: BOLT_GLYPH, CHAIN_GLYPH: CHAIN_GLYPH,
  };
})();
