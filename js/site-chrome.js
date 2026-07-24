/* ============================================================
 * site-chrome.js — PressBox shared nav + footer (single source)
 * ============================================================
 * SELF-INSTALLING. Drop it on any page with one line before </body>:
 *
 *   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
 *   <script src="/js/site-chrome.js" defer></script>
 *
 * On load it:
 *   1. Injects the canonical chrome stylesheet (Live Lines nav look).
 *   2. Replaces any existing <nav>, mobile menu, and <footer> with the
 *      canonical markup — or injects them if the page has none. The page's
 *      own ticker (marketing pages) is left untouched.
 *   3. Marks the current page's nav link active.
 *   4. Checks the Supabase session and renders the auth cluster:
 *        SIGNED OUT → "Sign up" (filled) + "Login"
 *        SIGNED IN  → "Account" → /account.html
 *
 * Edit THIS file to change the nav, footer, or disclaimer everywhere.
 * The anon key below is the public publishable key — safe client-side.
 * ============================================================ */
(function () {
  'use strict';

  var SUPABASE_URL  = 'https://brwalcuodwxsynrpiqjc.supabase.co';
  var SUPABASE_ANON = 'sb_publishable_yUSCp6-m1gda0eMcGWuinw_LMLGP_uE';

  // ── Canonical link sets ──────────────────────────────────────
  // Tools live in the top nav; informational pages live in the footer.
  var NAV_LINKS = [
    { href: '/live-lines.html', label: 'Live Lines', live: true },
    { href: '/upcoming.html',   label: 'Upcoming' },
    { href: '/parlay.html',     label: 'Parlay' },
    { href: '/allocator.html',  label: 'Allocator' },
    { href: '/rankings.html',   label: 'Rankings' },
    { href: '/results.html',    label: 'Results' }
  ];

  var FOOTER_LINKS = [
    { href: '/how-it-works.html', label: 'How It Works' },
    { href: '/about.html',        label: 'About' }
  ];
  // Placeholder items (no page yet) render as dimmed, non-link spans.
  var FOOTER_PLACEHOLDERS = ['Privacy', 'Terms', 'Contact'];

  var DISCLAIMER =
    'PressBox is for entertainment and educational purposes only. ' +
    'Past performance does not guarantee future results. Please bet responsibly.';

  var LOGO_CREAM = '/pressbox-w2a-cream-cropped.png';
  var LOGO_INK   = '/pressbox-w2a-ink-cropped.png';

  // ── Path helpers (active state) ──────────────────────────────
  function normPath(p) {
    if (!p) return '/';
    p = p.split('?')[0].split('#')[0];
    if (p.length > 1 && p.charAt(p.length - 1) === '/') p = p.slice(0, -1);
    return p || '/';
  }
  var here = normPath(location.pathname);
  function isActive(href) { return normPath(href) === here; }

  // ── Canonical stylesheet (Live Lines nav + footer) ───────────
  // Injected last so it wins over any per-page nav CSS still on the page.
  // rust fallbacks let the live dot render even on pages that don't yet
  // link tokens.css (marketing pages inline a :root without --rust).
  var CSS =
  '\n:root { --max: 1200px; }' +
  '\nnav.pb-nav { background: var(--cream); border-bottom: 1px solid var(--border); position: sticky; top: 0; z-index: 100; }' +
  '\nnav.pb-nav .nav-inner { max-width: var(--max); margin: 0 auto; padding: 0 32px; display: flex; align-items: center; justify-content: space-between; height: 80px; }' +
  '\nnav.pb-nav .nav-logo img { height: 68px; width: auto; display: block; }' +
  '\nnav.pb-nav .nav-links { display: flex; align-items: center; gap: 28px; list-style: none; margin: 0; padding: 0; }' +
  '\nnav.pb-nav .nav-links a { font-family: var(--sans); font-size: 13px; font-weight: 500; color: var(--text-mid); text-decoration: none; transition: color 0.2s; }' +
  '\nnav.pb-nav .nav-links a:hover, nav.pb-nav .nav-links a.active { color: var(--ink); }' +
  '\nnav.pb-nav .btn-nav { background: var(--ink) !important; color: var(--cream) !important; padding: 8px 18px; border-radius: 4px; font-size: 12px !important; font-weight: 600 !important; letter-spacing: 0.5px; }' +
  '\nnav.pb-nav .btn-nav:hover { color: var(--cream) !important; opacity: 0.9; }' +
  '\nnav.pb-nav .nav-links a.nav-live { color: var(--rust, #B85A2A) !important; font-weight: 700; letter-spacing: 0.3px; position: relative; text-transform: uppercase; font-size: 11px; }' +
  '\nnav.pb-nav .nav-links a.nav-live::before { content: \'\'; display: inline-block; width: 6px; height: 6px; background: var(--rust, #B85A2A); border-radius: 50%; margin-right: 7px; vertical-align: 2px; animation: pulse-live 2.4s ease-in-out infinite; }' +
  '\nnav.pb-nav .nav-links a.nav-live:hover { color: var(--rust-light, #D17A4A) !important; }' +
  '\nnav.pb-nav .nav-links a.nav-live.active { color: var(--ink) !important; }' +
  '\nnav.pb-nav .nav-links a.nav-live.active::before { background: var(--ink); animation: none; }' +
  '\n@keyframes pulse-live { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.5; transform: scale(0.85); } }' +
  '\n.pb-mobile-menu a.nav-live-mobile { color: var(--rust, #B85A2A) !important; }' +
  '\nnav.pb-nav .hamburger { display: none; flex-direction: column !important; align-items: center; justify-content: center; gap: 5px; cursor: pointer; padding: 4px; background: transparent; border: 0; outline: 0; -webkit-appearance: none; appearance: none; border-radius: 0; box-shadow: none; width: 32px; height: 32px; }' +
  '\nnav.pb-nav .hamburger span { display: block; width: 22px; height: 2px; background: var(--ink); border-radius: 2px; }' +
  '\n.pb-mobile-menu { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: var(--cream); z-index: 300; flex-direction: column; align-items: center; justify-content: center; gap: 36px; }' +
  '\n.pb-mobile-menu.open { display: flex !important; }' +
  '\n.pb-mobile-menu a { font-family: var(--serif); font-size: 28px; font-weight: 700; color: var(--ink); text-decoration: none; }' +
  '\n.pb-mobile-menu .btn-mobile { background: var(--ink); color: var(--cream) !important; padding: 14px 32px; border-radius: 4px; font-family: var(--sans) !important; font-size: 14px !important; font-weight: 600; }' +
  '\n.pb-mobile-menu .close-btn { position: absolute; top: 28px; right: 28px; font-size: 28px; cursor: pointer; background: none; border: none; color: var(--ink); line-height: 1; }' +
  '\n@media (min-width: 961px) { nav.pb-nav .hamburger { display: none !important; } }' +
  '\n@media (max-width: 960px) { nav.pb-nav .nav-links { display: none; } nav.pb-nav .hamburger { display: flex; } }' +
  // Footer
  '\nfooter.pb-footer { margin-top: 64px; padding: 48px 0; border-top: 1px solid var(--border); background: var(--cream); }' +
  '\nfooter.pb-footer .footer-inner { max-width: var(--max); margin: 0 auto; padding: 0 32px; display: flex; flex-direction: column; align-items: center; gap: 24px; text-align: center; }' +
  '\nfooter.pb-footer .footer-logo img { height: 56px; width: auto; display: block; opacity: 0.85; }' +
  '\nfooter.pb-footer .footer-meta-links { display: flex; gap: 28px; flex-wrap: wrap; justify-content: center; }' +
  '\nfooter.pb-footer .footer-meta-links a { font-family: var(--sans); font-size: 12px; font-weight: 500; color: var(--text-mid); text-decoration: none; transition: color 0.2s; }' +
  '\nfooter.pb-footer .footer-meta-links a:hover { color: var(--ink); }' +
  '\nfooter.pb-footer .footer-meta-links span { font-family: var(--sans); font-size: 12px; font-weight: 500; color: var(--text-light); }' +
  '\nfooter.pb-footer .footer-note { font-family: var(--sans); font-size: 11px; color: var(--text-light); max-width: 600px; line-height: 1.6; text-align: center; }';

  function injectCSS() {
    if (document.getElementById('pb-chrome-styles')) return;
    var s = document.createElement('style');
    s.id = 'pb-chrome-styles';
    s.textContent = CSS;
    document.head.appendChild(s); // last = wins over per-page nav CSS
  }

  // ── Markup builders ──────────────────────────────────────────
  function authLinksDesktop(signedIn) {
    if (signedIn) return '<li class="pb-auth"><a href="/account.html"' + (isActive('/account.html') ? ' class="active"' : '') + '>Account</a></li>';
    return '<li class="pb-auth"><a href="/subscribe.html" class="btn-nav">Sign up</a></li>' +
           '<li class="pb-auth"><a href="/login.html"' + (isActive('/login.html') ? ' class="active"' : '') + '>Login</a></li>';
  }
  function authLinksMobile(signedIn) {
    if (signedIn) return '<a href="/account.html">Account</a>';
    return '<a href="/subscribe.html" class="btn-mobile">Sign up</a>' +
           '<a href="/login.html">Login</a>';
  }

  function navHTML(signedIn) {
    var items = NAV_LINKS.map(function (l) {
      var cls = [];
      if (l.live) cls.push('nav-live');
      if (isActive(l.href)) cls.push('active');
      var c = cls.length ? ' class="' + cls.join(' ') + '"' : '';
      return '<li><a href="' + l.href + '"' + c + '>' + l.label + '</a></li>';
    }).join('');
    return '<div class="nav-inner">' +
      '<a href="/" class="nav-logo"><img src="' + LOGO_CREAM + '" alt="PressBox Analytics"></a>' +
      '<ul class="nav-links">' + items + authLinksDesktop(signedIn) + '</ul>' +
      '<button class="hamburger" type="button" aria-label="Menu"><span></span><span></span><span></span></button>' +
      '</div>';
  }

  function mobileHTML(signedIn) {
    var items = NAV_LINKS.map(function (l) {
      var c = l.live ? ' class="nav-live-mobile"' : '';
      return '<a href="' + l.href + '"' + c + '>' + l.label + '</a>';
    }).join('');
    return '<button class="close-btn" type="button" aria-label="Close menu">\u2715</button>' +
      items + authLinksMobile(signedIn);
  }

  function footerHTML() {
    var links = FOOTER_LINKS.map(function (l) {
      return '<a href="' + l.href + '">' + l.label + '</a>';
    }).join('');
    var spans = FOOTER_PLACEHOLDERS.map(function (t) {
      return '<span>' + t + '</span>';
    }).join('');
    return '<div class="footer-inner">' +
      '<div class="footer-logo"><img src="' + LOGO_INK + '" alt="PressBox Analytics"></div>' +
      '<div class="footer-meta-links">' + links + spans + '</div>' +
      '<div class="footer-note">' + DISCLAIMER + '</div>' +
      '</div>';
  }

  // ── Self-install (replace-in-place, or inject if absent) ─────
  var navEl, mobileEl;

  function install(signedIn) {
    injectCSS();

    // NAV
    navEl = document.createElement('nav');
    navEl.className = 'pb-nav';
    navEl.innerHTML = navHTML(signedIn);
    var oldNav = document.querySelector('nav');
    if (oldNav) oldNav.replaceWith(navEl);
    else document.body.insertBefore(navEl, document.body.firstChild);

    // MOBILE MENU
    mobileEl = document.createElement('div');
    mobileEl.className = 'pb-mobile-menu';
    mobileEl.id = 'pbMobileMenu';
    mobileEl.innerHTML = mobileHTML(signedIn);
    var oldMobile = document.getElementById('mobileMenu') || document.querySelector('.mobile-menu');
    if (oldMobile) oldMobile.replaceWith(mobileEl);
    else document.body.appendChild(mobileEl);

    // FOOTER
    var footEl = document.createElement('footer');
    footEl.className = 'pb-footer';
    footEl.innerHTML = footerHTML();
    var oldFoot = document.querySelector('footer');
    if (oldFoot) oldFoot.replaceWith(footEl);
    else document.body.appendChild(footEl);

    wire();
  }

  function wire() {
    var burger = navEl && navEl.querySelector('.hamburger');
    if (burger) burger.addEventListener('click', function () { mobileEl.classList.toggle('open'); });
    var close = mobileEl && mobileEl.querySelector('.close-btn');
    if (close) close.addEventListener('click', function () { mobileEl.classList.remove('open'); });
    if (mobileEl) {
      mobileEl.querySelectorAll('a').forEach(function (a) {
        a.addEventListener('click', function () { mobileEl.classList.remove('open'); });
      });
    }
  }

  // Re-render only the auth clusters when the session resolves/changes.
  function refreshAuth(signedIn) {
    if (navEl) {
      navEl.querySelectorAll('.pb-auth').forEach(function (el) { el.remove(); });
      var ul = navEl.querySelector('.nav-links');
      if (ul) ul.insertAdjacentHTML('beforeend', authLinksDesktop(signedIn));
    }
    if (mobileEl) {
      // rebuild mobile menu contents (keeps close btn + nav links, swaps auth)
      mobileEl.innerHTML = mobileHTML(signedIn);
      wire();
    }
  }

  // ── Boot ─────────────────────────────────────────────────────
  function boot() {
    // Install immediately in signed-out state so chrome never flashes empty.
    install(false);

    if (typeof supabase === 'undefined') {
      console.warn('site-chrome: supabase SDK not loaded — staying signed-out');
      return;
    }
    var sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
    sb.auth.getSession()
      .then(function (res) {
        var signedIn = !!(res && res.data && res.data.session);
        if (signedIn) refreshAuth(true);
      })
      .catch(function (e) { console.warn('site-chrome: getSession failed', e); });

    // Keep chrome in sync if the user signs in/out in another tab.
    sb.auth.onAuthStateChange(function (_evt, session) { refreshAuth(!!session); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
