/* ============================================================
 * auth-nav.js — Shared auth-aware nav state
 * ============================================================
 *
 * Drop this on any page that has a nav. It will:
 *
 *   1. Check Supabase session on page load.
 *   2. If signed in:
 *      - Swap any element with class .js-auth-signin (the "Sign in" link)
 *        for a "Sign out" link that calls supabase.signOut() on click.
 *      - Show any element with class .js-auth-when-signed-in.
 *      - Hide any element with class .js-auth-when-signed-out.
 *      - Set text of any .js-auth-email element to the user's email.
 *   3. If signed out:
 *      - Default state (Sign in link visible, signed-in elements hidden).
 *
 * USAGE
 * -----
 * In <head> or before </body>:
 *   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
 *   <script src="/js/auth-nav.js"></script>
 *
 * In your nav:
 *   <a href="/login.html" class="js-auth-signin">Sign in</a>
 *
 * The script will rewrite that link to "Sign out" when signed in.
 *
 * Requires window.supabase (loaded from CDN) and a global anon key.
 * The anon key is intentionally exposed — it's the public key.
 * ============================================================ */
(function () {
  'use strict';

  const SUPABASE_URL  = 'https://brwalcuodwxsynrpiqjc.supabase.co';
  const SUPABASE_ANON = 'REPLACE_ME_WITH_ANON_KEY';

  // Guard: if Supabase SDK didn't load, do nothing (page stays in default
  // anon-display state).
  if (typeof supabase === 'undefined') {
    console.warn('auth-nav: supabase SDK not loaded');
    return;
  }

  const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

  async function applyAuthState() {
    let session = null;
    try {
      const res = await sb.auth.getSession();
      session = res?.data?.session || null;
    } catch (e) {
      console.warn('auth-nav: getSession failed', e);
      return;
    }

    if (session) {
      // SIGNED IN STATE
      const email = session.user?.email || '';

      // Swap Sign In links → Sign Out
      document.querySelectorAll('.js-auth-signin').forEach(el => {
        el.textContent = 'Sign out';
        el.href = '#';
        el.dataset.action = 'signout';
      });

      // Show signed-in-only elements
      document.querySelectorAll('.js-auth-when-signed-in').forEach(el => {
        el.style.display = '';
      });

      // Hide signed-out-only elements
      document.querySelectorAll('.js-auth-when-signed-out').forEach(el => {
        el.style.display = 'none';
      });

      // Fill in email text
      document.querySelectorAll('.js-auth-email').forEach(el => {
        el.textContent = email;
      });
    } else {
      // SIGNED OUT STATE — defaults are correct, but explicitly hide
      // any signed-in-only elements that may have been pre-rendered.
      document.querySelectorAll('.js-auth-when-signed-in').forEach(el => {
        el.style.display = 'none';
      });
    }
  }

  // Sign-out click handler. Delegated to document so it works on
  // re-rendered elements too.
  document.addEventListener('click', async (e) => {
    const target = e.target.closest('[data-action="signout"]');
    if (!target) return;
    e.preventDefault();
    try {
      await sb.auth.signOut();
    } catch (err) {
      console.error('signOut failed:', err);
    }
    // Redirect to home regardless of signOut success
    window.location.href = '/';
  });

  // Initial apply on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyAuthState);
  } else {
    applyAuthState();
  }
})();
