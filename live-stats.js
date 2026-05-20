/* ──────────────────────────────────────────────────────────────────────
   PressBox Analytics — live stats loader
   ────────────────────────────────────────────────────────────────────
   Fetches /stats/headline on page load and populates every element
   with a data-stat attribute. Each attribute is a dotted path into
   the JSON response, e.g.:

     <span data-stat="lock.record">24-4</span>
     <span data-stat="potw.pct">74.1</span>
     <span data-stat="lock.roi_pct">36.3</span>

   The element's text content is hydrated to the matching value. If
   the fetch fails or the path doesn't resolve, the element keeps its
   server-rendered text (which should be the latest known good value).
   This means we never show blank dashes or "N/A" to visitors — the
   HTML always carries a fallback.

   Supported value modifiers via data-stat-format:
     "pct"      — appends "%" (74.1 → "74.1%")
     "signed"   — prepends + for positives (36.3 → "+36.3", -8 → "-8")
     "signed-pct" — both ("+36.3%")
     "currency" — prepends $, adds thousands separators (9600 → "$9,600")
     "comma"    — adds thousands separators (101157 → "101,157")
     (none)     — raw value as-is

   Example:
     <span data-stat="lock.pct" data-stat-format="pct">85.7%</span>
     <span data-stat="lock.roi_pct" data-stat-format="signed-pct">+36.3%</span>

   Convention: every page that uses live stats should include this
   script at end-of-body, after all the data-stat elements exist.
   ────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  // Set this once when we move to production; for local dev / preview we
  // fall back to the Railway URL.
  const STATS_ENDPOINT =
    window.PRESSBOX_API_BASE
      ? window.PRESSBOX_API_BASE + '/stats/headline'
      : 'https://betbuddyservice-production.up.railway.app/stats/headline';

  function resolvePath(obj, path) {
    // "lock.record" → obj.lock.record
    return path.split('.').reduce(function (acc, key) {
      if (acc === null || acc === undefined) return undefined;
      return acc[key];
    }, obj);
  }

  function formatValue(raw, fmt) {
    if (raw === null || raw === undefined) return null;
    if (fmt === 'pct') {
      return (typeof raw === 'number' ? raw : parseFloat(raw)) + '%';
    }
    if (fmt === 'signed') {
      const n = typeof raw === 'number' ? raw : parseFloat(raw);
      return (n >= 0 ? '+' : '') + n;
    }
    if (fmt === 'signed-pct') {
      const n = typeof raw === 'number' ? raw : parseFloat(raw);
      return (n >= 0 ? '+' : '') + n + '%';
    }
    if (fmt === 'currency') {
      const n = typeof raw === 'number' ? raw : parseFloat(raw);
      return '$' + Math.round(n).toLocaleString('en-US');
    }
    if (fmt === 'comma') {
      const n = typeof raw === 'number' ? raw : parseFloat(raw);
      return n.toLocaleString('en-US');
    }
    return String(raw);
  }

  function populate(stats) {
    const els = document.querySelectorAll('[data-stat]');
    els.forEach(function (el) {
      const path = el.getAttribute('data-stat');
      const fmt = el.getAttribute('data-stat-format') || '';
      const raw = resolvePath(stats, path);
      if (raw === undefined || raw === null) {
        // Leave the fallback text in place.
        return;
      }
      const formatted = formatValue(raw, fmt);
      if (formatted !== null) {
        el.textContent = formatted;
      }
    });

    // Surface "as_of" timestamp if any element opts in:
    //   <span data-stat-asof>updated …</span>
    const asof = document.querySelectorAll('[data-stat-asof]');
    if (stats.as_of && asof.length) {
      const d = new Date(stats.as_of);
      const opts = { month: 'short', day: 'numeric', year: 'numeric' };
      const formatted = 'Updated ' + d.toLocaleDateString('en-US', opts);
      asof.forEach(function (el) { el.textContent = formatted; });
    }
  }

  function load() {
    fetch(STATS_ENDPOINT, { credentials: 'omit' })
      .then(function (r) {
        if (!r.ok) throw new Error('stats endpoint returned ' + r.status);
        return r.json();
      })
      .then(function (stats) {
        if (stats && stats.error) {
          console.warn('stats/headline returned error, keeping fallback:', stats.error);
          return;
        }
        populate(stats);
      })
      .catch(function (err) {
        // Silent fail — fallback HTML stays in place. We don't surface
        // network errors to visitors; the verified hardcoded numbers
        // are still correct as of the last update.
        console.warn('live-stats fetch failed, using fallback:', err.message);
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', load);
  } else {
    load();
  }
})();
