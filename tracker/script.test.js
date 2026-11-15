import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(new URL('./script.js', import.meta.url), 'utf8');

/**
 * Runs the tracker in a fresh jsdom window (full isolation: history, storage, listeners).
 * `attrs` become attributes of the <script> tag, `setup(window)` runs before the script.
 */
function load({ url = 'https://klettr.com/routes/12?x=1#top', attrs = {}, src = 'https://stacha.tech/a/script.js', setup, withWebsite = true, readyState } = {}) {
  const dom = new JSDOM('<!doctype html><title>Routes</title><body></body>', { url, referrer: 'https://www.google.com/', runScripts: 'outside-only' });
  const { window } = dom;
  const fetch = vi.fn(() => Promise.resolve({ ok: true }));
  window.fetch = fetch;
  Object.defineProperty(window.screen, 'width', { value: 1440 });
  Object.defineProperty(window.screen, 'height', { value: 900 });
  const el = window.document.createElement('script');
  el.src = src;
  if (withWebsite) el.setAttribute('data-website-id', 'site-1');
  for (const [k, v] of Object.entries(attrs)) el.setAttribute('data-' + k, v);
  window.document.head.append(el);
  if (readyState) Object.defineProperty(window.document, 'readyState', { value: readyState, configurable: true });
  setup?.(window);
  Object.defineProperty(window.document, 'currentScript', { value: el, configurable: true });
  window.eval(source);
  const sent = () => fetch.mock.calls.map(([, init]) => JSON.parse(init.body));
  return { window, fetch, sent, last: () => sent().at(-1) };
}

describe('setup', () => {
  it('sends one pageview on load with the Umami payload shape', () => {
    const t = load();
    expect(t.fetch).toHaveBeenCalledTimes(1);
    const [endpoint, init] = t.fetch.mock.calls[0];
    expect(endpoint).toBe('https://stacha.tech/a/api/send');
    expect(init).toMatchObject({ method: 'POST', keepalive: true, credentials: 'omit', headers: { 'Content-Type': 'application/json' } });
    expect(t.last()).toEqual({
      type: 'event',
      payload: {
        website: 'site-1', hostname: 'klettr.com', url: '/routes/12?x=1#top', referrer: 'https://www.google.com/',
        title: 'Routes', screen: '1440x900', language: 'en-US',
      },
    });
  });

  it('does nothing without data-website-id (but the API object exists and is harmless)', () => {
    const t = load({ withWebsite: false });
    t.window.umami.track('x');
    expect(t.fetch).not.toHaveBeenCalled();
  });

  it('data-host-url overrides the endpoint (trailing slash tolerated)', () => {
    const t = load({ attrs: { 'host-url': 'https://stats.example.org/' } });
    expect(t.fetch.mock.calls[0][0]).toBe('https://stats.example.org/api/send');
  });

  it('default endpoint is the script URL directory, ignoring query and hash', () => {
    const t = load({ src: 'https://stacha.tech/a/script.js?v=3#x' });
    expect(t.fetch.mock.calls[0][0]).toBe('https://stacha.tech/a/api/send');
  });

  it('waits for DOMContentLoaded while the document is still loading', () => {
    const t = load({ readyState: 'loading' });
    expect(t.fetch).not.toHaveBeenCalled();
    t.window.document.dispatchEvent(new t.window.Event('DOMContentLoaded'));
    expect(t.fetch).toHaveBeenCalledTimes(1);
  });

  it('exposes window.umami and window.pulse as the same object', () => {
    const t = load();
    expect(t.window.pulse).toBe(t.window.umami);
    expect(typeof t.window.pulse.track).toBe('function');
  });
});

describe('auto-track', () => {
  it('data-auto-track="false" sends nothing on load, manual track still works', () => {
    const t = load({ attrs: { 'auto-track': 'false' } });
    expect(t.fetch).not.toHaveBeenCalled();
    t.window.history.pushState({}, '', '/other');
    expect(t.fetch).not.toHaveBeenCalled();
    t.window.umami.track();
    expect(t.fetch).toHaveBeenCalledTimes(1);
  });

  it('pushState to a new URL sends a pageview whose referrer is the previous URL', () => {
    const t = load();
    t.window.history.pushState({}, '', '/routes/37');
    expect(t.fetch).toHaveBeenCalledTimes(2);
    expect(t.last().payload).toMatchObject({ url: '/routes/37', referrer: 'https://klettr.com/routes/12?x=1#top' });
    t.window.history.pushState({}, '', '/gear');
    expect(t.last().payload).toMatchObject({ url: '/gear', referrer: 'https://klettr.com/routes/37' });
  });

  it('replaceState and popstate are tracked too; an unchanged URL is not', async () => {
    const t = load();
    t.window.history.replaceState({}, '', '/routes/12?x=1#top'); // same URL
    expect(t.fetch).toHaveBeenCalledTimes(1);
    t.window.history.replaceState({}, '', '/replaced');
    expect(t.fetch).toHaveBeenCalledTimes(2);
    t.window.history.pushState({}, '', '/next');
    t.window.history.back();
    await new Promise((r) => setTimeout(r, 50)); // jsdom fires popstate asynchronously
    expect(t.sent().map((s) => s.payload.url)).toEqual(['/routes/12?x=1#top', '/replaced', '/next', '/replaced']);
  });

  it('the original pushState still runs and returns', () => {
    const t = load();
    t.window.history.pushState({ a: 1 }, '', '/z');
    expect(t.window.location.pathname).toBe('/z');
    expect(t.window.history.state).toEqual({ a: 1 });
  });

  it('data-exclude-search / data-exclude-hash drop them from url and from change detection', () => {
    const t = load({ attrs: { 'exclude-search': 'true', 'exclude-hash': 'true' } });
    expect(t.last().payload.url).toBe('/routes/12');
    t.window.history.pushState({}, '', '/routes/12?y=2#other');
    expect(t.fetch).toHaveBeenCalledTimes(1);
    t.window.history.pushState({}, '', '/routes/13?y=2#other');
    expect(t.last().payload).toMatchObject({ url: '/routes/13', referrer: 'https://klettr.com/routes/12' });
  });

  it('without the exclude flags search and hash are sent (server drops them)', () => {
    const t = load();
    t.window.history.pushState({}, '', '/routes/12?x=2');
    expect(t.last().payload.url).toBe('/routes/12?x=2');
  });

  it('a bare data-exclude-search attribute counts as set', () => {
    const t = load({ attrs: { 'exclude-search': '' } });
    expect(t.last().payload.url).toBe('/routes/12#top');
  });
});

describe('opt-out and filters', () => {
  it('localStorage umami.disabled stops everything, and the script only reads storage', () => {
    const setItem = vi.fn();
    const t = load({
      setup: (w) => {
        w.localStorage.setItem('umami.disabled', '1');
        w.Storage.prototype.setItem = setItem;
      },
    });
    t.window.umami.track('x');
    t.window.history.pushState({}, '', '/p');
    expect(t.fetch).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
  });

  it('opting out later takes effect for the next send', () => {
    const t = load();
    t.window.localStorage.setItem('umami.disabled', 'true');
    t.window.umami.track('x');
    expect(t.fetch).toHaveBeenCalledTimes(1); // only the initial pageview
  });

  it('never writes storage or cookies when tracking', () => {
    const setItem = vi.fn();
    const t = load({ setup: (w) => { w.Storage.prototype.setItem = setItem; } });
    t.window.umami.track('x', { a: 1 });
    expect(setItem).not.toHaveBeenCalled();
    expect(t.window.document.cookie).toBe('');
  });

  it('blocked localStorage (throws) is treated as not opted out', () => {
    const t = load({ setup: (w) => { Object.defineProperty(w, 'localStorage', { get() { throw new Error('denied'); } }); } });
    expect(t.fetch).toHaveBeenCalledTimes(1);
  });

  it('honours Do Not Track only with data-do-not-track', () => {
    const dntOn = (w) => Object.defineProperty(w.navigator, 'doNotTrack', { value: '1', configurable: true });
    expect(load({ setup: dntOn }).fetch).toHaveBeenCalledTimes(1);
    expect(load({ setup: dntOn, attrs: { 'do-not-track': 'true' } }).fetch).not.toHaveBeenCalled();
    const dntOff = (w) => Object.defineProperty(w.navigator, 'doNotTrack', { value: '0', configurable: true });
    expect(load({ setup: dntOff, attrs: { 'do-not-track': 'true' } }).fetch).toHaveBeenCalledTimes(1);
  });

  it('data-domains: tracks on a listed host, does nothing elsewhere', () => {
    expect(load({ attrs: { domains: 'example.com, klettr.com' } }).fetch).toHaveBeenCalledTimes(1);
    const other = load({ attrs: { domains: 'example.com' } });
    other.window.umami.track('x');
    other.window.history.pushState({}, '', '/p');
    expect(other.fetch).not.toHaveBeenCalled();
  });

  it('data-tag is added to the payload', () => {
    expect(load({ attrs: { tag: 'beta' } }).last().payload.tag).toBe('beta');
    expect(load().last().payload).not.toHaveProperty('tag');
  });
});

describe('data-before-send', () => {
  it('receives (type, payload) and can replace the payload', () => {
    const hook = vi.fn((type, p) => ({ ...p, url: '/redacted' }));
    const t = load({ attrs: { 'before-send': 'hook' }, setup: (w) => { w.hook = hook; } });
    expect(hook).toHaveBeenCalledWith('event', expect.objectContaining({ website: 'site-1', hostname: 'klettr.com' }));
    expect(t.last().payload.url).toBe('/redacted');
  });

  it('a falsy return cancels the send', () => {
    const t = load({ attrs: { 'before-send': 'hook' }, setup: (w) => { w.hook = () => null; } });
    t.window.umami.track('x');
    expect(t.fetch).not.toHaveBeenCalled();
  });

  it('a throwing hook cancels instead of sending unfiltered data', () => {
    const t = load({ attrs: { 'before-send': 'hook' }, setup: (w) => { w.hook = () => { throw new Error('boom'); }; } });
    expect(t.fetch).not.toHaveBeenCalled();
  });

  it('a missing function name is ignored', () => {
    expect(load({ attrs: { 'before-send': 'nope' } }).fetch).toHaveBeenCalledTimes(1);
  });
});

describe('track overloads', () => {
  it('track() sends a pageview', () => {
    const t = load({ attrs: { 'auto-track': 'false' } });
    t.window.umami.track();
    expect(t.last().payload).toMatchObject({ website: 'site-1', url: '/routes/12?x=1#top' });
    expect(t.last().payload).not.toHaveProperty('name');
  });

  it('track(name) and track(name, data) send a custom event', () => {
    const t = load({ attrs: { 'auto-track': 'false' } });
    t.window.umami.track('cv_download');
    expect(t.last().payload).toMatchObject({ name: 'cv_download', url: '/routes/12?x=1#top' });
    t.window.umami.track('lang', { language: 'en' });
    expect(t.last().payload).toMatchObject({ name: 'lang', data: { language: 'en' } });
  });

  it('track(object) merges raw payload fields over the defaults', () => {
    const t = load({ attrs: { 'auto-track': 'false' } });
    t.window.umami.track({ url: '/virtual', title: 'Virtual' });
    expect(t.last().payload).toMatchObject({ website: 'site-1', url: '/virtual', title: 'Virtual', hostname: 'klettr.com' });
  });

  it('track(fn) receives the default payload and sends what it returns', () => {
    const t = load({ attrs: { 'auto-track': 'false' } });
    t.window.umami.track((p) => ({ ...p, name: 'from_fn' }));
    expect(t.last().payload).toMatchObject({ website: 'site-1', name: 'from_fn' });
    t.window.umami.track(() => null); // nothing to send
    expect(t.fetch).toHaveBeenCalledTimes(1);
  });

  it('the identify stub exists and sends nothing', () => {
    const t = load({ attrs: { 'auto-track': 'false' } });
    t.window.umami.identify('someone', { plan: 'x' });
    expect(t.fetch).not.toHaveBeenCalled();
  });
});

describe('never throws into the page', () => {
  it('survives a synchronously throwing fetch, a rejecting fetch, and a missing fetch', async () => {
    const throwing = load({ setup: (w) => { w.fetch = () => { throw new Error('sync'); }; } });
    expect(() => throwing.window.umami.track('x')).not.toThrow();

    const rejecting = load({ setup: (w) => { w.fetch = vi.fn(() => Promise.reject(new Error('net'))); } });
    expect(() => rejecting.window.umami.track('x')).not.toThrow();
    await new Promise((r) => setTimeout(r, 0)); // an unhandled rejection would fail the run

    const missing = load({ setup: (w) => { delete w.fetch; } });
    expect(() => missing.window.umami.track('x')).not.toThrow();
  });

  it('survives bad arguments and a throwing track(fn)', () => {
    const t = load();
    expect(() => t.window.umami.track(() => { throw new Error('x'); })).not.toThrow();
    expect(() => t.window.umami.track(null)).not.toThrow();
    expect(() => t.window.umami.track(42)).not.toThrow();
    expect(() => t.window.umami.track('x', () => {})).not.toThrow();
  });

  it('does not break history navigation when sending fails', () => {
    const t = load({ setup: (w) => { w.fetch = () => { throw new Error('sync'); }; } });
    expect(() => t.window.history.pushState({}, '', '/ok')).not.toThrow();
    expect(t.window.location.pathname).toBe('/ok');
  });

  it('survives a page without any matching script element', () => {
    const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://klettr.com/', runScripts: 'outside-only' });
    expect(() => dom.window.eval(source)).not.toThrow();
    expect(() => dom.window.umami.track('x')).not.toThrow();
  });
});

describe('size', () => {
  it('stays small', () => {
    expect(Buffer.byteLength(source)).toBeLessThan(4096);
  });
});
