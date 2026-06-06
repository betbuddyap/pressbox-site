/* ============================================================
 * auth-nav.js — Shared auth-aware nav state
 * ============================================================
 *
 * Drop this on any page that has a nav. On page load it checks the
 * Supabase session and updates the nav for signed-in vs signed-out.
 *
 * SIGNED IN  → nav link becomes "Account" → /account.html
 *              (sign-out lives on the /account page)
 * SIGNED OUT → nav link is "Sign in" → /login.html
 *
 * It supports TWO ways of marking the nav link, so it works with every
 * page on the site:
 *
 *   1. By id   — id="navAuth" (desktop), id="navAuthMobile" (mobile),
 *                or id="nav-signin" (subscribe page).
 *   2. By class — class="js-auth-signin" (legacy convention), plus the
 *                helper classes below.
 *
 * Optional helper classes (still supported):
 *   .js-auth-when-signed-in   → shown only when signed in
 *   .js-auth-when-signed-out  → shown only when signed out
 *   .js-auth-email            → filled with the user's email
 *
 * USAGE
 * -----
 *   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
 *   <script src="/js/auth-nav.js" defer></script>
 *
 * The anon key is intentionally exposed — it's the public publishable key.
 * ============================================================ */
(function () {
  'use strict';

  const SUPABASE_URL  = 'https://brwalcuodwxsynrpiqjc.supabase.co';
  const SUPABASE_ANON = 'sb_publishable_yUSCp6-m1gda0eMcGWuinw_LMLGP_uE';

  // Guard: if Supabase SDK didn't load, do nothing (page stays in its
  // default signed-out display state).
  if (typeof supabase === 'undefined') {
    console.warn('auth-nav: supabase SDK not loaded');
    return;
  }

  const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

  // Nav links identified by id, used across the site's page navs.
  const NAV_IDS = ['navAuth', 'navAuthMobile', 'nav-signin'];

  function setLink(el, signedIn) {
    if (!el) return;
    el.textContent = signedIn ? 'Account' : 'Sign in';
    el.setAttribute('href', signedIn ? '/account.html' : '/login.html');
    el.style.opacity = '';          // clear any dimmed "Sign in" styling
    if (el.dataset) delete el.dataset.action;  // no longer a sign-out link
  }

  async function applyAuthState() {
    let session = null;
    try {
      const res = await sb.auth.getSession();
      session = res?.data?.session || null;
    } catch (e) {
      console.warn('auth-nav: getSession failed', e);
      return;
    }

    const signedIn = !!session;

    // (1) id-based nav links
    NAV_IDS.forEach(id => setLink(document.getElementById(id), signedIn));

    // (2) class-based links (legacy convention) — same Account behavior
    document.querySelectorAll('.js-auth-signin').forEach(el => setLink(el, signedIn));

    if (signedIn) {
      const email = session.user?.email || '';
      document.querySelectorAll('.js-auth-when-signed-in').forEach(el => { el.style.display = ''; });
      document.querySelectorAll('.js-auth-when-signed-out').forEach(el => { el.style.display = 'none'; });
      document.querySelectorAll('.js-auth-email').forEach(el => { el.textContent = email; });
    } else {
      document.querySelectorAll('.js-auth-when-signed-in').forEach(el => { el.style.display = 'none'; });
      document.querySelectorAll('.js-auth-when-signed-out').forEach(el => { el.style.display = ''; });
    }
  }

  // Legacy sign-out handler: still honored for any element that opts in
  // with data-action="signout" (the nav no longer uses this, but keeping
  // it means nothing that relied on it breaks).
  document.addEventListener('click', async (e) => {
    const target = e.target.closest('[data-action="signout"]');
    if (!target) return;
    e.preventDefault();
    try {
      await sb.auth.signOut();
    } catch (err) {
      console.error('signOut failed:', err);
    }
    window.location.href = '/';
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyAuthState);
  } else {
    applyAuthState();
  }
})();
