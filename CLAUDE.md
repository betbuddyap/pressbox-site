# PressBox Analytics — Frontend (`pressbox-site`)

College-football betting-intelligence SaaS. This repo is the marketing site + web app
(static HTML/CSS/JS), deployed to **Cloudflare Pages** at **pressboxanalytics.com**.
Founder: **Austin** — sharp product owner, not a career developer. He verifies against
source, catches errors fast, and values seeing changes and proof over claims.

---

## Run / preview / deploy

- **No build step.** It's a static site. Preview locally with
  `python3 -m http.server 8000`, then open http://localhost:8000
  (or just ask me to start a preview server).
- **Deploy = commit + push to `main`.** Cloudflare Pages rebuilds automatically in
  ~1–2 min. For risky visual changes, push a **preview branch** first and check the
  Cloudflare preview URL before merging.
- **Layout:** HTML pages at repo root · design tokens in `/css/tokens.css` · component
  CSS in `/css/components/<name>.css` · JS in `/js/`. The shared nav/footer/auth is
  injected by **`/js/site-chrome.js`** — a single source of truth. Edit that file to
  change the nav/footer everywhere; never re-add per-page nav markup.

## The reference

`live-lines.html` + `/css/components/live-lines.css` are the **canonical look**. Match
every other page to it: card shape (`.ll-row` / `.al-card`), type scale, color, spacing.
When something looks off, diff it against Live Lines.

## Styling rules (non-negotiable)

- **Tokens only.** Every color/type/spacing value comes from `/css/tokens.css`. Never
  hardcode a hex or px that a token covers, and never add a page-level inline `:root`
  (that was the #1 source of drift — it's now removed sitewide). If a value is missing,
  add the token to `tokens.css` first.
- **Number-font rule (Austin has corrected this 50+ times):**
  - Big / display numbers (hero stats, summary values, section totals) →
    `var(--serif)` **Libre Baskerville bold**.
  - Small / inline numbers (per-row stakes, prices, book lines, win %, pick numbers,
    amount inputs) → `var(--sans)` **Source Sans 3**.
  - **Never JetBrains Mono for numbers.** The *only* allowed use anywhere is the paywall
    plan price (`.ll-paywall-plan-price`).
- Reuse the real `.ll-` classes verbatim: `.ll-row`, `.ll-row-matchup`, `.ll-row-pick`,
  `.ll-row-pick-num`, `.ll-badge`, `.ll-accordion`, `.ll-paywall*`, `.ll-skeleton*`.
  Accordion panels are `--cream-dark` (sandy tan). Loading states = the `.ll-skeleton`
  shimmer (1.8s), never plain "Loading…" text.
- Small uppercase labels: letter-spacing **~0.03em** (tight). Never 0.1em+ (reads as a
  different font / letters flung apart).
- Brand: cream `#F8F5EE`, ink `#0F0E0A`, gold `#B8922A`. `--sage` / `--rust` are
  **DATA-VIZ ONLY** (wins/losses, deltas, win-rate) — never on nav, buttons, or general UI.

## Copy / product truth

- The ensemble that drives picks is **4 models: SP+, PPA, Advanced, Pace+**. **Elo is
  display-only** — shown on the game page, excluded from the picks ensemble and totals.
  Marketing copy intentionally says "five models" because the customer *sees* five
  projections side by side — keep that framing, but never write copy implying Elo
  *generates* a pick.
- Reflect the real product lineup in copy: **Live Lines, Upcoming, Parlay, Allocator,
  Rankings, Results.** Parlay / Allocator / Upcoming postdate the original site copy —
  the homepage, How It Works, and About still need them written in.
- **"No Edge" everywhere — never "Lean."** No Edge is a grade, not a bucket.
  Grades come from the net count of agreeing rules in the electorate.
  `pipeline/ladder.py` is the authority — check it before trusting this section.
  - **Spread/Total** — net 1 = **C** (bronze) · 2 = **B** (silver) · 3 = **A** (gold) ·
    4+ = **A+** (ink, gold border) · tie or none = **No Edge**.
  - **Moneyline** — its own electorate (the ML Book), tiered **A/B/C** by net votes,
    emitted only when the price sits inside **−300..+300**.
  - **A+ is live and current.** Do not "correct" it out of the UI or the copy.
  - **Retired 2026-08-10:** Layer 6, the A+-spread→banded-ML expression that produced
    **Smart Money / Goldilocks / Lottery**. Those `.ll-badge--smart_money`,
    `--goldilocks` and `--lottery` classes are legacy CSS — don't build on them.
- **Vegas favorite is always shown negative** (spreads and moneylines).
- **Look-ahead bias is sacred.** Never let future data leak into a historical
  evaluation; any backtest logic must be point-in-time.

## How to work with me

- **Edit files directly** — no need to hand-produce whole files (that rule was a
  workaround for the old mobile-paste workflow; it doesn't apply here).
- **Ship a feature's edits together in one commit.** State cross-file dependencies and
  deploy order when files depend on each other.
- **Prove changes before saying "done":** `node --check` on extracted JS,
  `python3 -c "import ast; ast.parse(open('f').read())"` for Python, and `grep` to
  confirm a change actually landed. Austin will verify against source — beat him to it.
- Be **terse**, infer the next step, and when Austin pushes back, **check the source
  before defending** the work.

## Stack (reference — backend is a separate repo)

- **Frontend:** this repo `betbuddyap/pressbox-site` → Cloudflare Pages → pressboxanalytics.com
- **Backend:** `betbuddyap/betbuddy-backend`, FastAPI on Render, API base
  `https://betbuddy-backend.onrender.com` (`main.py` is ~29k lines). Not in this repo.
- **Database:** Supabase at `brwalcuodwxsynrpiqjc.supabase.co`. The anon *publishable*
  key is public and used client-side — that's fine. **Never** put service-role keys,
  Stripe secrets, or connection strings in the frontend; those live in Render/Railway env.
