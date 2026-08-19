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
  let formWeek = null;          // week selected in the form
  let heroScope = 'week';       // 'week' | 'season'
  let ledgerReady = true;       // false when the user_bets table isn't provisioned

  // ── Utils ──────────────────────────────────────────────────────────
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

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
    if (heroScope === 'season') return bets;
    return bets.filter(b => b.week === formWeek);
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
          <div class="mb-hero-eyebrow">My Bets · ${esc(scopeLabel)}</div>
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
  function weekGames(w) {
    return games
      .filter(g => g.week === w)
      .sort((a, b) => String(a.start_date || '').localeCompare(String(b.start_date || '')));
  }

  function formHTML() {
    const weekOpts = weeks.map(w =>
      `<option value="${w}" ${w === formWeek ? 'selected' : ''}>Week ${w}</option>`).join('');
    return `
      <div class="mb-section">
        <div class="mb-section-eyebrow">Log a ticket</div>
        <h2 class="mb-section-title">What did you <em>actually</em> bet?</h2>
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
          <div class="mb-form-actions">
            <button type="submit" class="mb-log-btn" id="mbLogBtn">Log bet</button>
            <span class="mb-payout-preview" id="mbPreview"></span>
            <span class="mb-form-msg" id="mbMsg"></span>
          </div>
        </form>
      </div>`;
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
      `<option value="${g.id}">${esc(g.away_team)} @ ${esc(g.home_team)}</option>`).join('');
    onGameChange();
  }

  function rebuildSideSelect() {
    const g = currentGame();
    const market = document.getElementById('mbMarket').value;
    const sel = document.getElementById('mbSide');
    if (!sel || !g) return;
    if (market === 'total') {
      sel.innerHTML = `<option value="over">Over</option><option value="under">Under</option>`;
    } else {
      sel.innerHTML = `<option value="away">${esc(g.away_team)}</option>` +
                      `<option value="home">${esc(g.home_team)}</option>`;
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
    const quotes = await fetchQuotes(g.id);
    const cur = currentGame();
    if (!cur || cur.id !== g.id) return;   // user moved on mid-fetch
    if (!quotes.books.length) {
      bookSel.innerHTML = `<option value="">No live books — enter manually</option>`;
    } else {
      bookSel.innerHTML = quotes.books.map((b, i) =>
        `<option value="${i}">${esc(b.book_display || b.book)}</option>`).join('');
    }
    prefill();
  }

  function prefill() {
    const g = currentGame();
    if (!g) return;
    const market = document.getElementById('mbMarket').value;
    const side = document.getElementById('mbSide').value;
    const bookSel = document.getElementById('mbBook');
    const q = quotesCache[g.id];
    const book = (q && q.books && bookSel.value !== '') ? q.books[Number(bookSel.value)] : null;
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
    const odds = Number(document.getElementById('mbOdds').value);
    const win = winAmount(stake, odds);
    el.innerHTML = (win != null)
      ? `To win <b>${esc(fmtMoney(win))}</b> · returns <b>${esc(fmtMoney(win + stake))}</b>`
      : '';
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

    const g = currentGame();
    const market = document.getElementById('mbMarket').value;
    const side = document.getElementById('mbSide').value;
    const bookSel = document.getElementById('mbBook');
    const q = quotesCache[g && g.id];
    const book = (g && q && q.books && bookSel.value !== '') ? q.books[Number(bookSel.value)] : null;
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
      game_id: g.id,
      game_label: `${g.away_team} @ ${g.home_team}`,
      kickoff: g.start_date || null,
      market,
      side,
      side_label: sideLabelFor(g, market, side, line),
      line,
      odds,
      stake,
      book: book ? (book.book_display || book.book) : null,
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

  // ── Ledger ─────────────────────────────────────────────────────────
  function markFor(b) {
    if (!b.result) return ['pending', '–'];
    if (b.result === 'W') return ['win', '✓'];
    if (b.result === 'L') return ['loss', '✕'];
    return ['push', '–'];
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
    const sub = [b.game_label, fmtKick(b.kickoff), b.book].filter(Boolean).join(' · ');
    return `
      <div class="mb-row" data-id="${esc(b.id)}">
        <div class="mb-row-mark ${cls}">${glyph}</div>
        <div class="mb-row-body">
          <div class="mb-row-pick">${esc(b.side_label)} <span class="mb-odds">${esc(fmtOdds(b.odds))}</span></div>
          <div class="mb-row-sub">${esc(sub)}</div>
        </div>
        <div class="mb-row-money">
          <div class="mb-row-net ${netCls}">${esc(netTxt)}</div>
          <div class="mb-row-stake">${esc(fmtMoney(b.stake))} stake</div>
        </div>
        ${canDelete ? `<button type="button" class="mb-row-del" data-del="${esc(b.id)}" aria-label="Delete ticket">✕</button>` : ''}
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
    const byWeek = {};
    bets.forEach(b => { (byWeek[b.week] = byWeek[b.week] || []).push(b); });
    const weeksDesc = Object.keys(byWeek).map(Number).sort((a, b) => b - a);
    const groups = weeksDesc.map(w => {
      const rows = byWeek[w];
      const settled = rows.filter(b => b.result);
      const net = settled.reduce((a, b) => a + (Number(b.profit) || 0), 0);
      const netTxt = settled.length ? fmtMoney(net, { signed: true }) : '';
      return `
        <div class="mb-week-group">
          <div class="mb-week-head"><span>Week ${w}</span><span>${esc(netTxt)}</span></div>
          ${rows.map(rowHTML).join('')}
        </div>`;
    }).join('');
    return `<div class="mb-section">
      <div class="mb-section-eyebrow">The ledger</div>
      <h2 class="mb-section-title">Every ticket, <em>on the record</em></h2>
      ${groups}
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
  }

  // ── Init ───────────────────────────────────────────────────────────
  async function init() {
    if (!sb) { renderWall('login'); return; }
    let session = null;
    try { session = (await sb.auth.getSession()).data.session; } catch (e) {}
    if (!session) { renderWall('login'); return; }

    let gamesRes = null;
    try {
      const r = await fetch(`${API}/games/upcoming?season=${SEASON}`, {
        credentials: 'omit',
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });
      if (r.status === 402) { renderWall('subscribe'); return; }
      if (r.status === 401) { renderWall('login'); return; }
      gamesRes = await r.json();
    } catch (e) {
      app.innerHTML = `<div class="mb-empty">Couldn’t reach the slate. Refresh to retry.</div>`;
      return;
    }
    games = (gamesRes && gamesRes.games) || [];
    games.forEach(g => { gamesById[g.id] = g; });
    weeks = [...new Set(games.map(g => g.week).filter(w => w != null))].sort((a, b) => a - b);

    // Default week: the first week that still has an unplayed game.
    const now = Date.now();
    const liveWeek = weeks.find(w => weekGames(w).some(g => {
      const k = kickoffDate(g.start_date);
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

    app.innerHTML = `<div id="mbHeroMount"></div>${formHTML()}<div id="mbLedgerMount"></div>`;
    wireForm();
    rebuildGameSelect();
    renderLedgerAndHero();
  }

  init();
})();
