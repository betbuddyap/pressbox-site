/**
 * My Bets — the per-user real-money ledger.
 *
 * Every login gets a private ledger: rows live in Supabase (`user_bets`,
 * RLS-scoped to auth.uid()), written straight from this page with the anon
 * key. The backend settles each ticket against the FINAL SCORE on the
 * USER'S OWN line and odds (user_bets_cron.py) — a +6 ticket pushes on a
 * 6-point margin even when the board's +6.5 pick wins. Lock semantics
 * mirror the board: tickets delete only PREGAME; once the game kicks,
 * the ledger stands.
 *
 * Data sources:
 *   - /games/upcoming        (subscription-gated) → weeks + games
 *   - /canonical/games/{id}/book-quotes (public)  → per-book line/odds prefill
 *   - supabase user_bets                          → the ledger itself
 */
(() => {
  const API = 'https://betbuddy-backend.onrender.com';
  const SEASON = 2026;
  const SUPABASE_URL  = 'https://brwalcuodwxsynrpiqjc.supabase.co';
  const SUPABASE_ANON = 'sb_publishable_yUSCp6-m1gda0eMcGWuinw_LMLGP_uE';
  const sb = (typeof supabase !== 'undefined')
    ? supabase.createClient(SUPABASE_URL, SUPABASE_ANON)
    : null;

  const app = document.getElementById('mb-app');

  // ── State ──────────────────────────────────────────────────────────
  let games = [];               // /games/upcoming payload
  let gamesById = {};
  let weeks = [];               // sorted distinct week numbers
  let bets = [];                // user_bets rows, newest first
  let quotesCache = {};         // game_id -> book-quotes payload
  let picksByGame = {};         // /picks/upcoming — game_id -> {slots:{spread,total,ml}}
  let formWeek = null;          // week selected in the form
  let heroScope = 'week';       // 'week' | 'season'
  let ledgerReady = true;       // false when the user_bets table isn't provisioned
  let mode = 'single';          // 'single' | 'parlay'
  let parlayLegs = [];          // pending legs while building a parlay ticket
  let importRows = null;        // allocator-sheet handoff (localStorage), or null
  let editingId = null;           // bet id with the inline editor open
  let ledgerBook = null;          // ledger + hero filtered to one book

  // ── Utils ──────────────────────────────────────────────────────────
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  // The product's book roster (mirrors the backend BOOKMAKERS display names)
  // plus bet365 — a main book people bet at that our odds provider cannot
  // quote (bet365 doesn't license US odds to The Odds API). Order here is
  // irrelevant; the dropdown sorts quoted-books-first per game.
  const MAIN_BOOKS = ['DraftKings', 'FanDuel', 'BetMGM', 'Caesars', 'bet365',
                      'Hard Rock Bet', 'Bally Bet', 'Fanatics', 'BetRivers',
                      'theScore Bet', 'Bovada'];

  const MINUS = '−';
  function fmtOdds(o) {
    const n = Math.round(Number(o));
    if (!isFinite(n) || n === 0) return '—';
    return n > 0 ? `+${n}` : `${MINUS}${Math.abs(n)}`;
  }
  function fmtSignedLine(v) {
    const n = Number(v);
    if (!isFinite(n)) return '';
    if (n === 0) return 'PK';
    const abs = String(Math.abs(n)).replace(/\.0$/, '');
    return n > 0 ? `+${abs}` : `${MINUS}${abs}`;
  }
  function fmtMoney(v, { signed = false } = {}) {
    const n = Number(v) || 0;
    const abs = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (!signed) return `$${abs}`;
    if (n > 0) return `+$${abs}`;
    if (n < 0) return `${MINUS}$${abs}`;
    return `$${abs}`;
  }
  function winAmount(stake, odds) {
    const s = Number(stake), o = Math.round(Number(odds));
    if (!(s > 0) || !isFinite(o) || o === 0) return null;
    return o > 0 ? s * (o / 100) : s * (100 / Math.abs(o));
  }
  function amToDec(odds) {
    const o = Math.round(Number(odds));
    if (!isFinite(o) || o === 0) return null;
    return o > 0 ? 1 + o / 100 : 1 + 100 / Math.abs(o);
  }
  function decToAm(dec) {
    if (!(dec > 1)) return null;
    return dec >= 2 ? Math.round((dec - 1) * 100) : Math.round(-100 / (dec - 1));
  }
  function kickoffDate(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    return isNaN(d.getTime()) ? null : d;
  }
  function isPregame(iso) {
    const d = kickoffDate(iso);
    return d ? d.getTime() > Date.now() : true;
  }
  function fmtKick(iso) {
    const d = kickoffDate(iso);
    if (!d) return '';
    return d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  // ── Auth walls ─────────────────────────────────────────────────────
  function renderWall(kind) {
    const login = `
      <div class="mb-wall">
        <h2>Your ledger lives behind your login.</h2>
        <p>My Bets is a private, per-account record of the tickets you actually
        placed — settled against the final on your line and your odds.</p>
        <div class="mb-wall-actions">
          <a class="mb-wall-btn primary" href="/login.html">Log in</a>
          <a class="mb-wall-btn ghost" href="/subscribe.html">Sign up</a>
        </div>
      </div>`;
    const subscribe = `
      <div class="mb-wall">
        <h2>My Bets rides on the live board.</h2>
        <p>Logging tickets uses the same live slate and book lines as the rest
        of PressBox — an active subscription unlocks it.</p>
        <div class="mb-wall-actions">
          <a class="mb-wall-btn primary" href="/subscribe.html">Subscribe</a>
          <a class="mb-wall-btn ghost" href="/account.html">Account</a>
        </div>
      </div>`;
    app.innerHTML = kind === 'subscribe' ? subscribe : login;
  }

  // ── Hero (the screenshot card) ─────────────────────────────────────
  function scopeBets() {
    const base = heroScope === 'season' ? bets : bets.filter(b => b.week === formWeek);
    // The book filter flows into the hero on purpose: filtered to FanDuel,
    // the P&L card IS your FanDuel P&L.
    return ledgerBook ? base.filter(b => b.book === ledgerBook) : base;
  }
  function heroHTML() {
    const rows = scopeBets();
    const settled = rows.filter(b => b.result);
    const net = settled.reduce((a, b) => a + (Number(b.profit) || 0), 0);
    const stakedAll = rows.reduce((a, b) => a + (Number(b.stake) || 0), 0);
    const stakedSettled = settled.reduce((a, b) => a + (Number(b.stake) || 0), 0);
    const W = settled.filter(b => b.result === 'W').length;
    const L = settled.filter(b => b.result === 'L').length;
    const P = settled.filter(b => b.result === 'P' || b.result === 'V').length;
    const pending = rows.length - settled.length;
    const roi = stakedSettled > 0 ? (net / stakedSettled) * 100 : null;
    const netCls = net > 0 ? 'pos' : net < 0 ? 'neg' : '';
    const record = `${W}–${L}` + (P ? `–${P}` : '');
    const scopeLabel = heroScope === 'season' ? '2026 season'
      : (formWeek != null ? `Week ${formWeek}` : 'This week');
    return `
      <div class="mb-hero">
        <div class="mb-hero-top">
          <div class="mb-hero-eyebrow">My Bets · ${esc(scopeLabel)}${ledgerBook ? ' · ' + esc(ledgerBook) : ''}</div>
          <div class="mb-scope" role="tablist">
            <button type="button" data-scope="week" class="${heroScope === 'week' ? 'active' : ''}">Week</button>
            <button type="button" data-scope="season" class="${heroScope === 'season' ? 'active' : ''}">Season</button>
          </div>
        </div>
        <div class="mb-hero-stats">
          <div class="mb-stat">
            <div class="mb-stat-label">Net P&amp;L</div>
            <div class="mb-stat-value ${netCls}">${esc(fmtMoney(net, { signed: true }))}</div>
          </div>
          <div class="mb-stat">
            <div class="mb-stat-label">Record</div>
            <div class="mb-stat-value">${esc(record)}</div>
          </div>
          <div class="mb-stat">
            <div class="mb-stat-label">ROI (settled)</div>
            <div class="mb-stat-value">${roi == null ? '—' : esc((roi > 0 ? '+' : roi < 0 ? MINUS : '') + Math.abs(roi).toFixed(1) + '%')}</div>
          </div>
          <div class="mb-stat">
            <div class="mb-stat-label">Staked</div>
            <div class="mb-stat-value">${esc(fmtMoney(stakedAll))}</div>
          </div>
        </div>
        <div class="mb-hero-note">Settled against final scores on your line, your odds — within ~30 minutes of the final.${pending ? ` ${pending} ticket${pending === 1 ? '' : 's'} pending.` : ''}</div>
      </div>`;
  }

  // ── Log-a-bet form ─────────────────────────────────────────────────
  // /games/upcoming reshapes its rows: the id is `game_id` (a STRING),
  // kickoff is `raw_date`, and `week` is the canonical anchor-Saturday
  // week. gid() is the ONE place the string becomes the number the
  // ledger and the quotes endpoint use. (The original build read `id` /
  // `start_date` — every option's value came out "undefined", so
  // gamesById["undefined"] pinned to the last game in the date-ordered
  // payload: the season finale. Army @ Navy, forever.)
  const gid = (g) => Number(g.game_id);

  function weekGames(w) {
    return games
      .filter(g => g.week === w)
      .sort((a, b) => String(a.raw_date || '').localeCompare(String(b.raw_date || '')));
  }

  function formHTML() {
    const weekOpts = weeks.map(w =>
      `<option value="${w}" ${w === formWeek ? 'selected' : ''}>Week ${w}</option>`).join('');
    return `
      <div class="mb-section">
        <div class="mb-section-eyebrow">Log a ticket</div>
        <h2 class="mb-section-title">What did you <em>actually</em> bet?</h2>
        <div class="mb-mode" role="tablist">
          <button type="button" data-mode="single" class="active">Single</button>
          <button type="button" data-mode="parlay">Parlay</button>
        </div>
        <form class="mb-form" id="mbForm" autocomplete="off">
          <div class="mb-form-grid">
            <div class="mb-field">
              <label for="mbWeek">Week</label>
              <select id="mbWeek">${weekOpts}</select>
            </div>
            <div class="mb-field">
              <label for="mbGame">Game</label>
              <select id="mbGame"></select>
            </div>
            <div class="mb-field">
              <label for="mbMarket">Bet type</label>
              <select id="mbMarket">
                <option value="spread">Spread</option>
                <option value="total">Total</option>
                <option value="ml">Moneyline</option>
              </select>
            </div>
            <div class="mb-field">
              <label for="mbSide">Your side</label>
              <select id="mbSide"></select>
            </div>
            <div class="mb-field">
              <label for="mbBook">Book</label>
              <select id="mbBook"></select>
            </div>
            <div class="mb-field" id="mbLineField">
              <label for="mbLine">Line (your side)</label>
              <input id="mbLine" type="number" step="0.5" placeholder="+6.5">
            </div>
            <div class="mb-field">
              <label for="mbOdds">Odds (American)</label>
              <input id="mbOdds" type="number" step="1" placeholder="-110">
            </div>
            <div class="mb-field">
              <label for="mbStake">Amount ($)</label>
              <input id="mbStake" type="number" step="0.01" min="0" placeholder="50">
            </div>
          </div>
          <div id="mbParlayPanel" style="display:none;"></div>
          <div class="mb-form-actions">
            <button type="button" class="mb-add-leg" id="mbAddLeg" style="display:none;">+ Add leg</button>
            <button type="submit" class="mb-log-btn" id="mbLogBtn">Log bet</button>
            <span class="mb-payout-preview" id="mbPreview"></span>
            <span class="mb-form-msg" id="mbMsg"></span>
          </div>
        </form>
      </div>`;
  }

  // ── PressBox board markers ─────────────────────────────────────────
  // /picks/upcoming ships per-game slots {spread,total,ml} with the
  // board's tier + side. The side dropdown flags the option the board
  // is on — informational only; it never auto-picks a side.
  function boardSlot(g, market) {
    const entry = picksByGame[g.game_id] || picksByGame[String(gid(g))];
    const slots = entry && entry.slots;
    if (!slots) return null;
    return market === 'ml' ? slots.ml : market === 'total' ? slots.total : slots.spread;
  }
  function pbMark(g, market, sideValue) {
    const s = boardSlot(g, market);
    if (!s || !s.tier_full) return '';
    if (/^(ne|no_edge)$/i.test(String(s.tier_full))) return '';
    // side_raw (canonical home/away/over/under) shipped 2026-08-19; fall
    // back to matching the display side against the team names for any
    // cached payload from before it existed.
    let slotSide = s.side_raw ? String(s.side_raw).toLowerCase() : null;
    if (!slotSide && s.side) {
      slotSide = market === 'total'
        ? String(s.side).toLowerCase()
        : (s.side === g.home_team ? 'home' : s.side === g.away_team ? 'away' : null);
    }
    if (slotSide !== sideValue) return '';
    return ` · PressBox ${s.tier_full}`;
  }

  function currentGame() {
    const sel = document.getElementById('mbGame');
    return sel ? gamesById[sel.value] : null;
  }

  function rebuildGameSelect() {
    const sel = document.getElementById('mbGame');
    if (!sel) return;
    const list = weekGames(formWeek);
    sel.innerHTML = list.map(g =>
      `<option value="${gid(g)}">${esc(g.away_team)} @ ${esc(g.home_team)}${g.date ? ` · ${esc(g.date)}` : ''}</option>`).join('');
    onGameChange();
  }

  function rebuildSideSelect() {
    const g = currentGame();
    const market = document.getElementById('mbMarket').value;
    const sel = document.getElementById('mbSide');
    if (!sel || !g) return;
    if (market === 'total') {
      sel.innerHTML = `<option value="over">Over${esc(pbMark(g, 'total', 'over'))}</option>` +
                      `<option value="under">Under${esc(pbMark(g, 'total', 'under'))}</option>`;
    } else {
      sel.innerHTML = `<option value="away">${esc(g.away_team)}${esc(pbMark(g, market, 'away'))}</option>` +
                      `<option value="home">${esc(g.home_team)}${esc(pbMark(g, market, 'home'))}</option>`;
    }
    document.getElementById('mbLineField').style.display = market === 'ml' ? 'none' : '';
  }

  async function fetchQuotes(gameId) {
    if (quotesCache[gameId]) return quotesCache[gameId];
    try {
      const r = await fetch(`${API}/canonical/games/${gameId}/book-quotes`);
      const j = await r.json();
      quotesCache[gameId] = j && Array.isArray(j.books) ? j : { books: [] };
    } catch (e) {
      quotesCache[gameId] = { books: [] };
    }
    return quotesCache[gameId];
  }

  async function onGameChange() {
    rebuildSideSelect();
    const g = currentGame();
    const bookSel = document.getElementById('mbBook');
    if (!g || !bookSel) return;
    bookSel.innerHTML = `<option value="">Loading books…</option>`;
    const quotes = await fetchQuotes(gid(g));
    const cur = currentGame();
    if (!cur || gid(cur) !== gid(g)) return;   // user moved on mid-fetch
    bookSel.innerHTML = bookOptionsHTML(quotes);
    prefill();
  }

  // name -> quote row for the selected game. Keyed by display name because
  // the option values are display names — the same string logged on the bet.
  function quoteByName(q) {
    const m = {};
    for (const b of (q && q.books) || []) m[b.book_display || b.book] = b;
    return m;
  }
  // Every main book is offered whether or not it has posted this game — you
  // bet where you bet; a missing quote only means nothing prefills. (Austin,
  // 2026-08-22: "just don't exclude books.") Quoted books sort first so the
  // default selection still auto-fills; the rest say so in the label.
  function bookOptionsHTML(quotes) {
    const byName = quoteByName(quotes);
    const names = [...new Set([...Object.keys(byName), ...MAIN_BOOKS])];
    names.sort((a, c) => {
      const qa = a in byName, qc = c in byName;
      if (qa !== qc) return qa ? -1 : 1;
      return a.localeCompare(c);
    });
    return names.map(n =>
      `<option value="${esc(n)}">${esc(n)}${n in byName ? '' : ' — no live line'}</option>`).join('');
  }

  function prefill() {
    const g = currentGame();
    if (!g) return;
    const market = document.getElementById('mbMarket').value;
    const side = document.getElementById('mbSide').value;
    const bookSel = document.getElementById('mbBook');
    const q = quotesCache[gid(g)];
    const book = q ? (quoteByName(q)[bookSel.value] || null) : null;
    const lineEl = document.getElementById('mbLine');
    const oddsEl = document.getElementById('mbOdds');
    if (!book) { updatePreview(); return; }
    if (market === 'spread') {
      const line = side === 'home' ? book.spread_home : book.spread_away;
      const px = side === 'home' ? book.spread_home_price : book.spread_away_price;
      if (line != null) lineEl.value = line;
      if (px != null) oddsEl.value = px;
    } else if (market === 'total') {
      if (book.total != null) lineEl.value = book.total;
      const px = side === 'over' ? book.total_over_price : book.total_under_price;
      if (px != null) oddsEl.value = px;
    } else {
      const px = side === 'home' ? book.ml_home : book.ml_away;
      if (px != null) oddsEl.value = px;
    }
    updatePreview();
  }

  function updatePreview() {
    const el = document.getElementById('mbPreview');
    if (!el) return;
    const stake = Number(document.getElementById('mbStake').value);
    // Parlay mode previews the TICKET's combined price, not the leg fields.
    const odds = mode === 'parlay'
      ? Number(document.getElementById('mbTicketOdds')?.value)
      : Number(document.getElementById('mbOdds').value);
    const win = winAmount(stake, odds);
    el.innerHTML = (win != null)
      ? `Profit if it wins: <b>${esc(fmtMoney(win))}</b> · total back: <b>${esc(fmtMoney(win + stake))}</b>`
      : '';
  }

  // ── Parlay builder ─────────────────────────────────────────────────
  function setMode(m) {
    mode = m;
    document.querySelectorAll('.mb-mode button').forEach(b =>
      b.classList.toggle('active', b.getAttribute('data-mode') === m));
    document.getElementById('mbAddLeg').style.display = m === 'parlay' ? '' : 'none';
    document.getElementById('mbLogBtn').textContent = m === 'parlay' ? 'Log parlay' : 'Log bet';
    renderParlayPanel();
    updatePreview();
  }

  function renderParlayPanel() {
    const panel = document.getElementById('mbParlayPanel');
    if (!panel) return;
    panel.style.display = mode === 'parlay' ? '' : 'none';
    if (mode !== 'parlay') return;
    const chips = parlayLegs.map((l, i) =>
      `<span class="mb-leg-chip">${esc(l.side_label)} <span class="mb-leg-odds">${esc(fmtOdds(l.odds))}</span>` +
      `<button type="button" data-legdel="${i}" aria-label="Remove leg">✕</button></span>`).join('');
    const dec = parlayLegs.reduce((d, l) => {
      const x = amToDec(l.odds);
      return (d != null && x != null) ? d * x : null;
    }, 1);
    const combined = (parlayLegs.length >= 2 && dec) ? decToAm(dec) : null;
    panel.innerHTML = `
      <div class="mb-legs">${chips || '<span class="mb-legs-empty">No legs yet — set the fields above, then “+ Add leg”. Two or more legs make a ticket.</span>'}</div>
      <div class="mb-parlay-meta">
        <span class="mb-field mb-ticket-odds"><label for="mbTicketOdds">Ticket odds (American)</label>
          <input id="mbTicketOdds" type="number" step="1" value="${combined != null ? combined : ''}" placeholder="+594"></span>
        <span class="mb-parlay-hint">${parlayLegs.length} leg${parlayLegs.length === 1 ? '' : 's'}${combined != null ? ` · legs multiply to ${esc(fmtOdds(combined))} — edit to your book's actual ticket price` : ''}</span>
      </div>`;
    panel.querySelectorAll('[data-legdel]').forEach(b => b.addEventListener('click', () => {
      parlayLegs.splice(Number(b.getAttribute('data-legdel')), 1);
      renderParlayPanel(); updatePreview();
    }));
    const to = panel.querySelector('#mbTicketOdds');
    if (to) to.addEventListener('input', updatePreview);
    updatePreview();
  }

  function addLeg() {
    const msg = document.getElementById('mbMsg');
    msg.className = 'mb-form-msg'; msg.textContent = '';
    const fail = (t) => { msg.className = 'mb-form-msg err'; msg.textContent = t; };
    const g = currentGame();
    if (!g) return fail('Pick a game.');
    const market = document.getElementById('mbMarket').value;
    const side = document.getElementById('mbSide').value;
    const odds = Math.round(Number(document.getElementById('mbOdds').value));
    if (!isFinite(odds) || Math.abs(odds) < 100 || document.getElementById('mbOdds').value === '')
      return fail('Set the leg’s odds first.');
    let line = null;
    if (market !== 'ml') {
      const lineRaw = document.getElementById('mbLine').value;
      line = Number(lineRaw);
      if (!isFinite(line) || lineRaw === '') return fail('Set the leg’s line first.');
    }
    const bookSel = document.getElementById('mbBook');
    const q = quotesCache[gid(g)];
    const book = q ? (quoteByName(q)[bookSel.value] || null) : null;
    const dupIdx = parlayLegs.findIndex(l => l.game_id === gid(g) && l.market === market);
    const legObj = {
      game_id: gid(g), week: g.week, kickoff: g.raw_date || null,
      market, side, line, odds,
      side_label: sideLabelFor(g, market, side, line),
      game_label: `${g.away_team} @ ${g.home_team}`,
      book: bookSel.value || null,
    };
    if (dupIdx >= 0) parlayLegs[dupIdx] = legObj;   // re-adding the same market replaces
    else parlayLegs.push(legObj);
    renderParlayPanel();
  }

  function sideLabelFor(g, market, side, line) {
    if (market === 'total') return `${side === 'over' ? 'Over' : 'Under'} ${String(line).replace(/\.0$/, '')}`;
    const team = side === 'home' ? g.home_team : g.away_team;
    if (market === 'ml') return `${team} ML`;
    return `${team} ${fmtSignedLine(line)}`;
  }

  async function logBet(ev) {
    ev.preventDefault();
    const msg = document.getElementById('mbMsg');
    const btn = document.getElementById('mbLogBtn');
    msg.className = 'mb-form-msg';
    msg.textContent = '';

    if (mode === 'parlay') return logParlay(msg, btn);

    const g = currentGame();
    const market = document.getElementById('mbMarket').value;
    const side = document.getElementById('mbSide').value;
    const bookSel = document.getElementById('mbBook');
    const q = g ? quotesCache[gid(g)] : null;
    // The option value IS the display name — no quote row needed here.
    const lineRaw = document.getElementById('mbLine').value;
    const odds = Math.round(Number(document.getElementById('mbOdds').value));
    const stake = Number(document.getElementById('mbStake').value);

    const fail = (t) => { msg.className = 'mb-form-msg err'; msg.textContent = t; };
    if (!g) return fail('Pick a game.');
    if (!isFinite(odds) || Math.abs(odds) < 100) return fail('Odds must be American (±100 or beyond).');
    if (!(stake > 0)) return fail('Enter an amount.');
    let line = null;
    if (market !== 'ml') {
      line = Number(lineRaw);
      if (!isFinite(line) || lineRaw === '') return fail('Enter the line on your side.');
    }

    const payload = {
      season: SEASON,
      week: g.week,
      game_id: gid(g),
      game_label: `${g.away_team} @ ${g.home_team}`,
      kickoff: g.raw_date || null,
      market,
      side,
      side_label: sideLabelFor(g, market, side, line),
      line,
      odds,
      stake,
      book: bookSel.value || null,
    };

    btn.disabled = true;
    const { data, error } = await sb.from('user_bets').insert(payload).select().single();
    btn.disabled = false;
    if (error) {
      console.error('user_bets insert failed', error);
      return fail(/relation .* does not exist/i.test(error.message || '')
        ? 'Ledger storage isn’t provisioned yet — check back shortly.'
        : 'Couldn’t save that ticket. Try again.');
    }
    bets.unshift(data);
    msg.textContent = 'Logged.';
    document.getElementById('mbStake').value = '';
    renderLedgerAndHero();
  }

  async function logParlay(msg, btn) {
    const fail = (t) => { msg.className = 'mb-form-msg err'; msg.textContent = t; };
    if (parlayLegs.length < 2) return fail('A parlay needs at least two legs — add them with “+ Add leg”.');
    const tOddsEl = document.getElementById('mbTicketOdds');
    const tOdds = Math.round(Number(tOddsEl && tOddsEl.value));
    if (!isFinite(tOdds) || Math.abs(tOdds) < 100 || !tOddsEl || tOddsEl.value === '')
      return fail('Enter the ticket’s combined odds.');
    const stake = Number(document.getElementById('mbStake').value);
    if (!(stake > 0)) return fail('Enter an amount.');

    const kicks = parlayLegs.map(l => l.kickoff).filter(Boolean).sort();
    const legBooks = [...new Set(parlayLegs.map(l => l.book).filter(Boolean))];
    const payload = {
      season: SEASON,
      week: Math.min(...parlayLegs.map(l => l.week)),
      game_id: null,
      game_label: `Parlay — ${parlayLegs.length} legs`,
      kickoff: kicks[0] || null,           // first kick locks the whole ticket
      market: 'parlay',
      side: 'parlay',
      side_label: `${parlayLegs.length}-leg parlay`,
      line: null,
      odds: tOdds,
      stake,
      book: legBooks.length === 1 ? legBooks[0] : null,
      legs: parlayLegs.map(l => ({
        game_id: l.game_id, market: l.market, side: l.side, line: l.line,
        odds: l.odds, side_label: l.side_label, game_label: l.game_label,
        kickoff: l.kickoff,
      })),
    };
    btn.disabled = true;
    const { data, error } = await sb.from('user_bets').insert(payload).select().single();
    btn.disabled = false;
    if (error) {
      console.error('parlay insert failed', error);
      return fail(/legs|parlay|constraint/i.test(error.message || '')
        ? 'The parlay migration hasn’t been run yet — paste the second SQL block in Supabase.'
        : 'Couldn’t save that ticket. Try again.');
    }
    bets.unshift(data);
    parlayLegs = [];
    renderParlayPanel();
    msg.textContent = 'Parlay logged.';
    document.getElementById('mbStake').value = '';
    renderLedgerAndHero();
  }

  // ── Ledger ─────────────────────────────────────────────────────────
  // ── LIVE STANDING ──────────────────────────────────────────────────
  // While a game is in progress, say where the ticket stands against YOUR
  // number — not the board's. Glyphs follow the house convention: ▲/▼ mean
  // "in progress, ahead/behind", ✓/✕ mean settled. A live bet must never
  // wear a settled mark. (Austin, 2026-08-20)
  function liveGame(b) {
    const g = gamesById[b.game_id];
    if (!g || g.status !== 'in_progress') return null;
    if (g.home_points == null || g.away_points == null) return null;
    return g;
  }
  function clockOf(g) {
    const q = g.current_period ? `Q${g.current_period}` : '';
    return [q, g.current_clock].filter(Boolean).join(' ');
  }
  // → { ahead: true|false|null, text: '…' }.  null = dead even / can't call.
  function standing(b, g) {
    const hp = g.home_points, ap = g.away_points;
    const homeName = g.home_team, awayName = g.away_team;
    if (b.market === 'total') {
      const tot = hp + ap, line = Number(b.line);
      const diff = +(tot - line).toFixed(1);
      if (diff === 0) return { ahead: null, text: `total sitting on ${line}` };
      const under = diff < 0;
      return { ahead: (b.side === 'under') === under,
               text: `total ${Math.abs(diff)} ${under ? 'under' : 'over'} the number` };
    }
    const weHome = b.side === 'home';
    const ourPts = weHome ? hp : ap, theirPts = weHome ? ap : hp;
    const ourName = weHome ? homeName : awayName;
    const margin = ourPts - theirPts;                    // + = we lead
    if (b.market === 'ml') {
      if (margin === 0) return { ahead: null, text: 'tied' };
      return { ahead: margin > 0,
               text: `${ourName} ${margin > 0 ? 'up' : 'down'} ${Math.abs(margin)}` };
    }
    // spread: our line is picked-side POV (+6.5 = getting 6.5)
    const cushion = +(margin + Number(b.line)).toFixed(1);
    if (cushion === 0) return { ahead: null, text: 'sitting exactly on the number' };
    const state = margin === 0 ? 'tied'
      : `${ourName} ${margin > 0 ? 'up' : 'down'} ${Math.abs(margin)}`;
    return { ahead: cushion > 0,
             text: `${state}, ${cushion > 0 ? 'covering by' : 'short by'} ${Math.abs(cushion)}` };
  }
  // A parlay is only alive while every leg is; one dead leg kills the ticket.
  function parlayStanding(b) {
    const legs = b.legs || [];
    let live = 0, ahead = 0, done = 0;
    for (const l of legs) {
      const g = gamesById[l.game_id];
      if (!g) continue;
      if (g.status === 'in_progress' && g.home_points != null) {
        live++;
        const s = standing(l, g);
        if (s.ahead === true) ahead++;
      } else if (g.status === 'final') { done++; }
    }
    if (!live) return null;
    return { ahead: ahead === live ? true : null,
             text: `${ahead} of ${legs.length} legs ahead${done ? `, ${done} final` : ''}` };
  }

  function markFor(b) {
    if (!b.result) {
      if (b.market === 'parlay') {
        const s = parlayStanding(b);
        if (s) return [s.ahead ? 'live-ahead' : 'live-behind', s.ahead ? '▲' : '▼'];
      } else {
        const g = liveGame(b);
        if (g) {
          const s = standing(b, g);
          if (s.ahead === true)  return ['live-ahead', '▲'];
          if (s.ahead === false) return ['live-behind', '▼'];
          return ['pending', '–'];
        }
      }
      return ['pending', '–'];
    }
    if (b.result === 'W') return ['win', '✓'];
    if (b.result === 'L') return ['loss', '✕'];
    return ['push', '–'];
  }
  // ── Did the market come to you after you bet? ──────────────────────────
  //
  // Live Lines asks "released number vs now" — our record. This asks YOUR
  // number vs now, which is your closing-line value, and the colours are the
  // OPPOSITE of every other surface ON PURPOSE (Austin, 2026-08-21):
  //
  //   board / game page / allocator   you are about to bet, so a market that
  //                                   moved toward the pick means the good
  //                                   number is gone. Rust.
  //   here                            the bet is already down. A market that
  //                                   moved toward you means you got the
  //                                   number before it went. Sage.
  //
  // Only pregame and unsettled: once a game kicks, the row's job is the
  // result, not what the line did. That also keeps this to a couple of quote
  // fetches rather than one per historical ticket.
  const MB_MOVE_GLYPH = { up: '↑', down: '↓', left: '←', right: '→' };
  let moveByBet = {};
  // Silence is ambiguous — it could mean "nothing moved" or "this is
  // broken". Track the scan so the ledger can say which. (2026-08-21)
  let moveScan = { ran: false, open: 0, quoted: 0, found: 0 };

  const _dec = (o) => (o == null ? null : (o > 0 ? 1 + o / 100 : 1 + 100 / -o));

  // Best number CURRENTLY available for the side this ticket is on. Best, not
  // consensus — it is the like-for-like comparison, since a bettor shops.
  function bestNow(quotes, market, side) {
    const vals = [];
    for (const bk of (quotes.books || [])) {
      let v = null;
      if (market === 'spread') v = side === 'home' ? bk.spread_home : bk.spread_away;
      else if (market === 'total') v = bk.total;
      // book-quotes renames the moneyline columns on the way out: the payload
      // says ml_home / ml_away, NOT the live_odds column names. prefill()
      // above already reads them correctly; this read did not, so every
      // moneyline ticket silently produced no marker. (2026-08-21)
      else if (market === 'ml') v = side === 'home' ? bk.ml_home : bk.ml_away;
      if (v != null && !Number.isNaN(Number(v))) vals.push(Number(v));
    }
    if (!vals.length) return null;
    if (market === 'ml') return vals.sort((a, c) => _dec(c) - _dec(a))[0];  // pays most
    if (market === 'spread') return Math.max(...vals);                      // most points
    return side === 'over' ? Math.min(...vals) : Math.max(...vals);         // best total
  }

  function computeMove(b, quotes) {
    const market = b.market, side = b.side;
    if (!market || market === 'parlay') return null;
    const now = bestNow(quotes, market, side);
    if (now == null) return null;
    const mine = Number(market === 'ml' ? b.odds : b.line);
    if (!Number.isFinite(mine) || Math.abs(now - mine) < 0.01) return null;

    let toward;
    if (market === 'ml')          toward = _dec(now) < _dec(mine);   // shorter price
    else if (market === 'spread') toward = now < mine;               // fewer points
    else                          toward = side === 'over' ? now > mine : now < mine;

    const arrow = market === 'total' ? (now > mine ? 'up' : 'down')
                                     : (toward ? 'left' : 'right');
    const fmt = (v) => market === 'spread' ? (v > 0 ? `+${v}` : `${v}`)
                     : market === 'ml'     ? (v > 0 ? `+${v}` : `${v}`)
                     : `${v}`;
    let text;
    if (market === 'ml') {
      text = `Market moved ${toward ? 'toward' : 'away from'} your bet`;
    } else {
      const pts = Math.abs(+(now - mine).toFixed(1));
      text = `Market moved ${pts} ${pts === 1 ? 'pt' : 'pts'} ` +
             `${toward ? 'toward' : 'away from'} your bet`;
    }
    return { direction: toward ? 'toward' : 'away', arrow, text,
             yours: fmt(mine), now: fmt(now) };
  }

  async function enrichLineMoves() {
    const open = bets.filter(b => !b.result && b.market !== 'parlay'
                                  && b.game_id && isPregame(b.kickoff));
    moveScan = { ran: true, open: open.length, quoted: 0, found: 0 };
    if (!open.length) { renderLedgerAndHero(); return; }
    const games = [...new Set(open.map(b => b.game_id))];
    await Promise.all(games.map(g => fetchQuotes(g).catch(() => null)));
    for (const b of open) {
      const q = quotesCache[b.game_id];
      if (!q || !(q.books || []).length) continue;
      moveScan.quoted += 1;
      const mv = computeMove(b, q);
      if (mv) { moveByBet[b.id] = mv; moveScan.found += 1; }
    }
    renderLedgerAndHero();
  }

  // Say WHY there is no marker, instead of leaving the reader to guess
  // whether the feature is broken. Only speaks when there is something to
  // explain: open pregame tickets, quotes fetched, and nothing moved.
  function moveNote() {
    if (!moveScan.ran || !moveScan.open || moveScan.found) return '';
    if (!moveScan.quoted) {
      return '<div class="mb-move-note">No live book quotes for your open ' +
             'games right now, so line movement can’t be checked.</div>';
    }
    return '<div class="mb-move-note">No line movement on your open tickets ' +
           '— you’re still on the best number posted.</div>';
  }

  function renderMyBetsMove(b) {
    const mv = moveByBet[b.id];
    if (!mv) return '';
    // Inverted against every other surface — see the block comment above.
    const good = mv.direction === 'toward';
    return `<div class="mb-row-move mb-row-move--${good ? 'good' : 'bad'}">` +
           `<span class="mb-row-move-arrow" aria-hidden="true">${MB_MOVE_GLYPH[mv.arrow] || ''}</span>` +
           `${esc(mv.text)} <span class="mb-row-move-nums">` +
           `${esc(mv.yours)} &rarr; ${esc(mv.now)}</span></div>`;
  }

  function rowHTML(b) {
    const [cls, glyph] = markFor(b);
    const settled = !!b.result;
    const net = Number(b.profit) || 0;
    const netCls = !settled ? 'flat' : net > 0 ? 'pos' : net < 0 ? 'neg' : 'flat';
    const netTxt = !settled ? 'Pending'
      : b.result === 'P' ? 'Push'
      : b.result === 'V' ? 'Void'
      : fmtMoney(net, { signed: true });
    const canDelete = !settled && isPregame(b.kickoff);
    // Once the ball is in the air the kickoff time is dead weight — the clock
    // and where the ticket stands are what you want at a glance on a phone.
    let live = null;
    if (!settled) {
      if (b.market === 'parlay') {
        const s = parlayStanding(b);
        if (s) live = s.text;
      } else {
        const g = liveGame(b);
        if (g) live = [clockOf(g), standing(b, g).text].filter(Boolean).join(' · ');
      }
    }
    const sub = live
      ? `<span class="mb-live">${esc(live)}</span>` +
        (b.book ? ` · ${esc(b.book)}` : '')
      : esc(b.market === 'parlay'
          ? [(b.legs || []).map(l => l.side_label).join('  +  '), b.book,
             b.kickoff ? `first kick ${fmtKick(b.kickoff)}` : null].filter(Boolean).join(' · ')
          : [b.game_label, fmtKick(b.kickoff), b.book].filter(Boolean).join(' · '));
    return `
      <div class="mb-row" data-id="${esc(b.id)}">
        <div class="mb-row-mark ${cls}">${glyph}</div>
        <div class="mb-row-body">
          <div class="mb-row-pick">${esc(b.side_label)} <span class="mb-odds">${esc(fmtOdds(b.odds))}</span></div>
          <div class="mb-row-sub">${sub}</div>
          ${renderMyBetsMove(b)}
        </div>
        <div class="mb-row-money">
          <div class="mb-row-net ${netCls}">${esc(netTxt)}</div>
          <div class="mb-row-stake">${esc(fmtMoney(b.stake))} stake</div>
        </div>
        ${canDelete ? `<button type="button" class="mb-row-editbtn" data-edit="${esc(b.id)}" aria-label="Edit ticket">✎</button><button type="button" class="mb-row-del" data-del="${esc(b.id)}" aria-label="Delete ticket">✕</button>` : ''}
      </div>
      ${String(editingId) === String(b.id) ? editRowHTML(b) : ''}`;
  }

  // Pregame and unsettled only — the same gate as delete, enforced again
  // by RLS server-side. Numbers and book only: the game, market and side
  // ARE the bet; if those are wrong it's a different ticket — delete and
  // re-log.
  function editRowHTML(b) {
    const isParlay = b.market === 'parlay';
    const isMl = b.market === 'ml';
    const books = [...new Set([b.book, ...MAIN_BOOKS].filter(Boolean))];
    return `
      <div class="mb-edit">
        <div class="mb-edit-grid">
          <label class="mb-edit-field">Book
            <select id="mbe-book">${books.map(n =>
              `<option value="${esc(n)}"${n === b.book ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>
          </label>
          ${(isParlay || isMl) ? '' : `
          <label class="mb-edit-field">Line (your side)
            <input id="mbe-line" type="number" step="0.5" value="${esc(b.line ?? '')}">
          </label>`}
          <label class="mb-edit-field">Odds
            <input id="mbe-odds" type="number" step="1" value="${esc(b.odds ?? '')}">
          </label>
          <label class="mb-edit-field">Amount
            <input id="mbe-stake" type="number" step="0.01" min="0" value="${esc(b.stake ?? '')}">
          </label>
        </div>
        <div class="mb-edit-actions">
          <button type="button" class="mb-edit-save" data-editsave="${esc(b.id)}">Save</button>
          <button type="button" class="mb-edit-cancel" data-editcancel>Cancel</button>
          <span class="mb-edit-msg" id="mbe-msg"></span>
        </div>
      </div>`;
  }

  async function saveEdit(id) {
    const b = bets.find(x => String(x.id) === String(id));
    const msgEl = document.getElementById('mbe-msg');
    const fail = (t) => { if (msgEl) msgEl.textContent = t; };
    if (!b) return;
    const book = (document.getElementById('mbe-book') || {}).value || null;
    const odds = Math.round(Number((document.getElementById('mbe-odds') || {}).value));
    const stake = Number((document.getElementById('mbe-stake') || {}).value);
    if (!isFinite(odds) || Math.abs(odds) < 100) return fail('Odds must be American (±100 or beyond).');
    if (!(stake > 0)) return fail('Enter an amount.');
    const patch = { book, odds, stake };
    if (b.market !== 'ml' && b.market !== 'parlay') {
      const lineEl = document.getElementById('mbe-line');
      const line = Number(lineEl && lineEl.value);
      if (!lineEl || lineEl.value === '' || !isFinite(line)) return fail('Enter the line on your side.');
      patch.line = line;
      // side_label embeds the line ("Memphis +6.5"), so it must follow it.
      const g = gamesById[b.game_id];
      if (g) patch.side_label = sideLabelFor(g, b.market, b.side, line);
    }
    try {
      const { data, error } = await sb.from('user_bets')
        .update(patch).eq('id', b.id).select();
      if (error) throw error;
      if (!data || !data.length) return fail("Couldn't save — edits are pregame only.");
      Object.assign(b, data[0]);
      editingId = null;
      delete moveByBet[b.id];          // the marker is stale vs the new numbers
      renderLedgerAndHero();
      enrichLineMoves();
    } catch (e) {
      fail((e && e.message) || 'Save failed.');
    }
  }
  // Austin's standard order (2026-08-22): "nearest to kickoff first,
  // finished games at the bottom, and then once they're all done they go
  // back to chronological order." One key does all three:
  //     (settled ? 1 : 0, kickoff ascending)
  // Pregame: soonest kick on top. During the slate: LIVE tickets (earliest
  // kickoffs, unsettled) float above upcoming, finished sink. All settled:
  // kickoff-ascending IS chronological. Numeric epoch compare — no locale
  // ordering traps. Missing kickoff sorts to the bottom of its half.
  function ledgerOrder(rows) {
    const t = (b) => {
      const d = kickoffDate(b.kickoff);
      return d ? d.getTime() : 8.64e15;          // no kickoff -> far future
    };
    return [...rows].sort((a, b) =>
      ((a.result ? 1 : 0) - (b.result ? 1 : 0)) || (t(a) - t(b)));
  }

  function ledgerToolsHTML() {
    const books = [...new Set(bets.map(b => b.book).filter(Boolean))].sort();
    return `
      <div class="mb-ledger-tools">
        <label>Book
          <select id="mbLedgerBook">
            <option value="">All books</option>
            ${books.map(n => `<option value="${esc(n)}"${ledgerBook === n ? ' selected' : ''}>${esc(n)}</option>`).join('')}
          </select>
        </label>
      </div>`;
  }

  function ledgerHTML() {
    if (!ledgerReady) {
      return `<div class="mb-section"><div class="mb-empty">The ledger backend isn’t provisioned yet — check back shortly.</div></div>`;
    }
    if (!bets.length) {
      return `<div class="mb-section">
        <div class="mb-section-eyebrow">The ledger</div>
        <h2 class="mb-section-title">Every ticket, <em>on the record</em></h2>
        <div class="mb-empty">Nothing logged yet. Your first ticket starts the record.</div>
      </div>`;
    }
    const visible = ledgerBook ? bets.filter(b => b.book === ledgerBook) : bets;
    const byWeek = {};
    visible.forEach(b => { (byWeek[b.week] = byWeek[b.week] || []).push(b); });
    const weeksDesc = Object.keys(byWeek).map(Number).sort((a, b) => b - a);
    const groups = weeksDesc.map(w => {
      const rows = ledgerOrder(byWeek[w]);
      const settled = rows.filter(b => b.result);
      const net = settled.reduce((a, b) => a + (Number(b.profit) || 0), 0);
      const netTxt = settled.length ? fmtMoney(net, { signed: true }) : '';
      return `
        <div class="mb-week-group">
          <div class="mb-week-head"><span>Week ${w}</span><span>${esc(netTxt)}</span></div>
          ${rows.map(rowHTML).join('')}
        </div>`;
    }).join('');
    const body = groups || `<div class="mb-empty">No tickets at ${esc(ledgerBook)} yet.</div>`;
    return `<div class="mb-section">
      <div class="mb-section-eyebrow">The ledger</div>
      <h2 class="mb-section-title">Every ticket, <em>on the record</em></h2>
      ${ledgerToolsHTML()}
      ${body}
      ${moveNote()}
    </div>`;
  }

  async function deleteBet(id) {
    const b = bets.find(x => String(x.id) === String(id));
    if (!b) return;
    if (!window.confirm(`Delete ${b.side_label} (${fmtOdds(b.odds)}, ${fmtMoney(b.stake)})? Pregame only — once it kicks, the ticket stands.`)) return;
    const { error } = await sb.from('user_bets').delete().eq('id', id);
    if (error) { console.error('delete failed', error); return; }
    bets = bets.filter(x => String(x.id) !== String(id));
    renderLedgerAndHero();
  }

  // ── Render / wire ──────────────────────────────────────────────────
  function renderLedgerAndHero() {
    document.getElementById('mbHeroMount').innerHTML = heroHTML();
    document.getElementById('mbLedgerMount').innerHTML = ledgerHTML();
    wireHero();
    wireLedger();
  }
  function wireHero() {
    document.querySelectorAll('.mb-scope button').forEach(btn => {
      btn.addEventListener('click', () => {
        heroScope = btn.getAttribute('data-scope');
        renderLedgerAndHero();
      });
    });
  }
  function wireLedger() {
    document.querySelectorAll('[data-del]').forEach(btn => {
      btn.addEventListener('click', () => deleteBet(btn.getAttribute('data-del')));
    });
    document.querySelectorAll('[data-edit]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-edit');
        editingId = String(editingId) === String(id) ? null : id;
        renderLedgerAndHero();
      });
    });
    document.querySelectorAll('[data-editcancel]').forEach(btn => {
      btn.addEventListener('click', () => { editingId = null; renderLedgerAndHero(); });
    });
    document.querySelectorAll('[data-editsave]').forEach(btn => {
      btn.addEventListener('click', () => saveEdit(btn.getAttribute('data-editsave')));
    });
    const fb = document.getElementById('mbLedgerBook');
    if (fb) fb.addEventListener('change', () => {
      ledgerBook = fb.value || null;
      renderLedgerAndHero();
    });
  }
  function wireForm() {
    document.getElementById('mbWeek').addEventListener('change', (e) => {
      formWeek = Number(e.target.value);
      rebuildGameSelect();
      if (heroScope === 'week') renderLedgerAndHero();
    });
    document.getElementById('mbGame').addEventListener('change', onGameChange);
    document.getElementById('mbMarket').addEventListener('change', () => { rebuildSideSelect(); prefill(); });
    document.getElementById('mbSide').addEventListener('change', prefill);
    document.getElementById('mbBook').addEventListener('change', prefill);
    document.getElementById('mbOdds').addEventListener('input', updatePreview);
    document.getElementById('mbStake').addEventListener('input', updatePreview);
    document.getElementById('mbForm').addEventListener('submit', logBet);
    document.getElementById('mbAddLeg').addEventListener('click', addLeg);
    document.querySelectorAll('.mb-mode button').forEach(b =>
      b.addEventListener('click', () => setMode(b.getAttribute('data-mode'))));
  }

  // ── Allocator import ───────────────────────────────────────────────
  // allocator.html stashes its sized sheet in localStorage and sends the
  // user here. Every number stays editable — the sheet is a suggestion,
  // the ledger records the ticket actually placed.
  const IMPORT_KEY = 'pb_mybets_import';

  function loadImport() {
    try {
      const raw = localStorage.getItem(IMPORT_KEY);
      if (!raw) return;
      const stash = JSON.parse(raw);
      if (stash && Array.isArray(stash.rows) && stash.rows.length) importRows = stash;
    } catch (e) { importRows = null; }
  }
  function clearImport() {
    importRows = null;
    try { localStorage.removeItem(IMPORT_KEY); } catch (e) {}
    const m = document.getElementById('mbImportMount');
    if (m) m.innerHTML = '';
  }

  function importRowLabel(r) {
    if (r.type === 'parlay') {
      const legTxt = (r.legs || []).map(l => l.side_label).join('  +  ');
      return `<div class="mb-row-pick">${(r.legs || []).length}-leg parlay <span class="mb-odds">${esc(fmtOdds(r.odds))}</span></div>
              <div class="mb-row-sub">${esc(legTxt)}</div>`;
    }
    return `<div class="mb-row-pick">${esc(r.side_label)} <span class="mb-odds">${esc(fmtOdds(r.odds))}</span></div>
            <div class="mb-row-sub">${esc([r.game_label, r.book].filter(Boolean).join(' · '))}</div>`;
  }

  function renderImport() {
    const mount = document.getElementById('mbImportMount');
    if (!mount) return;
    if (!importRows) { mount.innerHTML = ''; return; }
    const ageMin = Math.max(0, Math.round((Date.now() - (importRows.at || Date.now())) / 60000));
    const stale = ageMin > 45;
    const rowsHtml = importRows.rows.map((r, i) => `
      <div class="mb-import-row" data-idx="${i}">
        <input type="checkbox" class="mb-imp-on" checked aria-label="Include this ticket">
        <div class="mb-import-body">${importRowLabel(r)}</div>
        <span class="mb-imp-field"><label>$</label><input class="mb-imp-stake" type="number" step="1" min="1" value="${Number(r.stake) || ''}"></span>
        <span class="mb-imp-field"><label>Odds</label><input class="mb-imp-odds" type="number" step="1" value="${r.odds != null ? r.odds : ''}"></span>
        ${r.type === 'single' && r.market !== 'ml'
          ? `<span class="mb-imp-field"><label>Line</label><input class="mb-imp-line" type="number" step="0.5" value="${r.line != null ? r.line : ''}"></span>`
          : `<span class="mb-imp-field mb-imp-spacer"></span>`}
      </div>`).join('');
    mount.innerHTML = `
      <div class="mb-section">
        <div class="mb-import">
          <div class="mb-import-head">
            <div>
              <div class="mb-section-eyebrow">From the Allocator</div>
              <div class="mb-import-title">$${esc(fmtMoney(importRows.amount || 0).replace('$', ''))} sheet${importRows.book ? ` at ${esc(importRows.book)}` : ''} · pulled ${ageMin} min ago</div>
              <div class="mb-import-hint">${stale ? 'The board re-grades every 30 minutes — these numbers may have moved. ' : ''}Stakes, odds, and lines are editable — log the tickets you actually place.</div>
            </div>
          </div>
          ${rowsHtml}
          <div class="mb-form-actions">
            <button type="button" class="mb-log-btn" id="mbImportLog">Log selected</button>
            <button type="button" class="mb-import-dismiss" id="mbImportDismiss">Dismiss</button>
            <span class="mb-form-msg" id="mbImportMsg"></span>
          </div>
        </div>
      </div>`;
    document.getElementById('mbImportLog').addEventListener('click', logImports);
    document.getElementById('mbImportDismiss').addEventListener('click', clearImport);
  }

  function importPayload(r, stake, odds, line) {
    if (r.type === 'parlay') {
      const legs = (r.legs || []).map(l => ({
        game_id: l.game_id, market: l.market, side: l.side, line: l.line,
        odds: l.odds, side_label: l.side_label, game_label: l.game_label,
        kickoff: l.kickoff,
      }));
      const kicks = legs.map(l => l.kickoff).filter(Boolean).sort();
      return {
        season: SEASON, week: r.week, game_id: null,
        game_label: `Parlay — ${legs.length} legs`, kickoff: kicks[0] || null,
        market: 'parlay', side: 'parlay', side_label: `${legs.length}-leg parlay`,
        line: null, odds, stake, book: r.book || null, legs,
      };
    }
    // Rebuild the label when the line was edited, so the ledger reads true.
    const side_label = r.market === 'ml' ? `${r.side_team} ML`
      : r.market === 'total' ? `${r.side === 'over' ? 'Over' : 'Under'} ${String(line).replace(/\.0$/, '')}`
      : `${r.side_team} ${fmtSignedLine(line)}`;
    return {
      season: SEASON, week: r.week, game_id: r.game_id,
      game_label: r.game_label, kickoff: r.kickoff || null,
      market: r.market, side: r.side, side_label,
      line: r.market === 'ml' ? null : line,
      odds, stake, book: r.book || null,
    };
  }

  async function logImports() {
    const msg = document.getElementById('mbImportMsg');
    const btn = document.getElementById('mbImportLog');
    msg.className = 'mb-form-msg'; msg.textContent = '';
    const rows = [...document.querySelectorAll('.mb-import-row')];
    const jobs = [];
    for (const el of rows) {
      if (!el.querySelector('.mb-imp-on').checked) continue;
      const r = importRows.rows[Number(el.getAttribute('data-idx'))];
      const stake = Number(el.querySelector('.mb-imp-stake').value);
      const odds = Math.round(Number(el.querySelector('.mb-imp-odds').value));
      const lineEl = el.querySelector('.mb-imp-line');
      const line = lineEl ? Number(lineEl.value) : null;
      if (!(stake > 0) || !isFinite(odds) || Math.abs(odds) < 100) {
        msg.className = 'mb-form-msg err';
        msg.textContent = 'Every selected ticket needs a stake and American odds.';
        return;
      }
      if (lineEl && (lineEl.value === '' || !isFinite(line))) {
        msg.className = 'mb-form-msg err';
        msg.textContent = 'A selected spread/total ticket is missing its line.';
        return;
      }
      jobs.push(importPayload(r, stake, odds, line));
    }
    if (!jobs.length) { msg.textContent = 'Nothing selected.'; return; }
    btn.disabled = true;
    let logged = 0, failed = 0;
    for (const payload of jobs) {
      const { data, error } = await sb.from('user_bets').insert(payload).select().single();
      if (error) { console.error('import insert failed', error, payload); failed++; continue; }
      bets.unshift(data); logged++;
    }
    btn.disabled = false;
    if (failed) {
      msg.className = 'mb-form-msg err';
      msg.textContent = `Logged ${logged}, ${failed} failed — parlay rows need the second migration.`;
    } else {
      clearImport();
    }
    renderLedgerAndHero();
  }

  // ── Live refresh ───────────────────────────────────────────────────
  // Poll only while a game with money on it is actually running, and stop
  // the moment none are. Nothing here writes: the settler still owns
  // results, this only re-reads the scoreboard.
  let liveTimer = null;
  function anyLive() {
    return bets.some(b => !b.result && (
      b.market === 'parlay'
        ? (b.legs || []).some(l => (gamesById[l.game_id] || {}).status === 'in_progress')
        : (gamesById[b.game_id] || {}).status === 'in_progress'));
  }
  async function refreshScores() {
    try {
      const { data: { session } } = await sb.auth.getSession();
      if (!session) return;
      const r = await fetch(`${API}/games/upcoming?season=${SEASON}`, {
        credentials: 'omit',
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });
      if (!r.ok) return;
      const j = await r.json();
      (j.games || []).forEach(g => { gamesById[gid(g)] = g; });
      renderLedgerAndHero();
    } catch (e) { /* a dropped poll is not worth a visible error */ }
  }
  function startLiveLoop() {
    if (liveTimer) clearInterval(liveTimer);
    liveTimer = setInterval(() => {
      if (!anyLive()) return;             // idle cheaply between game days
      refreshScores();
    }, 30000);
  }

  // ?demo=live — fabricate in-progress states CLIENT-SIDE so the live view
  // can be checked before any real game kicks. Writes nothing, and the
  // banner makes clear the scores are invented. Same pattern the game page
  // and Upcoming already use.
  function applyDemoLive() {
    const targets = bets.filter(b => !b.result).slice(0, 6);
    let i = 0;
    for (const b of targets) {
      const ids = b.market === 'parlay'
        ? (b.legs || []).map(l => l.game_id) : [b.game_id];
      for (const id of ids) {
        const g = gamesById[id];
        if (!g || g.status === 'in_progress') continue;
        const scripts = [[24, 17], [10, 20], [31, 28], [13, 13], [7, 24], [35, 14]];
        const [hp, ap] = scripts[i++ % scripts.length];
        Object.assign(g, { status: 'in_progress', home_points: hp, away_points: ap,
                           current_period: (i % 4) + 1, current_clock: '7:2' + (i % 10) });
      }
    }
    const el = document.getElementById('mb-app');
    if (el) {
      const w = document.createElement('div');
      w.className = 'mb-demo-banner';
      w.textContent = 'DEMO — scores below are fabricated in your browser to preview the live view. Nothing is saved.';
      el.prepend(w);
    }
  }

  // ── Init ───────────────────────────────────────────────────────────
  async function init() {
    if (!sb) { renderWall('login'); return; }
    let session = null;
    try { session = (await sb.auth.getSession()).data.session; } catch (e) {}
    if (!session) { renderWall('login'); return; }

    const authHeaders = { 'Authorization': `Bearer ${session.access_token}` };
    let gamesRes = null;
    try {
      const r = await fetch(`${API}/games/upcoming?season=${SEASON}`, {
        credentials: 'omit', headers: authHeaders,
      });
      if (r.status === 402) { renderWall('subscribe'); return; }
      if (r.status === 401) { renderWall('login'); return; }
      gamesRes = await r.json();
    } catch (e) {
      app.innerHTML = `<div class="mb-empty">Couldn’t reach the slate. Refresh to retry.</div>`;
      return;
    }

    // Board picks — powers the "· PressBox A+" markers in the side
    // dropdown. Purely informational; the page works without it.
    fetch(`${API}/picks/upcoming?season=${SEASON}`, { credentials: 'omit', headers: authHeaders })
      .then(r => (r.ok ? r.json() : null))
      .then(j => {
        if (j && j.picks) { picksByGame = j.picks; rebuildSideSelect(); }
      })
      .catch(() => {});
    games = (gamesRes && gamesRes.games) || [];
    games.forEach(g => { gamesById[gid(g)] = g; });
    weeks = (gamesRes && Array.isArray(gamesRes.weeks) && gamesRes.weeks.length)
      ? gamesRes.weeks.slice()
      : [...new Set(games.map(g => g.week).filter(w => w != null))].sort((a, b) => a - b);

    // Default week: the first week that still has an unplayed game.
    const now = Date.now();
    const liveWeek = weeks.find(w => weekGames(w).some(g => {
      const k = kickoffDate(g.raw_date);
      return g.status !== 'final' && (!k || k.getTime() > now - 6 * 3600e3);
    }));
    formWeek = liveWeek != null ? liveWeek : (weeks[weeks.length - 1] ?? null);

    // The ledger (RLS scopes to this login).
    try {
      const { data, error } = await sb.from('user_bets').select('*')
        .eq('season', SEASON)
        .order('created_at', { ascending: false });
      if (error) throw error;
      bets = data || [];
    } catch (e) {
      console.warn('user_bets select failed (table not provisioned yet?)', e);
      ledgerReady = false;
      bets = [];
    }

    app.innerHTML = `<div id="mbHeroMount"></div><div id="mbImportMount"></div>${formHTML()}<div id="mbLedgerMount"></div>`;
    wireForm();
    rebuildGameSelect();
    loadImport();
    renderImport();
    if (new URLSearchParams(location.search).get('demo') === 'live') applyDemoLive();
    renderLedgerAndHero();
    startLiveLoop();
    enrichLineMoves();
  }

  init();
})();
