// Pulse tracker: Umami-compatible, cookieless, no storage writes. Plain ES2017, no build step.
(() => {
  try {
    const doc = document, loc = location, nav = navigator, hist = history;
    const el = doc.currentScript || doc.querySelector('script[data-website-id]');
    const attr = (n) => (el ? el.getAttribute('data-' + n) : null);
    const flag = (n) => { const v = attr(n); return v !== null && v !== 'false'; };

    const website = attr('website-id');
    const host = (attr('host-url') || (el && el.src || '').replace(/[?#].*$/, '').replace(/\/[^/]*$/, '')).replace(/\/+$/, '');
    const endpoint = host + '/api/send';
    const domains = (attr('domains') || '').split(',').map((d) => d.trim()).filter(Boolean);
    const noSearch = flag('exclude-search'), noHash = flag('exclude-hash'), dnt = flag('do-not-track');
    const tag = attr('tag'), beforeSend = attr('before-send');

    const url = () => loc.pathname + (noSearch ? '' : loc.search) + (noHash ? '' : loc.hash);
    let last = url();
    let ref = doc.referrer;

    const off = () => {
      try { if (localStorage.getItem('umami.disabled')) return true; } catch (e) { /* storage blocked: not opted out */ }
      if (domains.length && domains.indexOf(loc.hostname) < 0) return true;
      return dnt && [nav.doNotTrack, window.doNotTrack, nav.msDoNotTrack].some((v) => v === '1' || v === 'yes');
    };

    const payload = () => ({
      website,
      hostname: loc.hostname,
      url: url(),
      referrer: ref,
      title: doc.title,
      screen: screen.width + 'x' + screen.height,
      language: nav.language,
      tag: tag || undefined,
    });

    const send = (p) => {
      try {
        if (!website || off()) return;
        const hook = beforeSend && window[beforeSend];
        if (typeof hook === 'function' && !(p = hook('event', p))) return;
        fetch(endpoint, {
          method: 'POST',
          body: JSON.stringify({ type: 'event', payload: p }),
          keepalive: true,
          credentials: 'omit',
          headers: { 'Content-Type': 'application/json' },
        }).catch(() => {});
      } catch (e) { /* never throw into the page */ }
    };

    const track = (a, b) => {
      try {
        const p = payload();
        if (a === undefined) send(p);
        else if (typeof a === 'string') send(Object.assign(p, { name: a, data: b }));
        else if (typeof a === 'function') { const r = a(p); if (r && typeof r === 'object') send(r); }
        else if (a && typeof a === 'object') send(Object.assign(p, a));
      } catch (e) { /* never throw into the page */ }
    };

    const navigated = () => {
      try {
        const u = url();
        if (u === last) return;
        ref = loc.origin + last;
        last = u;
        track();
      } catch (e) { /* never throw into the page */ }
    };

    const start = () => {
      last = url();
      track();
      ['pushState', 'replaceState'].forEach((m) => {
        const orig = hist[m];
        hist[m] = function () { const r = orig.apply(this, arguments); navigated(); return r; };
      });
      window.addEventListener('popstate', navigated);
    };

    window.umami = window.pulse = { track, identify: () => {} };
    if (website && attr('auto-track') !== 'false' && !off()) {
      if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start);
      else start();
    }
  } catch (e) { /* never throw into the page */ }
})();
