/* ==========================================================================
   Usage Analytics Dashboard — usage-dashboard.js
   Zero-dependency dashboard for Collibra Usage Analytics. Designed to be
   hosted inside any Collibra environment: the Collibra base URL is discovered
   at runtime, authentication uses the browser session + CSRF token.
   ========================================================================== */
(function () {
  'use strict';

  const SCRIPT_SRC = document.currentScript ? document.currentScript.src : '';
  const STORE = 'uad.';
  const DAY = 86400000;

  /* ────────────────────────────────────────────────────────────────────────
     Utilities
     ──────────────────────────────────────────────────────────────────────── */

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function appendKids(el, kids) {
    for (const c of kids.flat(Infinity)) {
      if (c == null || c === false) continue;
      el.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
  }

  /** Create an HTML element. attrs: class, text, html, on<event>, style{}, dataset{}, others as attributes. */
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'html') el.innerHTML = v;
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    appendKids(el, kids);
    return el;
  }

  const SVGNS = 'http://www.w3.org/2000/svg';
  /** Create an SVG element. */
  function s(tag, attrs, ...kids) {
    const el = document.createElementNS(SVGNS, tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'text') el.textContent = v;
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v);
      }
    }
    appendKids(el, kids);
    return el;
  }

  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const pad2 = (n) => String(n).padStart(2, '0');
  const sum = (arr, f = (x) => x) => arr.reduce((a, x) => a + (Number(f(x)) || 0), 0);
  const uniq = (arr) => [...new Set(arr)];
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const isUuid = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ''));
  const slug = (v) => String(v || 'export').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'export';

  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  function groupBy(arr, keyFn) {
    const m = new Map();
    for (const x of arr) {
      const k = keyFn(x);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(x);
    }
    return m;
  }

  const NF = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
  const NF1 = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
  const NFC = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
  const fmtN = (n) => (n == null || Number.isNaN(Number(n)) ? '–' : NF.format(n));
  const fmt1 = (n) => (n == null || Number.isNaN(Number(n)) ? '–' : NF1.format(n));
  const fmtC = (n) => (n == null || Number.isNaN(Number(n)) ? '–' : Math.abs(n) < 10000 ? NF.format(Math.round(n * 10) / 10) : NFC.format(n));
  const fmtPct = (p, d = 1) => (p == null || !Number.isFinite(p) ? '–' : `${p.toFixed(d)}%`);
  const pctChange = (cur, prev) => (!prev ? null : ((cur - prev) / prev) * 100);
  const PLURALS = { Community: 'Communities', community: 'communities', person: 'people', 'distinct community': 'distinct communities' };
  const plural = (n, word) => `${fmtN(n)} ${n === 1 ? word : PLURALS[word] || `${word}s`}`;
  const pluralWord = (word) => PLURALS[word] || `${word}s`;

  /** Decode HTML entities ("&#x27;" → "'") without executing markup. */
  function decodeEntities(str) {
    if (!str || !/[&<]/.test(str)) return str || '';
    const doc = new DOMParser().parseFromString(`<!doctype html><body>${str}`, 'text/html');
    return doc.body.textContent || '';
  }
  const stripHtml = decodeEntities;

  function initials(name) {
    return String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('') || '?';
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  /* ── Dates (calendar dates are 'YYYY-MM-DD' strings, handled in UTC) ── */

  const toD = (iso) => new Date(`${iso}T00:00:00Z`);
  const isoOf = (d) => d.toISOString().slice(0, 10);
  const isoUTC = (y, m, d) => isoOf(new Date(Date.UTC(y, m, d)));
  const addDays = (iso, n) => isoOf(new Date(toD(iso).getTime() + n * DAY));
  const daysInclusive = (a, b) => Math.round((toD(b) - toD(a)) / DAY) + 1;
  const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
  const yesterday = () => addDays(localToday(), -1);
  const isIsoDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '') && !Number.isNaN(toD(v).getTime());
  const localIsoOfMs = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };

  const DF_FULL = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
  const DF_SHORT = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const DF_MONTH = new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' });
  const DF_DT = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  const fmtDate = (iso) => (iso ? DF_FULL.format(toD(iso)) : '–');
  const fmtDateShort = (iso) => (iso ? DF_SHORT.format(toD(iso)) : '–');
  const fmtDateTime = (ms) => (ms ? DF_DT.format(new Date(ms)) : '–');
  const fmtRange = (a, b) => (a === b ? fmtDate(a) : `${fmtDate(a)} – ${fmtDate(b)}`);

  function relTime(ms) {
    const diff = Date.now() - ms;
    const m = Math.round(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m} min ago`;
    const hrs = Math.round(m / 60);
    if (hrs < 48) return `${hrs} h ago`;
    return `${Math.round(hrs / 24)} days ago`;
  }

  /** Monday-based weekday index 0..6 for an ISO date. */
  const weekdayIdx = (iso) => (toD(iso).getUTCDay() + 6) % 7;

  function isoWeek(iso) {
    const d = toD(iso);
    const day = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - day + 3);
    const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
    return 1 + Math.round(((d - firstThu) / DAY - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
  }

  /** Start date of the bucket containing `iso` for a granularity. */
  function bucketStart(iso, gran) {
    const d = toD(iso);
    const y = d.getUTCFullYear(), m = d.getUTCMonth();
    switch (gran) {
      case 'Week': return addDays(iso, -weekdayIdx(iso));
      case 'Month': return isoUTC(y, m, 1);
      case 'Quarter': return isoUTC(y, Math.floor(m / 3) * 3, 1);
      default: return iso;
    }
  }

  function bucketEnd(startIso, gran) {
    const d = toD(startIso);
    const y = d.getUTCFullYear(), m = d.getUTCMonth();
    switch (gran) {
      case 'Week': return addDays(startIso, 6);
      case 'Month': return isoUTC(y, m + 1, 0);
      case 'Quarter': return isoUTC(y, m + 3, 0);
      default: return startIso;
    }
  }

  /** All buckets covering [start, end], with edge buckets clamped (same shape as the UA API). */
  function makeBuckets(start, end, gran) {
    const out = [];
    let b = bucketStart(start, gran);
    let guard = 0;
    while (b <= end && guard++ < 5000) {
      const be = bucketEnd(b, gran);
      out.push({ bucketStartDate: b, bucketEndDate: be, startDate: b < start ? start : b, endDate: be > end ? end : be });
      b = addDays(be, 1);
    }
    return out;
  }

  function bucketLabel(b, gran) {
    const iso = b.bucketStartDate;
    const d = toD(iso);
    switch (gran) {
      case 'Week': return `Wk ${isoWeek(iso)} · ${fmtDateShort(iso)}`;
      case 'Month': return DF_MONTH.format(d);
      case 'Quarter': return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`;
      default: return fmtDateShort(iso);
    }
  }

  function bucketFull(b, gran) {
    const partial = b.startDate !== b.bucketStartDate || b.endDate !== b.bucketEndDate;
    const base = gran === 'Day' ? fmtDate(b.startDate) : fmtRange(b.startDate, b.endDate);
    return partial ? `${base} (partial ${gran.toLowerCase()})` : base;
  }

  function autoGranularity(days) {
    if (days <= 45) return 'Day';
    if (days <= 190) return 'Week';
    if (days <= 800) return 'Month';
    return 'Quarter';
  }

  function movingAverage(values, n) {
    return values.map((_, i) => {
      if (i < n - 1) return null;
      const win = values.slice(i - n + 1, i + 1);
      return sum(win) / n;
    });
  }

  /* ── Statistics helpers (used by concentration, benchmarks, trends) ── */

  function median(values) {
    const v = values.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b);
    if (!v.length) return null;
    const m = Math.floor(v.length / 2);
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  }

  /** Percentile rank of `value` among `values`: % of values strictly below it, plus half of ties. */
  function percentileRank(values, value) {
    if (!values.length) return null;
    let below = 0, equal = 0;
    for (const x of values) { if (x < value) below++; else if (x === value) equal++; }
    return ((below + equal / 2) / values.length) * 100;
  }

  /** Gini coefficient of non-negative values (0 = perfectly even, 1 = everything in one item). */
  function gini(values) {
    const v = values.filter((x) => x > 0).sort((a, b) => a - b);
    const n = v.length, total = sum(v);
    if (n < 2 || !total) return n ? 0 : null;
    let acc = 0;
    v.forEach((x, i) => { acc += (i + 1) * x; });
    return (2 * acc) / (n * total) - (n + 1) / n;
  }

  /** Concentration summary for a list of per-item values. */
  function concentration(values) {
    const v = values.filter((x) => x > 0).sort((a, b) => b - a);
    const total = sum(v), n = v.length;
    const shareTop = (frac) => (n && total ? (sum(v.slice(0, Math.max(1, Math.ceil(n * frac)))) / total) * 100 : null);
    let acc = 0, k80 = 0;
    for (const x of v) { acc += x; k80++; if (acc >= total * 0.8) break; }
    const curve = [];
    for (let p = 5; p <= 100; p += 5) {
      const k = Math.max(1, Math.ceil((n * p) / 100));
      curve.push({ pct: p, items: Math.min(k, n), share: total ? (sum(v.slice(0, k)) / total) * 100 : 0 });
    }
    return { n, total, gini: gini(v), top10: shareTop(0.1), top20: shareTop(0.2), k80: n ? k80 : 0, k80pct: n ? (k80 / n) * 100 : null, curve };
  }

  /** Least-squares line through (i, values[i]). Returns slope per bucket, intercept, R² and fitted values. */
  function linearFit(values) {
    const pts = values.map((v, i) => [i, v]).filter(([, v]) => v != null && Number.isFinite(v));
    const n = pts.length;
    if (n < 2) return null;
    const mx = sum(pts, (p) => p[0]) / n, my = sum(pts, (p) => p[1]) / n;
    let sxy = 0, sxx = 0, syy = 0;
    for (const [x, v] of pts) { sxy += (x - mx) * (v - my); sxx += (x - mx) ** 2; syy += (v - my) ** 2; }
    const slope = sxx ? sxy / sxx : 0;
    const intercept = my - slope * mx;
    const r2 = sxx && syy ? (sxy * sxy) / (sxx * syy) : 0;
    return { slope, intercept, r2, mean: my, fitted: values.map((_, i) => Math.max(0, intercept + slope * i)) };
  }

  /** Compound growth per bucket between the first and last non-zero buckets, as a %. */
  function compoundGrowth(values) {
    const idx = values.map((v, i) => (v > 0 ? i : -1)).filter((i) => i >= 0);
    if (idx.length < 2) return null;
    const a = idx[0], b = idx[idx.length - 1];
    return { pct: ((values[b] / values[a]) ** (1 / (b - a)) - 1) * 100, from: values[a], to: values[b], periods: b - a, first: a, last: b };
  }

  /* ────────────────────────────────────────────────────────────────────────
     CSV parsing (RFC 4180: quoted fields, escaped quotes, embedded commas/newlines)
     ──────────────────────────────────────────────────────────────────────── */

  function parseCsv(text) {
    if (!text) return [];
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
        } else field += c;
        continue;
      }
      if (c === '"') quoted = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c !== '\r') field += c;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    const [header, ...data] = rows;
    if (!header) return [];
    return data
      .filter((r) => r.length > 1 || r[0] !== '')
      .map((r) => Object.fromEntries(header.map((k, j) => [k, r[j] ?? ''])));
  }

  /* ────────────────────────────────────────────────────────────────────────
     Env — portable Collibra base URL discovery
     Order: explicit override → cached → same origin (+ context-path discovery)
            → parent frame / referrer → script origin → saved Connect URL
            → Connect panel. Nothing environment-specific is hard-coded.
     ──────────────────────────────────────────────────────────────────────── */

  const Env = {
    base: null,
    csrf: null,
    source: null,
    info: null,
    user: null,
    caps: { ua: true, uaForbidden: false, graphql: true },

    host() {
      try { return new URL(this.base).host + new URL(this.base).pathname.replace(/\/$/, ''); } catch { return this.base || ''; }
    },
    assetUrl: (id) => `${Env.base}/asset/${id}`,
    domainUrl: (id) => `${Env.base}/domain/${id}`,
    communityUrl: (id) => `${Env.base}/community/${id}`,
    dashboardUrl: (id) => `${Env.base}/dashboard?d=${id}`,
    userUrl: (id) => `${Env.base}/profile/${id}`,
    urlFor(kind, id) {
      if (!id || !isUuid(id)) return null;
      switch (kind) {
        case 'Asset': case 'Diagram': return this.assetUrl(id);
        case 'Domain': return this.domainUrl(id);
        case 'Community': return this.communityUrl(id);
        case 'Dashboard': return this.dashboardUrl(id);
        default: return null;
      }
    },
  };

  function normBase(u) {
    try {
      const x = new URL(String(u).trim(), location.href);
      if (!/^https?:$/.test(x.protocol)) return null;
      return (x.origin + x.pathname).replace(/\/+$/, '');
    } catch {
      return null;
    }
  }

  /**
   * Check whether `base` hosts the Collibra REST API. The probe doubles as
   * the CSRF bootstrap. Only a JSON body with csrfToken counts as success,
   * so HTML login pages and 404 pages are rejected.
   */
  async function probeBase(base) {
    try {
      const r = await fetch(`${base}/rest/2.0/auth/sessions/current?include=csrfToken`, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      const ct = r.headers.get('content-type') || '';
      if (!ct.includes('json')) return { ok: false, status: r.status };
      const j = await r.json().catch(() => null);
      if (r.ok && j && typeof j.csrfToken === 'string') return { ok: true, csrf: j.csrfToken };
      // A JSON 401 from Collibra means "right place, not signed in".
      if (r.status === 401 && j && (j.statusCode === 401 || j.errorCode || j.titleMessage)) return { ok: false, unauth: true, status: 401 };
      return { ok: false, status: r.status };
    } catch (e) {
      return { ok: false, error: e };
    }
  }

  /** Candidate bases from a URL path, longest prefix first (the file name and any /rest/... suffix are dropped). */
  function pathCandidates(origin, pathname) {
    const segs = pathname.split('/').filter(Boolean).map(decodeURIComponent);
    if (segs.length && /\.[a-z0-9]{1,6}$/i.test(segs[segs.length - 1])) segs.pop();
    const restIdx = segs.indexOf('rest');
    if (restIdx >= 0) segs.length = restIdx;
    if (segs.length > 8) segs.length = 8;
    const out = [];
    for (let i = segs.length; i >= 0; i--) out.push(origin + (i ? `/${segs.slice(0, i).map(encodeURIComponent).join('/')}` : ''));
    return out;
  }

  function overrideBase() {
    const q = new URLSearchParams(location.search).get('collibraBase');
    if (q) return { base: q, source: 'URL parameter' };
    const hq = new URLSearchParams(location.hash.replace(/^#/, '')).get('collibraBase');
    if (hq) return { base: hq, source: 'URL parameter' };
    const meta = document.querySelector('meta[name="collibra-base-url"]');
    const mv = meta && meta.getAttribute('content') && meta.getAttribute('content').trim();
    if (mv) return { base: mv, source: 'meta tag' };
    return null;
  }

  async function resolveBase() {
    const tried = new Set();
    let unauthBase = null;

    const tryGroup = async (bases, source) => {
      const list = uniq(bases.map(normBase).filter(Boolean)).filter((b) => !tried.has(b));
      if (!list.length) return null;
      list.forEach((b) => tried.add(b));
      const results = await Promise.all(list.map(probeBase));
      for (let i = 0; i < list.length; i++) {
        if (results[i].ok) return { base: list[i], csrf: results[i].csrf, source };
        if (results[i].unauth && !unauthBase) unauthBase = list[i];
      }
      return null;
    };

    const ov = overrideBase();
    if (ov) {
      const r = await tryGroup([ov.base], ov.source);
      if (r) return r;
    }

    const cacheKey = `${STORE}base:${location.pathname}`;
    let cached = null;
    try { cached = sessionStorage.getItem(cacheKey); } catch { /* storage may be blocked */ }
    if (cached) {
      const r = await tryGroup([cached], 'cached');
      if (r) return r;
    }

    if (/^https?:$/.test(location.protocol)) {
      const r = await tryGroup(pathCandidates(location.origin, location.pathname), 'same origin');
      if (r) return r;
    }

    const framed = [];
    try {
      if (window.parent !== window && window.parent.location.origin) {
        framed.push(...pathCandidates(window.parent.location.origin, window.parent.location.pathname));
      }
    } catch { /* cross-origin parent */ }
    if (document.referrer) {
      try { const u = new URL(document.referrer); framed.push(...pathCandidates(u.origin, u.pathname)); } catch { /* ignore */ }
    }
    if (framed.length) {
      const r = await tryGroup(framed, 'embedding page');
      if (r) return r;
    }

    if (SCRIPT_SRC) {
      try {
        const u = new URL(SCRIPT_SRC);
        if (/^https?:$/.test(u.protocol)) {
          const r = await tryGroup(pathCandidates(u.origin, u.pathname), 'script origin');
          if (r) return r;
        }
      } catch { /* ignore */ }
    }

    let saved = null;
    try { saved = localStorage.getItem(`${STORE}base`); } catch { /* ignore */ }
    if (saved) {
      const r = await tryGroup([saved], 'saved connection');
      if (r) return r;
    }

    return { base: null, unauthBase, tried: [...tried] };
  }

  function rememberBase(base) {
    try { sessionStorage.setItem(`${STORE}base:${location.pathname}`, base); } catch { /* ignore */ }
  }

  /* ────────────────────────────────────────────────────────────────────────
     Api — fetch wrapper (session cookie + CSRF), cache, abort, concurrency
     ──────────────────────────────────────────────────────────────────────── */

  class ApiError extends Error {
    constructor(message, status, path, detail) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.path = path;
      this.detail = detail;
    }
  }

  function qs(params) {
    if (!params) return '';
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v == null || v === '') continue;
      if (Array.isArray(v)) v.forEach((x) => p.append(k, x));
      else p.append(k, String(v));
    }
    const str = p.toString();
    return str ? `?${str}` : '';
  }

  const Api = {
    cache: new Map(),
    controller: new AbortController(),
    active: 0,
    waiters: [],
    MAX: 6,
    onSessionLost: null,

    /** Abort in-flight requests (filters changed) and drop their pending cache entries. */
    resetScope() {
      this.controller.abort();
      this.controller = new AbortController();
      for (const [k, v] of this.cache) if (!v.done) this.cache.delete(k);
    },
    clearCache() {
      this.resetScope();
      this.cache.clear();
    },

    async acquire() {
      if (this.active < this.MAX) { this.active++; return; }
      await new Promise((r) => this.waiters.push(r));
      this.active++;
    },
    release() {
      this.active--;
      const next = this.waiters.shift();
      if (next) next();
    },

    async request(path, { method = 'GET', body, accept = 'application/json', signal } = {}) {
      await this.acquire();
      try {
        for (let attempt = 0; attempt < 2; attempt++) {
          if (signal && signal.aborted) throw new DOMException('Aborted', 'AbortError');
          const headers = { Accept: accept };
          if (Env.csrf) headers['X-CSRF-TOKEN'] = Env.csrf;
          if (body !== undefined) headers['Content-Type'] = 'application/json';
          let res;
          try {
            res = await fetch(Env.base + path, {
              method,
              headers,
              credentials: 'include',
              body: body !== undefined ? JSON.stringify(body) : undefined,
              signal,
            });
          } catch (e) {
            if (e.name === 'AbortError') throw e;
            throw new ApiError('Could not reach Collibra (network error).', 0, path, e.message);
          }
          if ((res.status === 401 || res.status === 403) && attempt === 0) {
            const before = Env.csrf;
            const p = await probeBase(Env.base);
            if (p.ok) {
              Env.csrf = p.csrf;
              if (res.status === 401 || p.csrf !== before) continue;
            } else if (p.unauth) {
              if (this.onSessionLost) this.onSessionLost();
              throw new ApiError('Your Collibra session has expired. Sign in again and refresh.', 401, path);
            }
          }
          if (!res.ok) {
            let detail = '';
            try {
              const t = await res.text();
              try {
                const j = JSON.parse(t);
                detail = j.userMessage || j.message || j.titleMessage || t;
              } catch { detail = t.slice(0, 300); }
            } catch { /* ignore */ }
            const msg = res.status === 403
              ? 'Permission denied.'
              : res.status === 404 ? 'Not found on this Collibra environment.' : `Collibra returned HTTP ${res.status}.`;
            throw new ApiError(msg, res.status, path, detail);
          }
          return res;
        }
        throw new ApiError('Request failed after re-authenticating.', 401, path);
      } finally {
        this.release();
      }
    },

    cached(key, fn) {
      const hit = this.cache.get(key);
      if (hit) return hit.promise;
      const entry = { done: false, promise: null };
      entry.promise = fn().then(
        (v) => { entry.done = true; return v; },
        (e) => { if (this.cache.get(key) === entry) this.cache.delete(key); throw e; },
      );
      this.cache.set(key, entry);
      return entry.promise;
    },

    get(path, params) {
      const url = path + qs(params);
      const signal = this.controller.signal;
      return this.cached(`GET ${url}`, () => this.request(url, { signal }).then((r) => r.json()));
    },
    /** Uncached GET (for paged loops that manage their own state). */
    getFresh(path, params, signal = this.controller.signal) {
      return this.request(path + qs(params), { signal }).then((r) => r.json());
    },
    csv(path, params) {
      const url = path + qs(params);
      const signal = this.controller.signal;
      return this.cached(`CSV ${url}`, () =>
        this.request(url, { signal, accept: 'text/csv, application/octet-stream, */*' }).then((r) => r.text()).then(parseCsv),
      );
    },
    gql(query, variables) {
      const signal = this.controller.signal;
      return this.cached(`GQL ${query} ${JSON.stringify(variables || {})}`, async () => {
        const r = await this.request('/graphql/knowledgeGraph/v1', { method: 'POST', body: { query, variables }, signal });
        const j = await r.json();
        if (j.errors && j.errors.length) throw new ApiError(`GraphQL: ${j.errors[0].message}`, 200, 'graphql', JSON.stringify(j.errors).slice(0, 400));
        return j.data;
      });
    },

    /** Offset-paged REST collection. */
    async paged(path, params, { pageSize = 1000, max = Infinity, onPage, signal = this.controller.signal } = {}) {
      const out = [];
      let total = null;
      for (let offset = 0; out.length < max; offset += pageSize) {
        const limit = Math.min(pageSize, max - out.length);
        const page = await this.getFresh(path, { ...params, offset, limit }, signal);
        const rows = page.results || [];
        if (typeof page.total === 'number' && page.total < Number.MAX_SAFE_INTEGER) total = page.total;
        out.push(...rows);
        if (onPage) onPage(out.length, total);
        if (rows.length < limit) break;
      }
      return { results: out, total, capped: out.length >= max };
    },
  };

  /* ────────────────────────────────────────────────────────────────────────
     Filters & state (URL-hash synced)
     ──────────────────────────────────────────────────────────────────────── */

  const FILTERS = [
    { key: 'groups', label: 'User groups', list: 'groups', param: 'userGroupIds', services: ['usage', 'users'] },
    { key: 'roles', label: 'Roles', list: 'roles', param: 'userRoleIds', services: ['usage', 'users'] },
    { key: 'licenses', label: 'License types', list: 'licenseTypes', param: 'userLicenseTypes', services: ['usage', 'users'] },
    { key: 'orgs', label: 'Communities & domains', list: 'organizations', param: 'organizationIds', services: ['usage'] },
    { key: 'types', label: 'Asset types', list: 'assetTypes', param: 'assetTypeIds', services: ['usage'] },
  ];

  const PRESETS = {
    last7: 'Last 7 days', last30: 'Last 30 days', last90: 'Last 90 days', thisMonth: 'This month',
    lastMonth: 'Last month', qtd: 'Quarter to date', lastQuarter: 'Last quarter', ytd: 'Year to date',
    last12m: 'Last 12 months', custom: 'Custom',
  };
  const GRANS = ['Auto', 'Day', 'Week', 'Month', 'Quarter'];
  const TAB_IDS = ['overview', 'content', 'dashboards', 'users', 'asset', 'compare', 'popularity', 'activity', 'ratings'];
  const COMPARE_KINDS = ['Asset', 'Domain', 'Community', 'Dashboard', 'Diagram'];
  const MAX_COMPARE = 10;
  const MAX_TRACKED_USERS = 5;

  const DEFAULTS = {
    tab: 'overview', range: 'last30', from: '', to: '', g: 'Auto', cmp: 'previous', xa: false, xd: false,
    f: { groups: [], roles: [], licenses: [], orgs: [], types: [] },
    ctype: 'All', utype: 'Active', asset: '', popN: 500, actCap: 5000, cause: 'All', rscope: 'all',
    mixOff: [], dsel: [], dmin: 0, dtop: 10, items: [], cmetric: 'visits', cnorm: 'abs', cbench: false, users: [], stale: 180,
  };
  /** State keys holding lists (serialized as repeated hash parameters). */
  const LIST_KEYS = ['mixOff', 'dsel', 'items', 'users'];
  /** State keys whose change requires re-fetching data (vs. view-only changes). */
  const DATA_KEYS = ['range', 'from', 'to', 'g', 'cmp', 'xa', 'xd', 'f'];

  function presetRange(p) {
    const end = yesterday();
    const e = toD(end);
    const y = e.getUTCFullYear(), m = e.getUTCMonth(), d = e.getUTCDate();
    const q = Math.floor(m / 3) * 3;
    switch (p) {
      case 'last7': return { startDate: addDays(end, -6), endDate: end };
      case 'last90': return { startDate: addDays(end, -89), endDate: end };
      case 'thisMonth': return { startDate: isoUTC(y, m, 1), endDate: end };
      case 'lastMonth': return { startDate: isoUTC(y, m - 1, 1), endDate: isoUTC(y, m, 0) };
      case 'qtd': return { startDate: isoUTC(y, q, 1), endDate: end };
      case 'lastQuarter': return { startDate: isoUTC(y, q - 3, 1), endDate: isoUTC(y, q, 0) };
      case 'ytd': return { startDate: isoUTC(y, 0, 1), endDate: end };
      case 'last12m': return { startDate: isoUTC(y - 1, m, d + 1), endDate: end };
      default: return { startDate: addDays(end, -29), endDate: end };
    }
  }

  function shiftYear(iso, n) {
    const d = toD(iso);
    const y = d.getUTCFullYear() + n, m = d.getUTCMonth();
    const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return isoUTC(y, m, Math.min(d.getUTCDate(), last));
  }

  const State = {
    s: null,
    lists: {},
    labels: new Map(),

    init() { this.s = this.fromHash(location.hash); },

    range() {
      const st = this.s;
      if (st.range === 'custom' && isIsoDate(st.from) && isIsoDate(st.to)) {
        return st.from <= st.to ? { startDate: st.from, endDate: st.to } : { startDate: st.to, endDate: st.from };
      }
      const r = presetRange(st.range);
      if (r.startDate > r.endDate) r.startDate = r.endDate;
      return r;
    },
    days() { const r = this.range(); return daysInclusive(r.startDate, r.endDate); },
    gran() { return this.s.g === 'Auto' ? autoGranularity(this.days()) : this.s.g; },
    compareRange() {
      const r = this.range();
      if (this.s.cmp === 'none') return null;
      if (this.s.cmp === 'yoy') return { startDate: shiftYear(r.startDate, -1), endDate: shiftYear(r.endDate, -1) };
      const n = daysInclusive(r.startDate, r.endDate);
      return { startDate: addDays(r.startDate, -n), endDate: addDays(r.startDate, -1) };
    },
    compareLabel() { return this.s.cmp === 'yoy' ? 'same period last year' : 'previous period'; },
    filterCount() { return sum(FILTERS, (f) => this.s.f[f.key].length) + (this.s.xa ? 1 : 0) + (this.s.xd ? 1 : 0); },
    label(key, id) {
      return this.labels.get(`${key}:${id}`) || (key === 'licenses' ? id : '…');
    },

    /** Human-readable description of the active filters (used in exports and print headers). */
    describe() {
      const r = this.range();
      const parts = [`${fmtRange(r.startDate, r.endDate)}`, `${this.gran()} granularity`];
      const cr = this.compareRange();
      if (cr) parts.push(`vs ${fmtRange(cr.startDate, cr.endDate)}`);
      if (this.s.xa) parts.push('excluding admins');
      if (this.s.xd) parts.push('excluding disabled users');
      for (const f of FILTERS) {
        const v = this.s.f[f.key];
        if (v.length) parts.push(`${f.label}: ${v.map((id) => this.label(f.key, id)).join(', ')}`);
      }
      return parts.join(' · ');
    },
    describeObj() {
      const r = this.range();
      const o = { startDate: r.startDate, endDate: r.endDate, granularity: this.gran(), comparison: this.compareRange(), excludeAdmin: this.s.xa, excludeDisabledUsers: this.s.xd };
      for (const f of FILTERS) o[f.key] = this.s.f[f.key].map((id) => ({ id, label: this.label(f.key, id) }));
      return o;
    },

    toHash(st = this.s) {
      const p = new URLSearchParams();
      const d = DEFAULTS;
      if (st.tab !== d.tab) p.set('tab', st.tab);
      if (st.range !== d.range) p.set('range', st.range);
      if (st.range === 'custom') { p.set('from', st.from); p.set('to', st.to); }
      if (st.g !== d.g) p.set('g', st.g);
      if (st.cmp !== d.cmp) p.set('cmp', st.cmp);
      if (st.xa) p.set('xa', '1');
      if (st.xd) p.set('xd', '1');
      for (const f of FILTERS) st.f[f.key].forEach((v) => p.append(f.key, v));
      for (const k of ['ctype', 'utype', 'asset', 'popN', 'actCap', 'cause', 'rscope', 'dmin', 'dtop', 'cmetric', 'cnorm', 'stale']) {
        if (st[k] !== d[k] && st[k] !== '') p.set(k, String(st[k]));
      }
      if (st.cbench) p.set('cbench', '1');
      for (const k of LIST_KEYS) (st[k] || []).forEach((v) => p.append(k, v));
      const base = new URLSearchParams(location.hash.replace(/^#/, '')).get('collibraBase');
      if (base) p.set('collibraBase', base);
      return p.toString();
    },

    fromHash(hash) {
      const p = new URLSearchParams(String(hash || '').replace(/^#/, ''));
      const st = JSON.parse(JSON.stringify(DEFAULTS));
      const pick = (k, allowed) => { const v = p.get(k); if (v != null && (!allowed || allowed.includes(v))) st[k] = v; };
      pick('tab', TAB_IDS);
      pick('range', Object.keys(PRESETS));
      if (isIsoDate(p.get('from'))) st.from = p.get('from');
      if (isIsoDate(p.get('to'))) st.to = p.get('to');
      if (st.range === 'custom' && !(st.from && st.to)) st.range = DEFAULTS.range;
      pick('g', GRANS);
      pick('cmp', ['previous', 'yoy', 'none']);
      st.xa = p.get('xa') === '1';
      st.xd = p.get('xd') === '1';
      for (const f of FILTERS) st.f[f.key] = p.getAll(f.key).filter((v) => (f.key === 'licenses' ? v.trim() : isUuid(v)));
      pick('ctype', ['All', 'Asset', 'Domain', 'Community', 'Dashboard', 'Diagram']);
      pick('utype', ['Active', 'Inactive', 'New']);
      if (isUuid(p.get('asset'))) st.asset = p.get('asset');
      const num = (k, allowed) => { const n = Number(p.get(k)); if (allowed.includes(n)) st[k] = n; };
      num('popN', [100, 250, 500, 1000, 2500]);
      num('actCap', [1000, 5000, 10000, 25000, 50000]);
      pick('cause', ['All', 'MANUAL', 'IMPORT', 'WORKFLOW']);
      pick('rscope', ['all', 'range']);
      st.mixOff = uniq(p.getAll('mixOff').filter((v) => UA.TYPES.includes(v)));
      if (st.mixOff.length >= UA.TYPES.length) st.mixOff = [];
      st.dsel = uniq(p.getAll('dsel').filter(isUuid));
      num('dmin', [0, 1, 5, 10, 50, 100]);
      num('dtop', [5, 10, 20]);
      st.items = uniq(p.getAll('items').filter((v) => { const [k, id] = v.split(':'); return COMPARE_KINDS.includes(k) && isUuid(id); })).slice(0, MAX_COMPARE);
      pick('cmetric', ['visits', 'cumulative', 'share', 'edits']);
      pick('cnorm', ['abs', 'index', 'pct']);
      st.cbench = p.get('cbench') === '1';
      st.users = uniq(p.getAll('users').map((v) => v.trim()).filter(Boolean)).slice(0, MAX_TRACKED_USERS);
      num('stale', [90, 180, 365]);
      return st;
    },
  };

  /* ────────────────────────────────────────────────────────────────────────
     Usage Analytics client + data services
     ──────────────────────────────────────────────────────────────────────── */

  const UA = {
    USAGE: '/rest/usageAnalyticsUsage/v1',
    USERS: '/rest/usageAnalyticsUsers/v1',
    TYPES: ['Asset', 'Domain', 'Community', 'Dashboard', 'Diagram'],
    USER_TYPES: ['Active', 'Inactive', 'New'],

    root(service) { return service === 'users' ? this.USERS : this.USAGE; },
    params(service, range, extra) {
      const p = {
        startDate: range.startDate,
        endDate: range.endDate,
        excludeAdmin: State.s.xa,
        excludeDisabledUser: State.s.xd,
      };
      for (const f of FILTERS) {
        if (!f.services.includes(service)) continue;
        const v = State.s.f[f.key];
        if (v.length) p[f.param] = v;
      }
      return { ...p, ...extra };
    },
    get(service, path, extra = {}, range = State.range()) {
      return Api.get(`${this.root(service)}/${path}`, this.params(service, range, extra));
    },
    csv(service, path, extra = {}, range = State.range()) {
      return Api.csv(`${this.root(service)}/${path}`, this.params(service, range, extra));
    },
  };

  /**
   * Pivot flat UA time-series rows (one per bucket × category) into one row per
   * bucket with a column per category; missing buckets are filled with zeros.
   */
  function pivot(results, catKey, gran, range, knownCats = []) {
    const cats = [...knownCats];
    const byKey = new Map();
    for (const r of results || []) {
      const key = r.bucketStartDate;
      if (!byKey.has(key)) byKey.set(key, { bucketStartDate: r.bucketStartDate, bucketEndDate: r.bucketEndDate, startDate: r.startDate, endDate: r.endDate });
      const row = byKey.get(key);
      const cat = catKey ? String(r[catKey] ?? 'Unknown') : 'count';
      if (!cats.includes(cat)) cats.push(cat);
      row[cat] = (row[cat] || 0) + (Number(r.count) || 0);
    }
    const buckets = range ? makeBuckets(range.startDate, range.endDate, gran) : [...byKey.values()];
    const rows = buckets.map((b) => {
      const src = byKey.get(b.bucketStartDate) || b;
      const row = { ...b, ...src };
      for (const c of cats) row[c] = row[c] || 0;
      row.total = sum(cats, (c) => row[c]);
      row.label = bucketLabel(row, gran);
      row.full = bucketFull(row, gran);
      return row;
    });
    return { categories: cats, rows };
  }

  function chunk(arr, n) {
    const out = [];
    for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out;
  }

  const RES_KIND = {
    TE: 'Asset', AS: 'Asset', DO: 'Domain', VC: 'Community', CO: 'Community', RE: 'Relation', CR: 'Complex relation',
    WI: 'Workflow', UR: 'User', GR: 'Group', RO: 'Role', RS: 'Responsibility', AT: 'Attribute', TA: 'Tag', CM: 'Comment',
  };

  function normActivity(a) {
    let d = {};
    try { d = JSON.parse(a.description || '{}'); } catch { /* not JSON */ }
    const aff = d.affected || {};
    let kind = RES_KIND[aff.type] || (d.complexRelation ? 'Complex relation' : aff.type || 'Other');
    if (d.field === 'COMMENT') kind = 'Comment';
    let resource = decodeEntities(aff.name || '');
    if (aff.type === 'RE' && (d.source || d.target)) {
      resource = `${decodeEntities(d.source?.name || '?')} → ${decodeEntities(d.target?.name || '?')}`;
    } else if (!resource && d.complexRelation) resource = d.complexRelation;
    const field = d.field && d.field !== 'COMMENT' ? d.field : d.role ? `${d.role} / ${d.coRole || ''}` : '';
    return {
      id: a.id,
      ts: a.timestamp,
      date: localIsoOfMs(a.timestamp),
      user: a.user?.userName || 'Unknown',
      userId: a.user?.id || '',
      type: a.activityType || 'OTHER',
      cause: a.cause || 'OTHER',
      kind,
      resource,
      resourceId: aff.type === 'TE' || aff.type === 'AS' ? aff.id : d.businessItem?.type === 'TE' ? d.businessItem.id : '',
      field,
    };
  }

  const Data = {
    activityCache: new Map(),

    async lastRefreshed() {
      const r = await Api.get(`${UA.USAGE}/lastRefreshed`);
      return r.lastRefreshDateTime || null;
    },

    async contentSummary(range) {
      const r = await UA.get('usage', 'visits/summary', {}, range);
      const counts = Object.fromEntries(UA.TYPES.map((t) => [t, 0]));
      for (const x of r.results || []) counts[x.visitType] = (counts[x.visitType] || 0) + (Number(x.count) || 0);
      counts.total = sum(UA.TYPES, (t) => counts[t]);
      return counts;
    },

    async contentTrend(range, gran) {
      const r = await UA.get('usage', 'visits/timeSeries', { granularity: gran }, range);
      return pivot(r.results, 'visitType', gran, range, UA.TYPES);
    },

    async contentTop(type, limit = 10, range = State.range()) {
      const r = await UA.get('usage', 'visits/top', { visitType: type, limit: clamp(limit, 1, 100), granularity: State.gran() }, range);
      return (r.results || []).map((x, i) => ({ rank: i + 1, id: x.id, name: x.label, visits: Number(x.count) || 0 }));
    },

    /** Full per-item visit list from the row-level download endpoint (not limited to 100). */
    async contentDetail(type, range = State.range()) {
      const rows = await UA.csv('usage', 'visits/timeSeries/download', { visitType: type, granularity: 'Quarter' }, range);
      const m = new Map();
      for (const r of rows) {
        const id = r[`${type} Id`] || r[type];
        let it = m.get(id);
        if (!it) {
          it = {
            id,
            name: r[type] || '(unnamed)',
            kind: type,
            assetType: r['Asset Type'] || '',
            domain: type === 'Domain' ? r[type] : r.Domain || '',
            domainId: type === 'Domain' ? id : r['Domain Id'] || '',
            community: type === 'Community' ? r[type] : r.Community || '',
            communityId: type === 'Community' ? id : r['Community Id'] || '',
            hierarchy: r['Community Hierarchy'] || '',
            asset: r.Asset || '',
            assetId: r['Asset Id'] || '',
            visits: 0,
          };
          m.set(id, it);
        }
        it.visits += Number(r.Count) || 0;
      }
      return [...m.values()].sort((a, b) => b.visits - a.visits);
    },

    async contentDetailAll(range = State.range()) {
      const lists = await Promise.all(UA.TYPES.map((t) => this.contentDetail(t, range)));
      return lists.flat().sort((a, b) => b.visits - a.visits);
    },

    async userSummary(range) {
      const res = await Promise.all(UA.USER_TYPES.map((t) => UA.get('users', 'summary', { summaryUserType: t }, range)));
      return Object.fromEntries(UA.USER_TYPES.map((t, i) => [t, Number(res[i].count) || 0]));
    },

    async userTop(limit = 10, range = State.range()) {
      const r = await UA.get('users', 'top', { limit: clamp(limit, 1, 100) }, range);
      return (r.results || []).map((u, i) => ({ rank: i + 1, id: u.id, name: u.fullName || '(unknown)', visits: Number(u.count) || 0 }));
    },

    /** kind: usageRate | retention | license. usageRate has no Day granularity, so Week is used. */
    async userTrend(kind, range, gran, userType = 'Active') {
      const path = { usageRate: 'usageRate/timeSeries', retention: 'userRetention/timeSeries', license: 'licenseTypes/timeSeries' }[kind];
      const g = kind === 'usageRate' && gran === 'Day' ? 'Week' : gran;
      const r = await UA.get('users', path, { granularity: g, ...(kind === 'license' ? { userType } : {}) }, range);
      const known = { usageRate: ['High', 'Medium', 'Low'], retention: ['Acquired', 'Retained', 'Returning'], license: [] }[kind];
      const out = { ...pivot(r.results, 'category', g, range, known), gran: g, adjusted: g !== gran };
      // License categories are open-ended; drop all-zero ones (e.g. "Unknown") when others have data.
      if (kind === 'license') {
        const nonZero = out.categories.filter((c) => out.rows.some((x) => x[c] > 0));
        if (nonZero.length) out.categories = nonZero;
      }
      return out;
    },

    /** Per-user activity (sessions + visits by content type) from the license-types download. */
    async userDetail(range, userType = 'Active') {
      const rows = await UA.csv('users', 'licenseTypes/timeSeries/download', { granularity: 'Quarter', userType }, range);
      const m = new Map();
      for (const r of rows) {
        const key = r.User;
        let u = m.get(key);
        if (!u) {
          u = { name: r.User, license: r['Required License'] || '', roles: (r.Roles || '').split(';').filter(Boolean), category: r.Category || userType, sessions: 0, Asset: 0, Domain: 0, Community: 0, Dashboard: 0, Diagram: 0 };
          m.set(key, u);
        }
        u.sessions += Number(r['Number of Sessions']) || 0;
        for (const t of UA.TYPES) u[t] += Number(r[`${t} Visits`]) || 0;
      }
      return [...m.values()].map((u) => ({ ...u, visits: sum(UA.TYPES, (t) => u[t]) })).sort((a, b) => b.visits - a.visits);
    },

    /**
     * Deduplicated active users. `unique` is Collibra's own distinct count (by
     * user ID). Per-bucket counts from the time series count a user once per
     * bucket, so summing them gives user-days / user-weeks, not people.
     * The cumulative series comes from the row-level download (one row per
     * user per bucket), which only identifies users by name.
     */
    async uniqueActive(range, gran) {
      const [summary, daily, rows] = await Promise.all([
        this.userSummary(range),
        UA.get('users', 'licenseTypes/timeSeries', { granularity: 'Day', userType: 'Active' }, range),
        UA.csv('users', 'licenseTypes/timeSeries/download', { granularity: gran, userType: 'Active' }, range),
      ]);
      const perDay = pivot(daily.results, 'category', 'Day', range).rows;
      const userDays = sum(perDay, (x) => x.total);
      const activeDays = perDay.filter((x) => x.total > 0).length;
      const days = daysInclusive(range.startDate, range.endDate);

      const bucketUsers = new Map();
      const firstSeen = new Map();
      for (const r of rows) {
        const user = r.User;
        const start = r['Interval Start Date'];
        if (!user || !isIsoDate(start)) continue;
        const b = bucketStart(start, gran);
        if (!bucketUsers.has(b)) bucketUsers.set(b, new Set());
        bucketUsers.get(b).add(user);
        if (!firstSeen.has(user) || b < firstSeen.get(user)) firstSeen.set(user, b);
      }
      let cumulative = 0;
      const daysPerBucket = new Map();
      for (const d of perDay) {
        const b = bucketStart(d.startDate, gran);
        daysPerBucket.set(b, (daysPerBucket.get(b) || 0) + d.total);
      }
      const buckets = makeBuckets(range.startDate, range.endDate, gran).map((b) => {
        const active = bucketUsers.get(b.bucketStartDate)?.size || 0;
        const newUnique = [...firstSeen.values()].filter((f) => f === b.bucketStartDate).length;
        cumulative += newUnique;
        const row = { ...b, active, newUnique, cumulative, userDays: daysPerBucket.get(b.bucketStartDate) || 0 };
        row.label = bucketLabel(row, gran);
        row.full = bucketFull(row, gran);
        return row;
      });
      return {
        unique: summary.Active,
        downloadDistinct: firstSeen.size,
        userBuckets: sum(buckets, (x) => x.active),
        userDays,
        activeDays,
        days,
        avgDaily: days ? userDays / days : 0,
        gran,
        buckets,
      };
    },

    /* ── Per-bucket detail from row-level downloads (Dashboards, Compare, user tracking) ── */

    _buckets(range, gran) {
      const buckets = makeBuckets(range.startDate, range.endDate, gran).map((b) => ({ ...b, label: bucketLabel(b, gran), full: bucketFull(b, gran) }));
      return { buckets, index: new Map(buckets.map((b, i) => [b.bucketStartDate, i])) };
    },
    _bucketOf(row, index, gran) {
      const start = row['Interval Start Date'];
      return isIsoDate(start) ? index.get(bucketStart(start, gran)) : undefined;
    },
    _noIntervals(what) {
      return new ApiError(`This Collibra version\u2019s ${what} download has no "Interval Start Date" column, so per-period detail isn\u2019t available.`, 200, `${UA.USAGE}/\u2026/download`);
    },

    /**
     * Per-item, per-bucket visits for one content type (row-level download at the
     * chosen granularity). Returns items sorted by visits plus per-bucket totals
     * and distinct items visited per bucket.
     */
    async itemSeries(type, range, gran) {
      return Api.cached(`itemSeries:${type}:${range.startDate}:${range.endDate}:${gran}:${JSON.stringify(UA.params('usage', range))}`, async () => {
        const rows = await UA.csv('usage', 'visits/timeSeries/download', { visitType: type, granularity: gran }, range);
        const { buckets, index } = this._buckets(range, gran);
        const items = new Map();
        let placed = 0;
        for (const r of rows) {
          const id = r[`${type} Id`] || r[type];
          if (!id) continue;
          const i = this._bucketOf(r, index, gran);
          if (i === undefined) continue;
          placed++;
          let it = items.get(id);
          if (!it) {
            it = {
              id, kind: type, name: r[type] || '(unnamed)',
              assetType: r['Asset Type'] || '',
              domain: type === 'Domain' ? r[type] : r.Domain || '', domainId: type === 'Domain' ? id : r['Domain Id'] || '',
              community: type === 'Community' ? r[type] : r.Community || '', communityId: type === 'Community' ? id : r['Community Id'] || '',
              values: new Array(buckets.length).fill(0), total: 0,
            };
            items.set(id, it);
          }
          const c = Number(r.Count) || 0;
          it.values[i] += c;
          it.total += c;
        }
        if (rows.length && !placed) throw this._noIntervals(`${type.toLowerCase()} visit`);
        const list = [...items.values()].sort((a, b) => b.total - a.total);
        const totals = buckets.map((_, i) => sum(list, (x) => x.values[i]));
        const distinct = buckets.map((_, i) => list.reduce((n, x) => n + (x.values[i] > 0 ? 1 : 0), 0));
        return { type, gran, buckets, items: list, byId: new Map(list.map((x) => [x.id, x])), totals, distinct };
      });
    },

    /** Per-user, per-bucket sessions and visits by content type (license-types download). Users are identified by name. */
    async userSeries(range, gran, userType = 'Active') {
      return Api.cached(`userSeries:${userType}:${range.startDate}:${range.endDate}:${gran}:${JSON.stringify(UA.params('users', range))}`, async () => {
        const rows = await UA.csv('users', 'licenseTypes/timeSeries/download', { granularity: gran, userType }, range);
        const { buckets, index } = this._buckets(range, gran);
        const users = new Map();
        const zeros = () => new Array(buckets.length).fill(0);
        let placed = 0;
        for (const r of rows) {
          if (!r.User) continue;
          const i = this._bucketOf(r, index, gran);
          if (i === undefined) continue;
          placed++;
          let u = users.get(r.User);
          if (!u) {
            u = { name: r.User, license: r['Required License'] || '', roles: (r.Roles || '').split(';').map((x) => x.trim()).filter(Boolean), active: zeros(), sessions: zeros(), visits: zeros() };
            UA.TYPES.forEach((t) => { u[t] = zeros(); });
            users.set(r.User, u);
          }
          u.active[i] = 1;
          u.sessions[i] += Number(r['Number of Sessions']) || 0;
          for (const t of UA.TYPES) {
            const v = Number(r[`${t} Visits`]) || 0;
            u[t][i] += v;
            u.visits[i] += v;
          }
        }
        if (rows.length && !placed) throw this._noIntervals('user');
        const list = [...users.values()].map((u) => {
          const tot = { sessions: sum(u.sessions), visits: sum(u.visits), activeBuckets: sum(u.active) };
          UA.TYPES.forEach((t) => { tot[t] = sum(u[t]); });
          const first = u.active.indexOf(1), last = u.active.lastIndexOf(1);
          return { ...u, tot, first, last };
        }).sort((a, b) => b.tot.visits - a.tot.visits);
        return { gran, buckets, users: list, byName: new Map(list.map((u) => [u.name, u])) };
      });
    },

    /** Usage rate and usage days per user per bucket (no Day granularity: Week is used instead). */
    async rateSeries(range, gran) {
      const g = gran === 'Day' ? 'Week' : gran;
      const rows = await UA.csv('users', 'usageRate/timeSeries/download', { granularity: g }, range);
      const { buckets, index } = this._buckets(range, g);
      const users = new Map();
      for (const r of rows) {
        const i = this._bucketOf(r, index, g);
        if (!r.User || i === undefined) continue;
        let u = users.get(r.User);
        if (!u) { u = { rate: new Array(buckets.length).fill(''), days: new Array(buckets.length).fill(0) }; users.set(r.User, u); }
        u.rate[i] = r['Usage Rate'] || u.rate[i];
        u.days[i] += Number(r['Usage Days']) || 0;
      }
      return { gran: g, adjusted: g !== gran, buckets, users };
    },

    /** Retention category (Acquired / Retained / Returning) per user per bucket. */
    async retentionSeries(range, gran) {
      const rows = await UA.csv('users', 'userRetention/timeSeries/download', { granularity: gran }, range);
      const { buckets, index } = this._buckets(range, gran);
      const users = new Map();
      for (const r of rows) {
        const i = this._bucketOf(r, index, gran);
        if (!r.User || i === undefined) continue;
        if (!users.has(r.User)) users.set(r.User, new Array(buckets.length).fill(''));
        if (r.Category) users.get(r.User)[i] = r.Category;
      }
      return { buckets, users };
    },

    /**
     * Map display names (as used by the Usage Analytics downloads) to Collibra user IDs:
     * first via the top-users list (ID + full name), then via the REST user search.
     */
    async resolveUsers(names, range = State.range()) {
      const out = new Map();
      const top = await this.userTop(100, range).catch(soft);
      for (const t of top || []) if (names.includes(t.name) && isUuid(t.id)) out.set(t.name, t.id);
      await Promise.all(names.filter((n) => !out.has(n)).map(async (n) => {
        const parts = n.split(/\s+/).filter(Boolean);
        try {
          const r = await Api.get('/rest/2.0/users', { name: parts[parts.length - 1] || n, limit: 50, includeDisabled: true });
          const hit = (r.results || []).find((u) => [u.firstName, u.lastName].filter(Boolean).join(' ') === n || u.userName === n);
          if (hit) out.set(n, hit.id);
        } catch (e) { if (isAbort(e)) throw e; }
      }));
      return out;
    },

    /** Audit-trail events in a range for one user (performedByUserId) or one resource (contextId). */
    activitiesFor(filter, range, cap = 5000) {
      const params = {
        ...filter,
        startDate: Date.parse(`${range.startDate}T00:00:00`),
        endDate: Date.parse(`${addDays(range.endDate, 1)}T00:00:00`) - 1,
      };
      return Api.cached(`act:${JSON.stringify(params)}:${cap}`, () => Api.paged('/rest/2.0/activities', params, { pageSize: 1000, max: cap })
        .then((r) => ({ events: r.results.map(normActivity), capped: r.capped })));
    },

    /** Bucket a list of { date } records into per-bucket counts. */
    countByBucket(records, range, gran) {
      const { buckets, index } = this._buckets(range, gran);
      const values = new Array(buckets.length).fill(0);
      for (const x of records) {
        if (!x.date || x.date < range.startDate || x.date > range.endDate) continue;
        const i = index.get(bucketStart(x.date, gran));
        if (i !== undefined) values[i]++;
      }
      return values;
    },

    /** Total assets per asset type (exact type, no inheritance) for the given type IDs. */
    async assetTypeTotals(types) {
      const out = new Map();
      await Promise.all(types.filter((t) => isUuid(t.id)).map(async (t) => {
        try {
          const r = await Api.get('/rest/2.0/assets', { typeIds: t.id, typeInheritance: false, limit: 1, countLimit: -1 });
          out.set(t.label, r.total ?? null);
        } catch (e) { if (isAbort(e)) throw e; out.set(t.label, null); }
      }));
      return out;
    },

    /** Total assets per community ID. */
    async communityTotals(ids) {
      const out = new Map();
      await Promise.all(uniq(ids).filter(isUuid).map(async (id) => {
        try {
          const r = await Api.get('/rest/2.0/assets', { communityId: id, limit: 1, countLimit: -1 });
          out.set(id, r.total ?? null);
        } catch (e) { if (isAbort(e)) throw e; out.set(id, null); }
      }));
      return out;
    },

    async usageRateDetail(range, gran) {
      const g = gran === 'Day' ? 'Week' : gran;
      const rows = await UA.csv('users', 'usageRate/timeSeries/download', { granularity: g }, range);
      const m = new Map();
      for (const r of rows) {
        let u = m.get(r.User);
        if (!u) { u = { name: r.User, days: 0, latest: '', latestStart: '', rates: new Set() }; m.set(r.User, u); }
        u.days += Number(r['Usage Days']) || 0;
        if (r['Usage Rate']) u.rates.add(r['Usage Rate']);
        if ((r['Interval Start Date'] || '') >= u.latestStart) { u.latestStart = r['Interval Start Date'] || ''; u.latest = r['Usage Rate'] || ''; }
      }
      return m;
    },

    async retentionDetail(range, gran) {
      const rows = await UA.csv('users', 'userRetention/timeSeries/download', { granularity: gran }, range);
      const m = new Map();
      for (const r of rows) {
        let u = m.get(r.User);
        if (!u) { u = { name: r.User, cats: new Set() }; m.set(r.User, u); }
        if (r.Category) u.cats.add(r.Category);
      }
      return m;
    },

    async assetSummary(id) { return Api.get(`${UA.USAGE}/assets/${id}/summary`); },
    async assetTrend(id, range, gran) {
      const r = await UA.get('usage', `assets/${id}/visits/timeseries`, { granularity: gran }, range);
      return pivot(r.results, null, gran, range, ['count']);
    },
    async assetVisitors(id, range, limit = 15) {
      const r = await UA.get('usage', `assets/${id}/visitors/top`, { limit: clamp(limit, 1, 100) }, range);
      const rows = r.results || [];
      const names = await this.userNames(rows.map((v) => v.userId));
      return rows.map((v, i) => ({ rank: i + 1, id: v.userId, name: names.get(v.userId)?.name || '(unknown user)', visits: Number(v.visits) || 0 }));
    },

    /** Asset type / status / domain / community for many assets: GraphQL in batches, REST fallback. */
    async assetContext(ids) {
      const out = new Map();
      const list = uniq(ids).filter(isUuid);
      const toCtx = (a) => ({
        id: a.id,
        name: a.displayName || a.name || '',
        type: a.type?.name || '',
        status: a.status?.name || '',
        domain: a.domain?.name || '',
        domainId: a.domain?.id || '',
        community: a.domain?.parent?.name || '',
        communityId: a.domain?.parent?.id || '',
        modifiedOn: typeof a.modifiedOn === 'number' ? a.modifiedOn : a.lastModifiedOn || (a.modifiedOn ? Date.parse(a.modifiedOn) : null),
      });
      await Promise.all(chunk(list, 100).map(async (batch) => {
        if (Env.caps.graphql) {
          try {
            const d = await Api.gql(`{ assets(limit: ${batch.length}, where: { id: { in: ${JSON.stringify(batch)} } }) {
              id displayName modifiedOn type { name } status { name } domain { id name parent { id name } } } }`);
            for (const a of d.assets || []) out.set(a.id, toCtx(a));
            return;
          } catch (e) {
            if (e.name === 'AbortError') throw e;
            Env.caps.graphql = false;
          }
        }
        await Promise.all(batch.map(async (id) => {
          try { out.set(id, toCtx(await Api.get(`/rest/2.0/assets/${id}`))); } catch (e) { if (e.name === 'AbortError') throw e; }
        }));
      }));
      return out;
    },

    async assetDetails(id) {
      if (Env.caps.graphql) {
        try {
          const d = await Api.gql(`{ assets(limit: 1, where: { id: { eq: "${id}" } }) {
            id displayName fullName createdOn modifiedOn type { name } status { name }
            domain { id name parent { id name } } } }`);
          const a = (d.assets || [])[0];
          if (a) return { ...a, name: a.displayName, community: a.domain?.parent || null };
        } catch (e) {
          if (e.name === 'AbortError') throw e;
          Env.caps.graphql = false;
        }
      }
      const a = await Api.get(`/rest/2.0/assets/${id}`);
      return { ...a, name: a.displayName || a.name, createdOn: a.createdOn, modifiedOn: a.lastModifiedOn, community: null };
    },

    async searchAssets(q) {
      if (Env.caps.graphql) {
        try {
          const d = await Api.gql(`query($q: String!) { assets(limit: 15, where: { displayName: { contains: $q } }) {
            id displayName type { name } domain { name parent { name } } } }`, { q });
          return (d.assets || []).map((a) => ({ id: a.id, name: a.displayName, type: a.type?.name, domain: a.domain?.name, community: a.domain?.parent?.name }));
        } catch (e) {
          if (e.name === 'AbortError') throw e;
        }
      }
      const r = await Api.get('/rest/2.0/assets', { name: q, nameMatchMode: 'ANYWHERE', limit: 15 });
      return (r.results || []).map((a) => ({ id: a.id, name: a.displayName || a.name, type: a.type?.name, domain: a.domain?.name }));
    },

    async userNames(ids) {
      const out = new Map();
      await Promise.all(uniq(ids).filter(isUuid).map(async (id) => {
        try {
          const u = await Api.get(`/rest/2.0/users/${id}`);
          out.set(id, { name: [u.firstName, u.lastName].filter(Boolean).join(' ') || u.userName, userName: u.userName });
        } catch (e) {
          if (e.name === 'AbortError') throw e;
          out.set(id, null);
        }
      }));
      return out;
    },

    async catalogTotals() {
      const total = (path, params) => Api.get(path, { limit: 1, countLimit: -1, ...params }).then((r) => r.total).catch((e) => { if (e.name === 'AbortError') throw e; return null; });
      const [assets, domains, communities, users] = await Promise.all([
        total('/rest/2.0/assets'), total('/rest/2.0/domains'), total('/rest/2.0/communities'), total('/rest/2.0/users', { includeDisabled: false }),
      ]);
      return { assets, domains, communities, users };
    },

    async filterList(kind, range) {
      if (kind === 'licenseTypes') {
        const r = await Api.get(`${UA.USAGE}/licenseTypes/list`);
        return (r.results || []).map((x) => ({ id: x.label, label: x.label }));
      }
      const out = [];
      for (let offset = 0; offset < 3000; offset += 100) {
        const r = await Api.get(`${UA.USAGE}/${kind}/list`, { startDate: range.startDate, endDate: range.endDate, limit: 100, offset });
        const page = r.results || [];
        out.push(...page.map((x) => ({ id: x.id, label: x.label, meta: x.organizationType || '' })));
        if (page.length < 100) break;
      }
      return out.sort((a, b) => a.label.localeCompare(b.label));
    },

    /** Paged audit trail for a date range; shared between widgets with progress listeners. */
    activities(range, cap, onProgress) {
      const key = `${range.startDate}|${range.endDate}|${cap}`;
      let entry = this.activityCache.get(key);
      if (!entry) {
        entry = { listeners: new Set(), loaded: 0, promise: null };
        const params = {
          startDate: Date.parse(`${range.startDate}T00:00:00`),
          endDate: Date.parse(`${addDays(range.endDate, 1)}T00:00:00`) - 1,
        };
        entry.promise = Api.paged('/rest/2.0/activities', params, {
          pageSize: 1000,
          max: cap,
          onPage: (n) => { entry.loaded = n; entry.listeners.forEach((fn) => fn(n, cap)); },
        }).then((r) => ({ events: r.results.map(normActivity), capped: r.capped }));
        entry.promise.catch(() => this.activityCache.delete(key));
        this.activityCache.set(key, entry);
      }
      if (onProgress) { entry.listeners.add(onProgress); onProgress(entry.loaded, cap); }
      return entry.promise;
    },

    ratings() {
      return Api.cached('ratings:all', () => Api.paged('/rest/2.0/ratings', {}, { pageSize: 1000, max: 50000 }).then((r) => r.results.map((x) => ({
        id: x.id,
        assetId: x.asset?.id || '',
        asset: decodeEntities(x.asset?.name || ''),
        stars: Math.round((Number(x.rating) || 0) * 5 * 10) / 10,
        review: stripHtml(x.review || '').trim(),
        userId: x.createdBy,
        createdOn: x.createdOn,
        date: localIsoOfMs(x.createdOn),
      }))));
    },

    mostViewed(n) {
      return Api.cached(`nav:most:${n}`, () => Api.paged('/rest/2.0/navigation/most_viewed', {}, { pageSize: 1000, max: n }));
    },
    recentlyViewed(n = 12) { return Api.get('/rest/2.0/navigation/recently_viewed', { limit: n }); },
  };

  /* ────────────────────────────────────────────────────────────────────────
     UI primitives: toasts, tooltip, menus, modal, banner
     ──────────────────────────────────────────────────────────────────────── */

  function toast(msg, kind = '') {
    const el = h('div', { class: `toast ${kind}`, role: kind === 'error' ? 'alert' : 'status' }, msg);
    $('#toasts').append(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 320); }, kind === 'error' ? 6000 : 3200);
  }

  const Tip = {
    el: null,
    show(evt, html) {
      const el = this.el || (this.el = $('#tooltip'));
      el.innerHTML = html;
      el.hidden = false;
      const pad = 14;
      const { innerWidth: W, innerHeight: H } = window;
      const r = el.getBoundingClientRect();
      let x = evt.clientX + pad, y = evt.clientY + pad;
      if (x + r.width > W - 8) x = evt.clientX - r.width - pad;
      if (y + r.height > H - 8) y = evt.clientY - r.height - pad;
      el.style.left = `${Math.max(8, x)}px`;
      el.style.top = `${Math.max(8, y)}px`;
    },
    hide() { if (this.el) this.el.hidden = true; },
  };

  function ttRow(color, label, value) {
    return `<div class="tt-row">${color ? `<span class="sw" style="background:${color}"></span>` : ''}<span>${esc(label)}</span><span class="v">${esc(value)}</span></div>`;
  }

  const Menus = {
    open: null,
    toggle(btn, menu, onOpen) {
      if (this.open && this.open.menu === menu) { this.close(); return; }
      this.close();
      if (onOpen) onOpen(menu);
      menu.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      this.open = { btn, menu };
      const first = menu.querySelector('input, button:not([disabled])');
      if (first) setTimeout(() => first.focus(), 0);
    },
    close() {
      if (!this.open) return;
      this.open.menu.hidden = true;
      this.open.btn.setAttribute('aria-expanded', 'false');
      if (this.open.menu.dataset.temp) this.open.menu.remove();
      this.open = null;
    },
    /** Floating menu attached to a button (created on demand). */
    popup(btn, items, { right = true, className = '' } = {}) {
      const wrap = btn.closest('.menu-wrap') || btn.parentElement;
      if (this.open && this.open.btn === btn) { this.close(); return; }
      const menu = h('div', { class: `menu ${right ? 'menu-right' : ''} ${className}`, role: 'menu', dataset: { temp: '1' } });
      for (const it of items) {
        if (it === '-') menu.append(h('div', { class: 'menu-sep' }));
        else if (it.label && !it.onClick) menu.append(h('div', { class: 'menu-label' }, it.label));
        else menu.append(h('button', { type: 'button', role: 'menuitem', disabled: it.disabled, onclick: () => { this.close(); it.onClick(); } }, it.text));
      }
      if (getComputedStyle(wrap).position === 'static') wrap.style.position = 'relative';
      wrap.append(menu);
      this.close();
      menu.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      this.open = { btn, menu };
    },
  };

  document.addEventListener('mousedown', (e) => {
    if (Menus.open && !Menus.open.menu.contains(e.target) && !Menus.open.btn.contains(e.target)) Menus.close();
  });

  const Modal = {
    show(title, body) {
      $('#modal-title').textContent = title;
      const b = $('#modal-body');
      b.replaceChildren(body);
      $('#modal').hidden = false;
      setTimeout(() => $('#modal [data-close]').focus(), 0);
    },
    hide() { $('#modal').hidden = true; },
  };

  const Banner = {
    show(html, kind = '', actions = []) {
      const el = $('#banner');
      el.className = `banner ${kind}`;
      el.replaceChildren(h('div', { class: 'grow', html }), ...actions);
      el.hidden = false;
    },
    hide() { $('#banner').hidden = true; },
  };

  /* ────────────────────────────────────────────────────────────────────────
     Theme (chart colours are read from CSS tokens so exports are self-contained)
     ──────────────────────────────────────────────────────────────────────── */

  const Theme = {
    vars: {},
    palette: [],
    heat: [],
    font: 'sans-serif',
    refresh(from = document.documentElement) {
      const cs = getComputedStyle(from);
      const names = ['--text', '--text-2', '--text-3', '--grid', '--axis', '--bg', '--bg-elev', '--bg-sunken', '--border', '--brand', '--brand-soft', '--good', '--bad', '--warn', '--accent'];
      for (const n of names) this.vars[n] = cs.getPropertyValue(n).trim();
      this.palette = Array.from({ length: 10 }, (_, i) => cs.getPropertyValue(`--c${i + 1}`).trim());
      this.heat = Array.from({ length: 6 }, (_, i) => cs.getPropertyValue(`--heat-${i}`).trim());
      this.font = getComputedStyle(document.body).fontFamily || 'sans-serif';
    },
    v(n) { return this.vars[n]; },
    set(mode) {
      document.documentElement.setAttribute('data-theme', mode);
      try { localStorage.setItem(`${STORE}theme`, mode); } catch { /* ignore */ }
      this.refresh();
    },
    current() { return document.documentElement.getAttribute('data-theme') || 'light'; },
    /** Run fn with light-theme colours (for print/PDF) without restyling the page. */
    withLight(fn) {
      if (this.current() === 'light') return fn();
      const probe = h('div', { 'data-theme': 'light', style: { display: 'none' } });
      document.body.append(probe);
      try { this.refresh(probe); return fn(); } finally { probe.remove(); this.refresh(); }
    },
  };

  const FIXED_COLORS = {
    Asset: 1, Domain: 2, Community: 3, Dashboard: 4, Diagram: 5,
    High: 6, Medium: 8, Low: 3,
    Acquired: 1, Retained: 6, Returning: 4,
    ADD: 6, UPDATE: 1, DELETE: 5,
    MANUAL: 1, IMPORT: 3, WORKFLOW: 4,
    Active: 1, Inactive: 3, New: 6,
  };
  function colorFor(name, i = 0) {
    const idx = FIXED_COLORS[name];
    return idx ? Theme.palette[idx - 1] : Theme.palette[i % Theme.palette.length];
  }

  const measureCtx = document.createElement('canvas').getContext('2d');
  function textW(str, size = 12, weight = 400) {
    measureCtx.font = `${weight} ${size}px ${Theme.font}`;
    return measureCtx.measureText(String(str)).width;
  }
  function truncate(str, maxW, size = 12, weight = 400) {
    str = String(str ?? '');
    if (maxW <= 12) return '';
    if (textW(str, size, weight) <= maxW) return str;
    let lo = 0, hi = str.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (textW(`${str.slice(0, mid)}…`, size, weight) <= maxW) lo = mid; else hi = mid - 1;
    }
    return `${str.slice(0, lo)}…`;
  }

  function niceTicks(max, integer = true, count = 5) {
    if (!(max > 0)) max = integer ? 4 : 1;
    const raw = max / count;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const norm = raw / mag;
    let step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
    if (integer) step = Math.max(1, Math.round(step));
    const top = Math.ceil(max / step - 1e-9) * step;
    const ticks = [];
    for (let v = 0; v <= top + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
    return ticks;
  }

  function svgText(x, y, str, { size = 11, fill, anchor = 'start', weight, cls } = {}) {
    return s('text', { x, y, 'font-size': size, fill: fill || Theme.v('--text-3'), 'text-anchor': anchor, 'font-weight': weight, class: cls, text: str });
  }

  /** Map a mouse event to SVG user-space x (handles CSS scaling). */
  function svgX(svg, e, W) {
    const r = svg.getBoundingClientRect();
    return (e.clientX - r.left) * (W / r.width);
  }

  function linePath(points) {
    let d = '';
    let pen = false;
    for (const p of points) {
      if (p == null || p[1] == null || Number.isNaN(p[1])) { pen = false; continue; }
      d += `${pen ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`;
      pen = true;
    }
    return d;
  }

  /** In-SVG legend; returns its height. Click/Enter toggles a series. */
  function drawLegend(svg, items, W, y0, onToggle) {
    const g = s('g', { class: 'legend' });
    let x = 0, y = y0;
    const rowH = 18, sw = 10, gap = 16;
    for (const it of items) {
      const w = sw + 6 + textW(it.name, 12);
      if (x + w > W && x > 0) { x = 0; y += rowH; }
      const item = s('g', {
        class: `chart-legend-item${it.off ? ' off' : ''}`,
        opacity: it.off ? 0.35 : null,
        transform: `translate(${x},${y})`,
        tabindex: onToggle ? 0 : null,
        role: onToggle ? 'button' : null,
        'aria-pressed': onToggle ? String(!it.off) : null,
        'aria-label': onToggle ? `Toggle ${it.name}` : null,
      });
      item.append(
        it.dashed
          ? s('line', { x1: 0, y1: 5, x2: sw, y2: 5, stroke: it.color, 'stroke-width': 2, 'stroke-dasharray': '3 2' })
          : s('rect', { x: 0, y: 0, width: sw, height: sw, rx: 2, fill: it.color }),
        svgText(sw + 6, 9.5, it.name, { size: 12, fill: Theme.v('--text-2') }),
      );
      if (onToggle) {
        item.addEventListener('click', () => onToggle(it));
        item.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(it); } });
      }
      g.append(item);
      x += w + gap;
    }
    svg.append(g);
    return y - y0 + rowH;
  }

  function emptyMessage(svg, x, y, text) {
    svg.append(svgText(x, y, text, { size: 13, anchor: 'middle', fill: Theme.v('--text-3') }));
  }

  /* ── Series chart: line / area / bar, stacked or grouped, overlays ───── */

  function seriesChart(W, spec) {
    const H = spec.height || 300;
    const svg = s('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}` });
    const cats = spec.categories || [];
    const n = cats.length;
    spec.hidden = spec.hidden || new Set();
    const vis = spec.series.filter((se) => !spec.hidden.has(se.name));
    const main = vis.filter((se) => !se.overlay && !se.y2);
    const overlays = vis.filter((se) => se.overlay && !se.y2);
    const right2 = vis.filter((se) => se.y2);
    const mode = spec.mode || 'line';
    const stacked = !!spec.stacked && mode !== 'line' && main.length > 1;
    const fmtY = spec.yFormat || fmtC;
    const fmtV = spec.valueFormat || fmtN;

    let top = 6;
    if (spec.legend !== false && (spec.series.length > 1 || spec.legend === 'always')) {
      top = drawLegend(svg, spec.series.map((se) => ({ name: se.name, color: se.color, dashed: se.dashed, off: spec.hidden.has(se.name) })), W, 0, (it) => {
        if (spec.hidden.has(it.name)) spec.hidden.delete(it.name); else spec.hidden.add(it.name);
        if (spec.__redraw) spec.__redraw();
      }) + 14;
    }

    let maxV = 0;
    for (let i = 0; i < n; i++) {
      if (stacked) maxV = Math.max(maxV, sum(main, (se) => se.values[i]));
      else main.forEach((se) => { maxV = Math.max(maxV, se.values[i] || 0); });
      overlays.forEach((se) => { maxV = Math.max(maxV, se.values[i] || 0); });
    }
    const ticks = niceTicks(maxV, spec.integer !== false);
    const yMax = ticks[ticks.length - 1] || 1;
    // Optional secondary (right) axis for series flagged y2, e.g. counts or % next to visits.
    let maxV2 = 0;
    right2.forEach((se) => se.values.forEach((v) => { maxV2 = Math.max(maxV2, v || 0); }));
    const fmtY2 = spec.y2Format || fmtC;
    const ticks2 = right2.length ? niceTicks(maxV2, spec.y2Integer !== false, ticks.length - 1) : [];
    const yMax2 = ticks2[ticks2.length - 1] || 1;
    const left = Math.max(...ticks.map((t) => textW(fmtY(t), 11))) + 14;
    const right = right2.length ? Math.max(...ticks2.map((t) => textW(fmtY2(t), 11))) + 16 : 12;
    const bottom = 26;
    const pw = Math.max(10, W - left - right), ph = Math.max(10, H - top - bottom);
    const band = pw / Math.max(n, 1);
    const xC = (i) => left + band * (i + 0.5);
    const y = (v) => top + ph - (v / yMax) * ph;
    const yR = (v) => top + ph - (v / yMax2) * ph;

    const grid = s('g');
    for (const t of ticks) {
      grid.append(s('line', { x1: left, x2: W - right, y1: y(t), y2: y(t), stroke: Theme.v('--grid'), 'stroke-width': 1 }));
      grid.append(svgText(left - 8, y(t) + 4, fmtY(t), { anchor: 'end' }));
    }
    for (const t of ticks2) grid.append(svgText(W - right + 8, yR(t) + 4, fmtY2(t), { fill: right2[0].color }));
    svg.append(grid);

    const maxLab = Math.max(10, ...cats.map((c) => textW(c.label, 11)));
    const step = Math.max(1, Math.ceil((maxLab + 12) / band));
    cats.forEach((c, i) => {
      if (i % step !== 0) return;
      svg.append(svgText(xC(i), H - 8, truncate(c.label, band * step - 4, 11), { anchor: 'middle' }));
    });

    const plot = s('g');
    if (mode === 'bar') {
      const bw = Math.max(1, Math.min(band * 0.74, 56));
      if (stacked) {
        for (let i = 0; i < n; i++) {
          let acc = 0;
          main.forEach((se, k) => {
            const v = se.values[i] || 0;
            if (!v) return;
            const y1 = y(acc + v), y0 = y(acc);
            plot.append(s('rect', { x: xC(i) - bw / 2, y: y1, width: bw, height: Math.max(0.5, y0 - y1), fill: se.color, rx: k === main.length - 1 ? 2 : 0 }));
            acc += v;
          });
        }
      } else {
        const sub = bw / Math.max(main.length, 1);
        main.forEach((se, k) => {
          for (let i = 0; i < n; i++) {
            const v = se.values[i] || 0;
            if (!v) continue;
            plot.append(s('rect', { x: xC(i) - bw / 2 + k * sub, y: y(v), width: Math.max(1, sub - (main.length > 1 ? 1 : 0)), height: Math.max(0.5, y(0) - y(v)), fill: se.color, rx: 2 }));
          }
        });
      }
    } else if (stacked) {
      let lower = new Array(n).fill(0);
      for (const se of main) {
        const upper = lower.map((l, i) => l + (se.values[i] || 0));
        const fwd = upper.map((v, i) => `${xC(i).toFixed(1)},${y(v).toFixed(1)}`);
        const back = lower.map((v, i) => `${xC(i).toFixed(1)},${y(v).toFixed(1)}`).reverse();
        plot.append(s('polygon', { points: [...fwd, ...back].join(' '), fill: se.color, 'fill-opacity': 0.72 }));
        plot.append(s('path', { d: linePath(upper.map((v, i) => [xC(i), y(v)])), fill: 'none', stroke: se.color, 'stroke-width': 1.5 }));
        lower = upper;
      }
    } else {
      for (const se of main) {
        const pts = se.values.map((v, i) => [xC(i), v == null ? null : y(v)]);
        if (mode === 'area' && n > 1) {
          const d = `${linePath(pts)}L${xC(n - 1).toFixed(1)},${y(0).toFixed(1)}L${xC(0).toFixed(1)},${y(0).toFixed(1)}Z`;
          plot.append(s('path', { d, fill: se.color, 'fill-opacity': 0.16 }));
        }
        plot.append(s('path', { d: linePath(pts), fill: 'none', stroke: se.color, 'stroke-width': 2.2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
        if (n <= 45) pts.forEach((p) => { if (p[1] != null) plot.append(s('circle', { cx: p[0], cy: p[1], r: n === 1 ? 4 : 2.6, fill: se.color })); });
      }
    }
    for (const se of [...overlays, ...right2]) {
      const yy = se.y2 ? yR : y;
      const pts = se.values.map((v, i) => [xC(i), v == null ? null : yy(v)]);
      plot.append(s('path', { d: linePath(pts), fill: 'none', stroke: se.color, 'stroke-width': 2, 'stroke-dasharray': se.dashed ? '5 4' : null, 'stroke-linejoin': 'round' }));
      if (se.y2 && n <= 45) pts.forEach((p) => { if (p[1] != null) plot.append(s('circle', { cx: p[0], cy: p[1], r: 2.4, fill: se.color })); });
    }
    svg.append(plot);
    svg.append(s('line', { x1: left, x2: W - right, y1: y(0), y2: y(0), stroke: Theme.v('--axis'), 'stroke-width': 1 }));

    if (maxV === 0 && spec.emptyText !== false) emptyMessage(svg, left + pw / 2, top + ph / 2, spec.emptyText || 'No activity in this period');

    const cross = s('line', { y1: top, y2: top + ph, stroke: Theme.v('--axis'), 'stroke-dasharray': '3 3', visibility: 'hidden', 'pointer-events': 'none' });
    svg.append(cross);
    const hit = s('rect', { x: left, y: top, width: pw, height: ph, fill: 'transparent', class: spec.onClick ? 'chart-hit' : null });
    hit.addEventListener('mousemove', (e) => {
      if (!n) return;
      const i = clamp(Math.floor((svgX(svg, e, W) - left) / band), 0, n - 1);
      cross.setAttribute('x1', xC(i));
      cross.setAttribute('x2', xC(i));
      cross.setAttribute('visibility', 'visible');
      const fv = (se, v) => (se.format || fmtV)(v);
      const rows = (stacked ? [...main].reverse() : main).map((se) => ttRow(se.color, se.name, fv(se, se.values[i] ?? 0)));
      let html = `<div class="tt-title">${esc(cats[i].full || cats[i].label)}</div>${rows.join('')}`;
      if (stacked) html += `<div class="tt-sep"></div>${ttRow('', 'Total', fmtV(sum(main, (se) => se.values[i])))}`;
      const extra = [...overlays, ...right2];
      if (extra.length) html += `<div class="tt-sep"></div>${extra.map((se) => ttRow(se.color, se.name, se.values[i] == null ? '–' : fv(se, se.values[i]))).join('')}`;
      if (spec.tipExtra) html += spec.tipExtra(i);
      Tip.show(e, html);
    });
    hit.addEventListener('mouseleave', () => { cross.setAttribute('visibility', 'hidden'); Tip.hide(); });
    if (spec.onClick) hit.addEventListener('click', (e) => spec.onClick(clamp(Math.floor((svgX(svg, e, W) - left) / band), 0, n - 1)));
    svg.append(hit);
    return svg;
  }

  /* ── Horizontal bar list ─────────────────────────────────────────────── */

  function hbarChart(W, spec) {
    const items = spec.items || [];
    const rowH = spec.rowH || 28;
    const H = Math.max(40, items.length * rowH + 6);
    const svg = s('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}` });
    if (!items.length) { emptyMessage(svg, W / 2, H / 2 + 4, spec.emptyText || 'No data'); return svg; }
    const fmtV = spec.valueFormat || fmtN;
    const labelW = Math.min(W * 0.42, Math.max(...items.map((i) => textW(i.label, 12))) + 6);
    const valW = Math.max(...items.map((i) => textW(fmtV(i.value), 12, 600))) + 12;
    const barX = labelW + 10;
    const barMax = Math.max(10, W - barX - valW);
    const max = Math.max(...items.map((i) => i.value), 1e-9);
    items.forEach((it, k) => {
      const y0 = k * rowH + 3;
      const color = it.color || spec.color || Theme.palette[0];
      const g = s('g', { class: it.onClick || spec.onClick ? 'chart-hit' : null });
      g.append(
        s('rect', { x: 0, y: y0, width: W, height: rowH - 2, fill: 'transparent' }),
        svgText(0, y0 + rowH / 2 + 3, truncate(it.label, labelW, 12), { size: 12, fill: Theme.v('--text') }),
        s('rect', { x: barX, y: y0 + 6, width: barMax, height: rowH - 14, rx: 4, fill: Theme.v('--bg-sunken') }),
        s('rect', { x: barX, y: y0 + 6, width: Math.max(it.value > 0 ? 2 : 0, (it.value / max) * barMax), height: rowH - 14, rx: 4, fill: color }),
        svgText(barX + (it.value / max) * barMax + 6, y0 + rowH / 2 + 3, fmtV(it.value), { size: 12, weight: 600, fill: Theme.v('--text-2') }),
      );
      g.addEventListener('mousemove', (e) => Tip.show(e, `<div class="tt-title">${esc(it.label)}</div>${ttRow(color, spec.valueLabel || 'Value', fmtV(it.value))}${it.sub ? `<div class="tt-sub">${esc(it.sub)}</div>` : ''}`));
      g.addEventListener('mouseleave', () => Tip.hide());
      const click = it.onClick || (spec.onClick && (() => spec.onClick(it, k)));
      if (click) g.addEventListener('click', click);
      svg.append(g);
    });
    return svg;
  }

  /* ── Donut ───────────────────────────────────────────────────────────── */

  function arcPath(cx, cy, R, r, a0, a1) {
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (rad, a) => `${(cx + rad * Math.cos(a)).toFixed(2)},${(cy + rad * Math.sin(a)).toFixed(2)}`;
    return `M${p(R, a0)}A${R},${R} 0 ${large} 1 ${p(R, a1)}L${p(r, a1)}A${r},${r} 0 ${large} 0 ${p(r, a0)}Z`;
  }

  function donutChart(W, spec) {
    const items = (spec.items || []).filter((i) => i.value > 0);
    const total = sum(items, (i) => i.value);
    const fmtV = spec.valueFormat || fmtN;
    const side = W >= 380;
    const baseH = spec.height || 240;
    const legendH = side ? 0 : items.length * 20 + 10;
    const H = baseH + legendH;
    const svg = s('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}` });
    const R = Math.max(30, Math.min(side ? W * 0.24 : W / 2 - 10, baseH / 2 - 8));
    const r = R * 0.62;
    const cx = side ? R + 8 : W / 2, cy = baseH / 2;
    if (!total) {
      svg.append(s('circle', { cx, cy, r: (R + r) / 2, fill: 'none', stroke: Theme.v('--bg-sunken'), 'stroke-width': R - r }));
      svg.append(svgText(cx, cy + 4, spec.emptyText || 'No data', { size: 12, anchor: 'middle' }));
      return svg;
    }
    let a = -Math.PI / 2;
    items.forEach((it, i) => {
      const color = it.color || colorFor(it.label, i);
      const frac = it.value / total;
      const a1 = a + frac * Math.PI * 2;
      const el = frac >= 0.9999
        ? s('circle', { cx, cy, r: (R + r) / 2, fill: 'none', stroke: color, 'stroke-width': R - r })
        : s('path', { d: arcPath(cx, cy, R, r, a, a1), fill: color, stroke: Theme.v('--bg-elev'), 'stroke-width': 1.5 });
      el.setAttribute('class', spec.onClick ? 'chart-hit' : '');
      el.addEventListener('mousemove', (e) => Tip.show(e, `<div class="tt-title">${esc(it.label)}</div>${ttRow(color, spec.valueLabel || 'Value', fmtV(it.value))}${ttRow('', 'Share', fmtPct(frac * 100))}`));
      el.addEventListener('mouseleave', () => Tip.hide());
      if (spec.onClick) el.addEventListener('click', () => spec.onClick(it));
      svg.append(el);
      a = a1;
    });
    svg.append(svgText(cx, cy + 2, fmtC(total), { size: Math.max(14, Math.min(24, r / 2.2)), weight: 700, anchor: 'middle', fill: Theme.v('--text') }));
    svg.append(svgText(cx, cy + 18, spec.centerLabel || 'Total', { size: 11, anchor: 'middle' }));

    const lx = side ? cx + R + 24 : 8;
    let ly = side ? Math.max(10, cy - (items.length * 22) / 2) : baseH + 6;
    const lw = W - lx - 4;
    items.forEach((it, i) => {
      const color = it.color || colorFor(it.label, i);
      const pct = fmtPct((it.value / total) * 100);
      const vtxt = fmtV(it.value);
      const pw = 46;
      const vw = textW(vtxt, 12, 600);
      svg.append(s('rect', { x: lx, y: ly, width: 10, height: 10, rx: 2, fill: color }));
      svg.append(svgText(lx + 16, ly + 9.5, truncate(it.label, lw - vw - pw - 34, 12), { size: 12, fill: Theme.v('--text-2') }));
      svg.append(svgText(lx + lw - pw - 8, ly + 9.5, vtxt, { size: 12, weight: 600, anchor: 'end', fill: Theme.v('--text') }));
      svg.append(svgText(lx + lw, ly + 9.5, pct, { size: 12, anchor: 'end', fill: Theme.v('--text-3') }));
      ly += side ? 22 : 20;
    });
    return svg;
  }

  /* ── Heatmap ─────────────────────────────────────────────────────────── */

  function heatmapChart(W, spec) {
    const rows = spec.rows, cols = spec.cols, vals = spec.values;
    const leftW = Math.max(...rows.map((r) => textW(r, 11))) + 10;
    const topH = 18;
    const cellW = (W - leftW - 4) / Math.max(cols.length, 1);
    const cellH = spec.cellH || clamp(cellW, 14, 26);
    const H = topH + rows.length * cellH + 34;
    const svg = s('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}` });
    let max = 0;
    vals.forEach((r) => r.forEach((v) => { if (v > max) max = v; }));
    const lvl = (v) => (v == null ? -1 : v <= 0 ? 0 : 1 + Math.min(4, Math.floor((v / max) * 5 - 1e-9)));
    const colStep = Math.max(1, Math.ceil((Math.max(...cols.map((c) => textW(c, 10))) + 8) / cellW));
    cols.forEach((c, j) => { if (j % colStep === 0) svg.append(svgText(leftW + j * cellW + cellW / 2, 12, c, { size: 10, anchor: 'middle' })); });
    rows.forEach((r, i) => {
      svg.append(svgText(leftW - 8, topH + i * cellH + cellH / 2 + 4, r, { anchor: 'end' }));
      cols.forEach((c, j) => {
        const v = vals[i][j];
        const L = lvl(v);
        const rect = s('rect', {
          x: leftW + j * cellW + 1.5, y: topH + i * cellH + 1.5, width: Math.max(1, cellW - 3), height: Math.max(1, cellH - 3), rx: 3,
          fill: L < 0 ? 'transparent' : Theme.heat[L], stroke: L < 0 ? Theme.v('--border') : null, 'stroke-dasharray': L < 0 ? '2 2' : null,
        });
        if (L >= 0) {
          rect.addEventListener('mousemove', (e) => Tip.show(e, spec.cellTip ? spec.cellTip(i, j, v) : `<div class="tt-title">${esc(r)} · ${esc(c)}</div>${ttRow('', 'Value', fmtN(v))}`));
          rect.addEventListener('mouseleave', () => Tip.hide());
        }
        svg.append(rect);
      });
    });
    const ly = H - 14;
    let lx = W - 6 * 16 - 70;
    svg.append(svgText(lx - 6, ly + 9, 'Less', { anchor: 'end', size: 10 }));
    Theme.heat.forEach((c) => { svg.append(s('rect', { x: lx, y: ly, width: 13, height: 11, rx: 2, fill: c })); lx += 16; });
    svg.append(svgText(lx + 2, ly + 9, 'More', { size: 10 }));
    if (!max && spec.emptyText !== false) emptyMessage(svg, W / 2, topH + (rows.length * cellH) / 2 + 4, spec.emptyText || 'No activity in this period');
    return svg;
  }

  /* ── Treemap (squarified) ────────────────────────────────────────────── */

  function squarify(items, x, y, w, h) {
    const out = [];
    const rest = items.slice();
    let row = [];
    const worst = (r, side) => {
      if (!r.length) return Infinity;
      const s2 = sum(r, (i) => i.area);
      const mx = Math.max(...r.map((i) => i.area)), mn = Math.min(...r.map((i) => i.area));
      return Math.max((side * side * mx) / (s2 * s2), (s2 * s2) / (side * side * mn));
    };
    const layout = (r) => {
      const s2 = sum(r, (i) => i.area);
      if (w >= h) {
        const rw = s2 / h;
        let yy = y;
        for (const it of r) { const rh = it.area / rw; out.push({ ...it, x, y: yy, w: rw, h: rh }); yy += rh; }
        x += rw; w -= rw;
      } else {
        const rh = s2 / w;
        let xx = x;
        for (const it of r) { const rw = it.area / rh; out.push({ ...it, x: xx, y, w: rw, h: rh }); xx += rw; }
        y += rh; h -= rh;
      }
    };
    while (rest.length) {
      const side = Math.min(w, h);
      if (!row.length || worst([...row, rest[0]], side) <= worst(row, side)) row.push(rest.shift());
      else { layout(row); row = []; }
    }
    if (row.length) layout(row);
    return out;
  }

  function treemapChart(W, spec) {
    const H = spec.height || 320;
    const svg = s('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}` });
    const items = (spec.items || []).filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
    const total = sum(items, (i) => i.value);
    if (!total) { emptyMessage(svg, W / 2, H / 2, spec.emptyText || 'No data'); return svg; }
    const groups = [...groupBy(items, (i) => i.group || i.label).entries()].sort((a, b) => sum(b[1], (i) => i.value) - sum(a[1], (i) => i.value));
    const gColor = new Map(groups.map(([g], i) => [g, Theme.palette[i % Theme.palette.length]]));
    const scale = (W * H) / total;
    const rects = squarify(items.map((i) => ({ ...i, area: i.value * scale })), 0, 0, W, H);
    const fmtV = spec.valueFormat || fmtN;
    for (const r of rects) {
      const color = r.color || gColor.get(r.group || r.label);
      const g = s('g', { class: spec.onClick ? 'chart-hit' : null });
      g.append(s('rect', { x: r.x, y: r.y, width: Math.max(0, r.w), height: Math.max(0, r.h), fill: color, 'fill-opacity': 0.88, stroke: Theme.v('--bg-elev'), 'stroke-width': 2, rx: 3 }));
      if (r.w > 54 && r.h > 30) {
        g.append(svgText(r.x + 7, r.y + 16, truncate(r.label, r.w - 14, 12, 600), { size: 12, weight: 600, fill: '#fff' }));
        g.append(svgText(r.x + 7, r.y + 30, truncate(`${fmtV(r.value)}${r.group && r.group !== r.label ? ` · ${r.group}` : ''}`, r.w - 14, 11), { size: 11, fill: 'rgba(255,255,255,.85)' }));
      }
      g.addEventListener('mousemove', (e) => Tip.show(e, `<div class="tt-title">${esc(r.label)}</div>${r.group && r.group !== r.label ? `<div class="tt-sub">${esc(r.group)}</div>` : ''}${ttRow(color, spec.valueLabel || 'Value', fmtV(r.value))}${ttRow('', 'Share', fmtPct((r.value / total) * 100))}`));
      g.addEventListener('mouseleave', () => Tip.hide());
      if (spec.onClick) g.addEventListener('click', () => spec.onClick(r));
      svg.append(g);
    }
    return svg;
  }

  /* ── Scatter ─────────────────────────────────────────────────────────── */

  function scatterChart(W, spec) {
    const H = spec.height || 300;
    const svg = s('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}` });
    const pts = spec.points || [];
    if (!pts.length) { emptyMessage(svg, W / 2, H / 2, spec.emptyText || 'No data'); return svg; }
    const maxX = Math.max(...pts.map((p) => p.x), 1);
    const maxY = Math.max(...pts.map((p) => p.y), 1);
    const yTicks = niceTicks(maxY, spec.yInteger !== false);
    const yTop = yTicks[yTicks.length - 1];
    const fx = spec.xLog ? (v) => Math.log10(Math.max(v, 1)) : (v) => v;
    const xTicks = spec.xLog ? Array.from({ length: Math.ceil(Math.log10(maxX)) + 1 }, (_, i) => 10 ** i) : niceTicks(maxX, spec.xInteger !== false);
    const xTop = fx(xTicks[xTicks.length - 1]) || 1;
    const left = Math.max(...yTicks.map((t) => textW(fmtC(t), 11))) + 30;
    const top = 10, right = 14, bottom = 42;
    const pw = W - left - right, ph = H - top - bottom;
    const X = (v) => left + (fx(v) / xTop) * pw;
    const Y = (v) => top + ph - (v / yTop) * ph;
    yTicks.forEach((t) => {
      svg.append(s('line', { x1: left, x2: W - right, y1: Y(t), y2: Y(t), stroke: Theme.v('--grid') }));
      svg.append(svgText(left - 8, Y(t) + 4, fmtC(t), { anchor: 'end' }));
    });
    xTicks.forEach((t) => {
      svg.append(s('line', { x1: X(t), x2: X(t), y1: top, y2: top + ph, stroke: Theme.v('--grid') }));
      svg.append(svgText(X(t), top + ph + 16, fmtC(t), { anchor: 'middle' }));
    });
    if (spec.xLabel) svg.append(svgText(left + pw / 2, H - 6, spec.xLabel, { anchor: 'middle', size: 11, fill: Theme.v('--text-2') }));
    if (spec.yLabel) {
      const t = svgText(0, 0, spec.yLabel, { anchor: 'middle', size: 11, fill: Theme.v('--text-2') });
      t.setAttribute('transform', `translate(12,${top + ph / 2}) rotate(-90)`);
      svg.append(t);
    }
    for (const p of pts) {
      const color = p.color || Theme.palette[0];
      const c = s('circle', { cx: X(p.x), cy: Y(p.y), r: p.r || 5, fill: color, 'fill-opacity': 0.7, stroke: color, class: spec.onClick ? 'chart-hit' : null });
      c.addEventListener('mousemove', (e) => Tip.show(e, `<div class="tt-title">${esc(p.label)}</div>${ttRow('', spec.xName || 'x', fmtN(p.x))}${ttRow('', spec.yName || 'y', fmtN(p.y))}${p.sub ? `<div class="tt-sub">${esc(p.sub)}</div>` : ''}`));
      c.addEventListener('mouseleave', () => Tip.hide());
      if (spec.onClick) c.addEventListener('click', () => spec.onClick(p));
      svg.append(c);
    }
    return svg;
  }

  /* ── Funnel ──────────────────────────────────────────────────────────── */

  function funnelChart(W, spec) {
    const st = spec.stages || [];
    const rowH = 50;
    const H = st.length * rowH + 6;
    const svg = s('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}` });
    const first = st[0]?.value || 0;
    const max = Math.max(...st.map((x) => x.value || 0), 1);
    const labelW = Math.min(190, W * 0.34);
    const area = W - labelW - 12;
    st.forEach((x, i) => {
      const y0 = i * rowH + 4;
      const bw = Math.max(4, ((x.value || 0) / max) * area);
      const color = Theme.palette[i % Theme.palette.length];
      const g = s('g');
      g.append(svgText(0, y0 + 18, truncate(x.label, labelW - 8, 12, 600), { size: 12, weight: 600, fill: Theme.v('--text') }));
      if (x.sub) g.append(svgText(0, y0 + 34, truncate(x.sub, labelW - 8, 11), { size: 11 }));
      g.append(s('rect', { x: labelW + (area - bw) / 2, y: y0 + 4, width: bw, height: rowH - 14, rx: 6, fill: color, 'fill-opacity': 0.9 }));
      const pct = first ? ` · ${fmtPct((x.value / first) * 100, 0)}` : '';
      const txt = `${fmtN(x.value)}${pct}`;
      const inside = textW(txt, 12, 700) + 12 < bw;
      g.append(svgText(labelW + area / 2, y0 + rowH / 2 + 2, txt, { size: 12, weight: 700, anchor: 'middle', fill: inside ? '#fff' : Theme.v('--text') }));
      g.addEventListener('mousemove', (e) => {
        const prev = i > 0 ? st[i - 1].value : null;
        Tip.show(e, `<div class="tt-title">${esc(x.label)}</div>${ttRow(color, 'Users', fmtN(x.value))}${first ? ttRow('', 'Of first stage', fmtPct((x.value / first) * 100)) : ''}${prev ? ttRow('', 'From previous stage', fmtPct((x.value / prev) * 100)) : ''}${x.sub ? `<div class="tt-sub">${esc(x.sub)}</div>` : ''}`);
      });
      g.addEventListener('mouseleave', () => Tip.hide());
      svg.append(g);
    });
    return svg;
  }

  /* ── Small inline visuals ────────────────────────────────────────────── */

  function sparkline(values, color, w = 120, hgt = 34) {
    const svg = s('svg', { width: w, height: hgt, viewBox: `0 0 ${w} ${hgt}`, class: 'kpi-spark', 'aria-hidden': 'true' });
    const vals = values.map((v) => Number(v) || 0);
    if (vals.length < 2) return svg;
    const max = Math.max(...vals, 1);
    const pts = vals.map((v, i) => [(i / (vals.length - 1)) * (w - 4) + 2, hgt - 3 - (v / max) * (hgt - 6)]);
    const d = linePath(pts);
    svg.append(s('path', { d: `${d}L${pts[pts.length - 1][0]},${hgt}L${pts[0][0]},${hgt}Z`, fill: color, 'fill-opacity': 0.14 }));
    svg.append(s('path', { d, fill: 'none', stroke: color, 'stroke-width': 1.8, 'stroke-linejoin': 'round' }));
    const last = pts[pts.length - 1];
    svg.append(s('circle', { cx: last[0], cy: last[1], r: 2.5, fill: color }));
    return svg;
  }

  function ring(pct, color, size = 54) {
    const r = size / 2 - 5;
    const c = 2 * Math.PI * r;
    const p = clamp(pct || 0, 0, 100);
    const svg = s('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}`, class: 'kpi-ring', 'aria-hidden': 'true' });
    svg.append(s('circle', { cx: size / 2, cy: size / 2, r, fill: 'none', stroke: Theme.v('--bg-sunken'), 'stroke-width': 7 }));
    if (p <= 0) return svg;
    svg.append(s('circle', {
      cx: size / 2, cy: size / 2, r, fill: 'none', stroke: color, 'stroke-width': 7, 'stroke-linecap': 'round',
      'stroke-dasharray': `${(p / 100) * c} ${c}`, transform: `rotate(-90 ${size / 2} ${size / 2})`,
    }));
    return svg;
  }

  const Charts = {
    kinds: { series: seriesChart, hbar: hbarChart, donut: donutChart, heatmap: heatmapChart, treemap: treemapChart, scatter: scatterChart, funnel: funnelChart },
    render(host, spec) {
      host.__spec = spec;
      if (!host.__ro && 'ResizeObserver' in window) {
        host.__w = 0;
        host.__ro = new ResizeObserver(debounce(() => {
          const w = host.clientWidth;
          if (w && Math.abs(w - host.__w) > 4 && host.__spec && host.isConnected) Charts.draw(host, host.__spec);
        }, 120));
        host.__ro.observe(host);
      }
      this.draw(host, spec);
    },
    draw(host, spec) {
      const W = Math.max(260, Math.floor(host.clientWidth || 640));
      host.__w = W;
      spec.__redraw = () => Charts.draw(host, spec);
      const svg = this.kinds[spec.kind](W, spec);
      svg.setAttribute('xmlns', SVGNS);
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', spec.title || 'Chart');
      svg.setAttribute('font-family', Theme.font);
      svg.prepend(s('title', { text: spec.title || 'Chart' }));
      host.replaceChildren(svg);
      host.__svg = svg;
      return svg;
    },
  };

  /** Build a table dataset from a series spec (for the table view and data exports). */
  function seriesDataset(spec) {
    const cols = [
      { key: 'period', label: 'Period' },
      { key: 'start', label: 'Start', type: 'date' },
      { key: 'end', label: 'End', type: 'date' },
      ...spec.series.map((se, k) => ({ key: `s${k}`, label: se.name, type: 'number' })),
    ];
    const rows = spec.categories.map((c, i) => {
      const row = { period: c.label, start: c.start, end: c.end };
      spec.series.forEach((se, k) => { row[`s${k}`] = se.values[i] == null ? null : Math.round(se.values[i] * 100) / 100; });
      return row;
    });
    return { columns: cols, rows };
  }

  function catsOf(rows) {
    return rows.map((r) => ({ label: r.label, full: r.full, start: r.startDate, end: r.endDate }));
  }

  /* ────────────────────────────────────────────────────────────────────────
     Data table (sort, search, paginate, column chooser, links, inline bars)
     ──────────────────────────────────────────────────────────────────────── */

  const NUM_TYPES = ['number', 'pct', 'delta', 'stars'];
  const SORT_NUM_TYPES = [...NUM_TYPES, 'datetime'];

  const colValue = (c, r) => (c.value ? c.value(r) : r[c.key]);

  function formatCell(c, v) {
    if (v == null || v === '') return '';
    if (c.format) return c.format(v);
    switch (c.type) {
      case 'number': return fmtN(v);
      case 'pct': return fmtPct(v);
      case 'delta': return `${v > 0 ? '+' : ''}${fmtPct(v)}`;
      case 'date': return fmtDate(v);
      case 'datetime': return fmtDateTime(v);
      case 'stars': return `${fmt1(v)} / 5`;
      default: return Array.isArray(v) ? v.join(', ') : String(v);
    }
  }

  function starsEl(v) {
    const n = Math.round(Number(v) || 0);
    return h('span', { class: 'stars', title: `${fmt1(v)} out of 5` }, '★'.repeat(n), h('span', { class: 'off' }, '★'.repeat(Math.max(0, 5 - n))));
  }

  function DataTable(host, dataset, opts = {}) {
    const cols = dataset.columns;
    const st = {
      q: '',
      sort: opts.sort || null,
      dir: opts.dir || 'desc',
      page: 0,
      size: opts.pageSize || 25,
      hidden: new Set(cols.filter((c) => c.hidden).map((c) => c.key)),
    };
    const maxes = {};
    cols.filter((c) => c.bar).forEach((c) => { maxes[c.key] = Math.max(1e-9, ...dataset.rows.map((r) => Number(colValue(c, r)) || 0)); });

    const root = h('div', { class: 'dt' });
    const search = h('input', { class: 'dt-search', type: 'search', placeholder: opts.searchPlaceholder || 'Search…', 'aria-label': 'Search table' });
    const count = h('span', { class: 'dt-count' });
    const colBtn = h('button', { class: 'btn btn-ghost btn-xs', type: 'button', 'aria-haspopup': 'menu', title: 'Show or hide columns' }, 'Columns');
    colBtn.addEventListener('click', () => Menus.popup(colBtn, [
      { label: 'Visible columns' },
      ...cols.map((c) => ({
        text: `${st.hidden.has(c.key) ? '☐' : '☑'}  ${c.label}`,
        onClick: () => { if (st.hidden.has(c.key)) st.hidden.delete(c.key); else st.hidden.add(c.key); render(); },
      })),
    ]));
    const wrap = h('div', { class: 'dt-wrap' });
    const pager = h('div', { class: 'dt-pager' });
    root.append(h('div', { class: 'dt-toolbar' }, opts.search === false ? null : search, h('span', { class: 'grow' }), count, h('div', { class: 'menu-wrap' }, colBtn)), wrap, pager);
    host.replaceChildren(root);
    search.addEventListener('input', debounce(() => { st.q = search.value.trim().toLowerCase(); st.page = 0; render(); }, 150));

    function filtered() {
      let rows = dataset.rows;
      if (st.q) rows = rows.filter((r) => cols.some((c) => formatCell(c, colValue(c, r)).toLowerCase().includes(st.q)));
      if (st.sort) {
        const c = cols.find((x) => x.key === st.sort);
        if (c) {
          const num = SORT_NUM_TYPES.includes(c.type);
          const sv = (r) => (c.sortValue ? c.sortValue(r) : colValue(c, r));
          rows = rows.slice().sort((a, b) => {
            const va = sv(a), vb = sv(b);
            const cmp = num ? (va ?? -Infinity) - (vb ?? -Infinity) : String(va ?? '').localeCompare(String(vb ?? ''), undefined, { numeric: true });
            return st.dir === 'asc' ? cmp : -cmp;
          });
        }
      }
      return rows;
    }

    function cell(c, r) {
      const v = colValue(c, r);
      const td = h('td', { class: NUM_TYPES.includes(c.type) ? 'num' : null });
      if (c.render) { td.append(c.render(r)); return td; }
      const text = formatCell(c, v);
      let node = text;
      if (c.type === 'stars' && v != null) node = starsEl(v);
      if (c.type === 'delta' && v != null) node = h('span', { class: `delta ${v > 0 ? 'up' : v < 0 ? 'down' : 'flat'}` }, text);
      if (c.type === 'delta' && v == null && c.isNew && c.isNew(r)) node = h('span', { class: 'delta up', title: 'No visits in the comparison period' }, 'New');
      const url = c.link && c.link(r);
      if (url) node = h('a', { href: url, target: '_blank', rel: 'noopener', onclick: (e) => e.stopPropagation() }, text);
      if (c.clamp) node = h('div', { class: 'clamp', title: text }, node);
      if (c.bar) {
        td.classList.add('bar-cell');
        td.append(h('div', { class: 'bar', style: { width: `${((Number(v) || 0) / maxes[c.key]) * 100}%` } }), h('span', null, node));
        return td;
      }
      td.append(node);
      return td;
    }

    function render() {
      const rows = filtered();
      const pages = Math.max(1, Math.ceil(rows.length / st.size));
      st.page = Math.min(st.page, pages - 1);
      const vis = cols.filter((c) => !st.hidden.has(c.key));
      const thead = h('thead', null, h('tr', null, vis.map((c) => {
        const sorted = st.sort === c.key;
        const th = h('th', {
          class: NUM_TYPES.includes(c.type) ? 'num' : null,
          scope: 'col',
          tabindex: 0,
          'aria-sort': sorted ? (st.dir === 'asc' ? 'ascending' : 'descending') : 'none',
        }, c.label, h('span', { class: 'sort', 'aria-hidden': 'true' }, sorted ? (st.dir === 'asc' ? '▲' : '▼') : '↕'));
        const toggle = () => {
          if (st.sort === c.key) st.dir = st.dir === 'asc' ? 'desc' : 'asc';
          else { st.sort = c.key; st.dir = SORT_NUM_TYPES.includes(c.type) ? 'desc' : 'asc'; }
          render();
        };
        th.addEventListener('click', toggle);
        th.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
        return th;
      })));
      const slice = rows.slice(st.page * st.size, (st.page + 1) * st.size);
      const tbody = h('tbody', null, slice.length ? slice.map((r) => {
        const tr = h('tr', { class: opts.onRowClick ? 'clickable' : null, tabindex: opts.onRowClick ? 0 : null }, vis.map((c) => cell(c, r)));
        if (opts.onRowClick) {
          tr.addEventListener('click', () => opts.onRowClick(r));
          tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') opts.onRowClick(r); });
        }
        return tr;
      }) : h('tr', null, h('td', { colspan: vis.length, class: 'dt-empty' }, st.q ? 'No rows match your search.' : opts.emptyText || 'No data for this selection.')));
      wrap.replaceChildren(h('table', null, thead, tbody));
      count.textContent = `${fmtN(rows.length)} ${rows.length === 1 ? 'row' : 'rows'}${st.q ? ` (of ${fmtN(dataset.rows.length)})` : ''}`;

      const sizeSel = h('select', { 'aria-label': 'Rows per page' }, [10, 25, 50, 100, 250].map((n) => h('option', { value: n, selected: n === st.size }, n)));
      sizeSel.addEventListener('change', () => { st.size = Number(sizeSel.value); st.page = 0; render(); });
      const from = rows.length ? st.page * st.size + 1 : 0;
      const to = Math.min(rows.length, (st.page + 1) * st.size);
      pager.replaceChildren(
        h('span', null, 'Rows per page'), sizeSel,
        h('span', null, `${fmtN(from)}–${fmtN(to)} of ${fmtN(rows.length)}`),
        h('button', { class: 'btn btn-ghost btn-xs', type: 'button', disabled: st.page === 0, 'aria-label': 'Previous page', onclick: () => { st.page--; render(); } }, '‹'),
        h('button', { class: 'btn btn-ghost btn-xs', type: 'button', disabled: st.page >= pages - 1, 'aria-label': 'Next page', onclick: () => { st.page++; render(); } }, '›'),
      );
    }
    render();
    return { render, state: st, rows: filtered, columns: () => cols.filter((c) => !st.hidden.has(c.key)) };
  }

  /* ────────────────────────────────────────────────────────────────────────
     Exporters — CSV, JSON, XLSX (hand-written OOXML + ZIP), SVG, PNG, JPEG,
     PDF (hand-written PDF 1.4 with embedded JPEG pages), Print
     ──────────────────────────────────────────────────────────────────────── */

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  /** Minimal ZIP writer (STORE method, UTF-8 names). */
  function zipBlob(files, type = 'application/zip') {
    const enc = new TextEncoder();
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const parts = [];
    const central = [];
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name);
      const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
      const crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true);
      lh.setUint16(4, 20, true);
      lh.setUint16(6, 0x0800, true);
      lh.setUint16(8, 0, true);
      lh.setUint16(10, dosTime, true);
      lh.setUint16(12, dosDate, true);
      lh.setUint32(14, crc, true);
      lh.setUint32(18, data.length, true);
      lh.setUint32(22, data.length, true);
      lh.setUint16(26, name.length, true);
      lh.setUint16(28, 0, true);
      parts.push(new Uint8Array(lh.buffer), name, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true);
      ch.setUint16(4, 20, true);
      ch.setUint16(6, 20, true);
      ch.setUint16(8, 0x0800, true);
      ch.setUint16(10, 0, true);
      ch.setUint16(12, dosTime, true);
      ch.setUint16(14, dosDate, true);
      ch.setUint32(16, crc, true);
      ch.setUint32(20, data.length, true);
      ch.setUint32(24, data.length, true);
      ch.setUint16(28, name.length, true);
      ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + data.length;
    }
    const cdSize = sum(central, (c) => c.length);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true);
    end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type });
  }

  const xmlEsc = (v) => String(v ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
    .replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  function colLetter(i) {
    let str = '';
    for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) str = String.fromCharCode(65 + ((n - 1) % 26)) + str;
    return str;
  }

  const XLSX_STYLE = { text: 0, header: 1, date: 2, int: 3, dec: 4, pct: 5, datetime: 6 };
  const XLSX_STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/><numFmt numFmtId="165" formatCode="yyyy-mm-dd hh:mm"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF2F5BEA"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="7">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  const Export = {
    fileName(title, ext) {
      const r = State.range();
      return `usage-${slug(title)}-${r.startDate}_to_${r.endDate}.${ext}`;
    },
    meta(title) {
      return { title, generatedAt: new Date().toISOString(), collibra: Env.base, collibraVersion: Env.info?.version?.displayVersion || null, filters: State.describeObj() };
    },

    /** Columns + rows as raw values (lists joined, a "Collibra URL" column added when rows link to Collibra). */
    matrix(ds) {
      const cols = ds.columns.filter((c) => !c.noExport);
      const linkCol = cols.find((c) => c.link);
      const header = cols.map((c) => c.label);
      const types = cols.map((c) => c.type || 'text');
      if (linkCol) { header.push('Collibra URL'); types.push('text'); }
      const rows = ds.rows.map((r) => {
        const a = cols.map((c) => {
          const v = colValue(c, r);
          if (v instanceof Set) return [...v].join('; ');
          if (Array.isArray(v)) return v.join('; ');
          return v ?? null;
        });
        if (linkCol) a.push(linkCol.link(r) || '');
        return a;
      });
      return { header, types, rows };
    },

    csvString(ds) {
      const { header, types, rows } = this.matrix(ds);
      const cell = (v, t) => {
        if (v == null) return '';
        if (t === 'datetime' && typeof v === 'number') v = new Date(v).toISOString();
        let str = String(v);
        if (typeof v === 'string' && /^[=+\-@\t\r]/.test(str)) str = `'${str}`;
        return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
      };
      return `\uFEFF${[header.map((x) => cell(x)).join(','), ...rows.map((r) => r.map((v, i) => cell(v, types[i])).join(','))].join('\r\n')}\r\n`;
    },

    jsonObj(ds) {
      const { header, types, rows } = this.matrix(ds);
      return rows.map((r) => Object.fromEntries(header.map((k, i) => [k, types[i] === 'datetime' && typeof r[i] === 'number' ? new Date(r[i]).toISOString() : r[i]])));
    },

    sheetXml(ds, { filter = true } = {}) {
      const { header, types, rows } = this.matrix(ds);
      const widths = header.map((x) => Math.min(60, Math.max(8, String(x).length + 2)));
      const cellXml = (v, t, ref) => {
        if (v == null || v === '') return '';
        if (typeof v === 'number' && Number.isFinite(v)) {
          if (t === 'pct' || t === 'delta') return `<c r="${ref}" s="${XLSX_STYLE.pct}"><v>${v / 100}</v></c>`;
          if (t === 'datetime') return `<c r="${ref}" s="${XLSX_STYLE.datetime}"><v>${(v - new Date(v).getTimezoneOffset() * 60000) / DAY + 25569}</v></c>`;
          return `<c r="${ref}" s="${Number.isInteger(v) ? XLSX_STYLE.int : XLSX_STYLE.dec}"><v>${v}</v></c>`;
        }
        if (t === 'date' && isIsoDate(v)) return `<c r="${ref}" s="${XLSX_STYLE.date}"><v>${toD(v).getTime() / DAY + 25569}</v></c>`;
        const str = String(v).slice(0, 32000);
        return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(str)}</t></is></c>`;
      };
      const lines = [];
      lines.push(`<row r="1">${header.map((x, i) => `<c r="${colLetter(i)}1" t="inlineStr" s="${XLSX_STYLE.header}"><is><t>${xmlEsc(x)}</t></is></c>`).join('')}</row>`);
      rows.forEach((r, ri) => {
        r.forEach((v, i) => { if (v != null) widths[i] = Math.min(60, Math.max(widths[i], String(typeof v === 'number' ? fmtN(v) : v).length + 2)); });
        lines.push(`<row r="${ri + 2}">${r.map((v, i) => cellXml(v, types[i], `${colLetter(i)}${ri + 2}`)).join('')}</row>`);
      });
      const lastRef = `${colLetter(Math.max(0, header.length - 1))}${rows.length + 1}`;
      return {
        ref: `A1:${lastRef}`,
        xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews><sheetView workbookViewId="0"${filter ? '><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView>' : '/>'}</sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>
<sheetData>${lines.join('')}</sheetData>
${filter && header.length ? `<autoFilter ref="A1:${lastRef}"/>` : ''}
</worksheet>`,
      };
    },

    /** sheets: [{ name, ds }] → .xlsx Blob (first sheet is an "About" sheet with export metadata). */
    xlsx(sheets, title) {
      const meta = this.meta(title);
      const about = {
        columns: [{ key: 'k', label: 'Property' }, { key: 'v', label: 'Value' }],
        rows: [
          { k: 'Report', v: title },
          { k: 'Collibra', v: Env.base },
          { k: 'Collibra version', v: meta.collibraVersion || '' },
          { k: 'Generated', v: new Date().toLocaleString() },
          { k: 'Period', v: `${meta.filters.startDate} to ${meta.filters.endDate}` },
          { k: 'Granularity', v: meta.filters.granularity },
          { k: 'Comparison', v: meta.filters.comparison ? `${meta.filters.comparison.startDate} to ${meta.filters.comparison.endDate}` : 'None' },
          { k: 'Filters', v: State.describe() },
        ],
      };
      const all = [{ name: 'About', ds: about, filter: false }, ...sheets];
      const used = new Set();
      const names = all.map((sh) => {
        let base = String(sh.name).replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'Sheet';
        let nm = base, i = 2;
        while (used.has(nm.toLowerCase())) { const suf = ` (${i++})`; nm = base.slice(0, 31 - suf.length) + suf; }
        used.add(nm.toLowerCase());
        return nm;
      });
      const files = [];
      const built = all.map((sh) => this.sheetXml(sh.ds, { filter: sh.filter !== false }));
      files.push({ name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${built.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('\n')}
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>` });
      files.push({ name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>` });
      files.push({ name: 'docProps/core.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${xmlEsc(title)}</dc:title><dc:creator>Usage Analytics Dashboard</dc:creator>
<dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</dcterms:created>
</cp:coreProperties>` });
      const defined = built.map((b, i) => (all[i].filter === false ? '' : `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${xmlEsc(names[i].replace(/'/g, "''"))}'!${b.ref.replace(/([A-Z]+)(\d+)/g, '$$$1$$$2')}</definedName>`)).join('');
      files.push({ name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<bookViews><workbookView xWindow="0" yWindow="0" windowWidth="28800" windowHeight="16000" activeTab="${all.length > 1 ? 1 : 0}"/></bookViews>
<sheets>${names.map((n, i) => `<sheet name="${xmlEsc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>
${defined ? `<definedNames>${defined}</definedNames>` : ''}
</workbook>` });
      files.push({ name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${built.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('\n')}
<Relationship Id="rId${built.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>` });
      files.push({ name: 'xl/styles.xml', data: XLSX_STYLES });
      built.forEach((b, i) => files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: b.xml }));
      return zipBlob(files, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    },

    /* ── Images ── */

    /** Wrap a chart SVG with title, filter summary and footer for standalone export. */
    compose(title, inner, subtitle = State.describe()) {
      const W = Number(inner.getAttribute('width'));
      const Hc = Number(inner.getAttribute('height'));
      const pad = 24, headH = 58, footH = 30;
      const TW = W + pad * 2, TH = Hc + headH + footH;
      const root = s('svg', { xmlns: SVGNS, width: TW, height: TH, viewBox: `0 0 ${TW} ${TH}`, 'font-family': Theme.font });
      root.append(s('rect', { x: 0, y: 0, width: TW, height: TH, fill: Theme.v('--bg-elev') }));
      root.append(svgText(pad, 30, title, { size: 17, weight: 700, fill: Theme.v('--text') }));
      root.append(svgText(pad, 48, truncate(subtitle, TW - pad * 2, 11), { size: 11 }));
      const clone = inner.cloneNode(true);
      clone.setAttribute('x', pad);
      clone.setAttribute('y', headH);
      root.append(clone);
      root.append(svgText(pad, TH - 10, `${Env.host()} · Generated ${new Date().toLocaleString()}`, { size: 10 }));
      return root;
    },

    async canvasOf(svgEl, scale = 2, bg = Theme.v('--bg-elev')) {
      const W = Number(svgEl.getAttribute('width')), H = Number(svgEl.getAttribute('height'));
      const str = new XMLSerializer().serializeToString(svgEl);
      const img = new Image();
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(str)}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(W * scale);
      canvas.height = Math.round(H * scale);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = bg || '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      return canvas;
    },

    canvasBlob(canvas, type, quality = 0.93) {
      return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Image encoding failed'))), type, quality));
    },

    /** Render a dataset as an SVG table (used for image/PDF export of tables). */
    tableSvg(ds, rows, W = 1100) {
      const cols = ds.columns.filter((c) => !c.noExport && c.type !== 'hidden');
      const text = (c, r) => formatCell(c, colValue(c, r));
      const natural = cols.map((c) => Math.min(320, Math.max(textW(c.label, 12, 700), ...rows.map((r) => textW(text(c, r), 12))) + 18));
      const scale = Math.min(1, W / sum(natural));
      const widths = natural.map((w) => w * scale);
      const TW = Math.max(W * 0.5, sum(widths));
      const rowH = 24, headH = 28;
      const H = headH + rows.length * rowH + 2;
      const svg = s('svg', { xmlns: SVGNS, width: TW, height: H, viewBox: `0 0 ${TW} ${H}`, 'font-family': Theme.font });
      svg.append(s('rect', { x: 0, y: 0, width: TW, height: headH, fill: Theme.v('--bg-sunken') }));
      let x = 0;
      cols.forEach((c, i) => {
        const num = NUM_TYPES.includes(c.type);
        svg.append(svgText(num ? x + widths[i] - 8 : x + 8, 18, truncate(c.label, widths[i] - 14, 12, 700), { size: 12, weight: 700, anchor: num ? 'end' : 'start', fill: Theme.v('--text-2') }));
        x += widths[i];
      });
      rows.forEach((r, ri) => {
        const y0 = headH + ri * rowH;
        if (ri % 2) svg.append(s('rect', { x: 0, y: y0, width: TW, height: rowH, fill: Theme.v('--bg-sunken'), 'fill-opacity': 0.5 }));
        let cx = 0;
        cols.forEach((c, i) => {
          const num = NUM_TYPES.includes(c.type);
          svg.append(svgText(num ? cx + widths[i] - 8 : cx + 8, y0 + 16, truncate(text(c, r), widths[i] - 14, 12), { size: 12, anchor: num ? 'end' : 'start', fill: Theme.v('--text') }));
          cx += widths[i];
        });
        svg.append(s('line', { x1: 0, x2: TW, y1: y0 + rowH, y2: y0 + rowH, stroke: Theme.v('--border') }));
      });
      return svg;
    },

    /* ── PDF ── */

    /** pages: [{ jpeg: Uint8Array, w, h }] → PDF Blob (US Letter landscape, one image per page). */
    pdf(pages, docTitle) {
      const latin = (str) => String(str).replace(/[–—]/g, '-').replace(/[·•]/g, '-').replace(/…/g, '...').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/→/g, '->').replace(/[^\x20-\x7e]/g, '?');
      const pdfStr = (str) => `(${latin(str).replace(/[\\()]/g, (c) => `\\${c}`)})`;
      const bytes = (str) => { const b = new Uint8Array(str.length); for (let i = 0; i < str.length; i++) b[i] = str.charCodeAt(i) & 0xff; return b; };
      const PW = 792, PH = 612, M = 30;
      const chunks = [];
      const offsets = [];
      let pos = 0;
      const push = (b) => { chunks.push(b); pos += b.length; };
      const obj = (num, body) => { offsets[num] = pos; push(bytes(`${num} 0 obj\n`)); body.forEach((b) => push(typeof b === 'string' ? bytes(b) : b)); push(bytes('\nendobj\n')); };

      push(bytes('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'));
      const n = pages.length;
      const pageNums = pages.map((_, i) => 6 + i * 3);
      obj(1, ['<< /Type /Catalog /Pages 2 0 R >>']);
      obj(2, [`<< /Type /Pages /Count ${n} /Kids [${pageNums.map((p) => `${p} 0 R`).join(' ')}] >>`]);
      obj(3, ['<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>']);
      obj(4, ['<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>']);
      obj(5, [`<< /Title ${pdfStr(docTitle)} /Producer (Usage Analytics Dashboard) /CreationDate (D:${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}) >>`]);
      pages.forEach((p, i) => {
        const pageObj = pageNums[i], contentObj = pageObj + 1, imgObj = pageObj + 2;
        const availW = PW - 2 * M, availH = PH - 2 * M - 24;
        const sc = Math.min(availW / p.w, availH / p.h);
        const dw = p.w * sc, dh = p.h * sc;
        const x = M + (availW - dw) / 2, y = M + 18 + (availH - dh);
        const content = [
          'q', `${dw.toFixed(2)} 0 0 ${dh.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm`, `/Im${i} Do`, 'Q',
          'BT', '0.45 0.5 0.58 rg', '/F1 8 Tf', `${M} ${M - 4} Td`, pdfStr(`${Env.host()} - ${docTitle} - Generated ${new Date().toLocaleString()}`), 'Tj', 'ET',
          'BT', '0.45 0.5 0.58 rg', '/F1 8 Tf', `${PW - M - 50} ${M - 4} Td`, pdfStr(`Page ${i + 1} of ${n}`), 'Tj', 'ET',
        ].join('\n');
        obj(pageObj, [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> /XObject << /Im${i} ${imgObj} 0 R >> >> /Contents ${contentObj} 0 R >>`]);
        obj(contentObj, [`<< /Length ${content.length} >>\nstream\n`, content, '\nendstream']);
        obj(imgObj, [`<< /Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`, p.jpeg, '\nendstream']);
      });
      const total = 6 + n * 3;
      const xref = pos;
      let xr = `xref\n0 ${total}\n0000000000 65535 f \n`;
      for (let i = 1; i < total; i++) xr += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
      push(bytes(`${xr}trailer\n<< /Size ${total} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
      return new Blob(chunks, { type: 'application/pdf' });
    },

    async pdfPage(svg) {
      const canvas = await this.canvasOf(svg, 2, '#ffffff');
      const blob = await this.canvasBlob(canvas, 'image/jpeg', 0.92);
      return { jpeg: new Uint8Array(await blob.arrayBuffer()), w: canvas.width, h: canvas.height };
    },

    /* ── Print (isolated iframe so only the chosen content prints) ── */

    print(title, bodyHtml) {
      const frame = h('iframe', { 'aria-hidden': 'true', style: { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' } });
      document.body.append(frame);
      const doc = frame.contentDocument;
      doc.open();
      doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
        @page { size: landscape; margin: 12mm; }
        body { font-family: ${Theme.font}; color: #111; margin: 0; }
        h1 { font-size: 18px; margin: 0 0 4px; } .meta { color: #555; font-size: 11px; margin-bottom: 14px; }
        svg { max-width: 100%; height: auto; display: block; } .page { page-break-after: always; } .page:last-child { page-break-after: auto; }
        table { border-collapse: collapse; width: 100%; font-size: 10.5px; } th, td { border: 1px solid #ccc; padding: 3px 6px; text-align: left; vertical-align: top; }
        th { background: #eef1f7; } td.num { text-align: right; } .foot { color: #777; font-size: 10px; margin-top: 10px; }
      </style></head><body>${bodyHtml}<div class="foot">${esc(Env.host())} · Generated ${esc(new Date().toLocaleString())}</div></body></html>`);
      doc.close();
      const go = () => {
        frame.contentWindow.focus();
        frame.contentWindow.print();
        setTimeout(() => frame.remove(), 2000);
      };
      setTimeout(go, 300);
    },

    tableHtml(ds) {
      const cols = ds.columns.filter((c) => !c.noExport);
      return `<table><thead><tr>${cols.map((c) => `<th>${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${ds.rows.map((r) => `<tr>${cols.map((c) => `<td class="${NUM_TYPES.includes(c.type) ? 'num' : ''}">${esc(formatCell(c, colValue(c, r)))}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    },
  };

  /* ────────────────────────────────────────────────────────────────────────
     Widgets: cards with loading / empty / error states, per-card toolbar
     (chart type, table view, fullscreen, export menu) and KPI strips
     ──────────────────────────────────────────────────────────────────────── */

  const ICONS = {
    table: 'M3 3h18v18H3V3zm2 2v4h14V5H5zm0 6v4h6v-4H5zm8 0v4h6v-4h-6zm-8 6v2h6v-2H5zm8 0v2h6v-2h-6z',
    chart: 'M3 13h4v8H3v-8zm7-6h4v14h-4V7zm7-4h4v18h-4V3z',
    expand: 'M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z',
    collapse: 'M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z',
    download: 'M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z',
    info: 'M11 7h2v2h-2V7zm0 4h2v6h-2v-6zm1-9a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16z',
    warn: 'M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z',
    lock: 'M18 8h-1V6A5 5 0 0 0 7 6v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2zM9 6a3 3 0 0 1 6 0v2H9V6zm9 14H6V10h12v10z',
    empty: 'M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm0 16H5V5h14v14zM7 10h2v7H7v-7zm4-3h2v10h-2V7zm4 6h2v4h-2v-4z',
  };
  const icon = (name) => s('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }, s('path', { d: ICONS[name] }));

  function iconBtn(name, label, onClick) {
    return h('button', { class: 'btn btn-icon', type: 'button', title: label, 'aria-label': label, onclick: onClick }, icon(name));
  }

  function stateEl(kind, title, text, extra) {
    return h('div', { class: `state ${kind === 'error' ? 'error' : ''}` }, icon(kind === 'error' ? 'warn' : kind === 'lock' ? 'lock' : kind === 'info' ? 'info' : 'empty'), h('h4', null, title), text ? h('p', null, text) : null, extra);
  }

  function errorEl(e, retry) {
    if (e && e.status === 403) {
      return stateEl('lock', 'No permission', 'Your account can\u2019t read this data. Usage Analytics needs the Insights permission (Usage Analytics > View).',
        h('div', { class: 'detail' }, e.path || ''));
    }
    if (e && e.status === 404) return stateEl('info', 'Not available here', 'This Collibra environment doesn\u2019t provide this API.', h('div', { class: 'detail' }, e.path || ''));
    return stateEl('error', 'Couldn\u2019t load this data', e?.message || String(e),
      h('div', null, e?.detail ? h('div', { class: 'detail' }, String(e.detail).slice(0, 300)) : null, retry ? h('button', { class: 'btn btn-sm', type: 'button', onclick: retry, style: { marginTop: '8px' } }, 'Retry') : null));
  }

  const isAbort = (e) => e && (e.name === 'AbortError');

  const Prefs = {
    data: (() => { try { return JSON.parse(localStorage.getItem(`${STORE}prefs`) || '{}'); } catch { return {}; } })(),
    get(id, k, dflt) { return this.data[id]?.[k] ?? dflt; },
    set(id, k, v) {
      this.data[id] = { ...(this.data[id] || {}), [k]: v };
      try { localStorage.setItem(`${STORE}prefs`, JSON.stringify(this.data)); } catch { /* ignore */ }
    },
  };

  const Widgets = {
    byTab: Object.fromEntries(TAB_IDS.map((t) => [t, []])),
    register(tab, w) { this.byTab[tab].push(w); },
    clear(tab) { this.byTab[tab].forEach((w) => { w.gen++; }); this.byTab[tab] = []; },
    all(tab) { return this.byTab[tab]; },
  };

  let fsBackdrop = null;
  function exitFullscreen() {
    const fs = $('.card.fullscreen');
    if (fs) fs.classList.remove('fullscreen');
    if (fsBackdrop) { fsBackdrop.remove(); fsBackdrop = null; }
  }

  /* ────────────────────────────────────────────────────────────────────────
     Measure definitions + "How is this calculated?" dialog
     Every KPI tile and card has an ⓘ button. Static text lives in INFO; the
     live worked numbers ("calc") are produced by each widget's load().
     scope: 'usage' (all filters) · 'users' (audience filters only)
            'date' (date range only) · 'all-time' (no date range or filters)
     ──────────────────────────────────────────────────────────────────────── */

  const UA_U = '/rest/usageAnalyticsUsage/v1';
  const UA_S = '/rest/usageAnalyticsUsers/v1';
  const C = {
    refresh: 'Collibra aggregates Usage Analytics data periodically, so the most recent activity may not be included yet. See "Usage data refreshed" in the header.',
    visitsNotPeople: 'Visits are not deduplicated: one person opening the same page 3 times counts as 3 visits.',
    perBucket: 'Each bucket counts distinct users within that bucket only. A person active in several buckets is counted in each one, so adding the buckets up gives user-days (or user-weeks), not people. See "Unique active users" for the deduplicated total.',
    nameDedup: 'The row-level download identifies users by display name only, so two different people with the same full name would be counted once here.',
    uaVsNav: 'Navigation statistics are a separate, all-time Collibra counter. They are not the same data as Usage Analytics and can differ from it.',
    actCap: 'The audit trail is loaded newest first up to "Max events". If the cap is reached, older events in the range are not counted.',
    noAudience: 'Audience filters (groups, roles, licenses, admin/disabled exclusions) do not apply to this data.',
    trend: 'Optional trend line: a least-squares straight line through the buckets, with slope per bucket and R² (how well a straight line fits, 0–1). Compound growth = (last ÷ first non-zero bucket)^(1 ÷ buckets between) − 1. Both are shown under "In this view" when the trend line is on.',
  };

  const INFO = {
    /* ── Shared user measures ── */
    activeUsers: {
      title: 'Active users', scope: 'users',
      what: 'The number of distinct people who signed in to Collibra at least once in the selected period. Each person is counted once, however many times they signed in or how many pages they viewed (deduplicated).',
      how: 'Collibra Usage Analytics counts distinct user IDs with at least one sign-in between the start and end date, after applying the audience filters. Change % = (current − comparison) ÷ comparison × 100.',
      source: [`GET ${UA_S}/summary?summaryUserType=Active`],
      caveats: [C.refresh, 'On the Overview tile, the sparkline shows distinct users per bucket, so its points do not add up to this number.'],
    },
    newUsers: {
      title: 'New users', scope: 'users',
      what: 'The number of people who signed in for the very first time during the selected period (Collibra\u2019s "New users").',
      how: 'Distinct users whose first-ever sign-in falls inside the period, counted by Collibra. Each person is counted once. Change % compares with the comparison period.',
      source: [`GET ${UA_S}/summary?summaryUserType=New`],
      caveats: [C.refresh],
    },
    inactiveUsers: {
      title: 'Inactive users', scope: 'users',
      what: 'The number of users who did not sign in during the selected period (Collibra\u2019s "Inactive users"). A decrease is shown as good.',
      how: 'Distinct users known to Usage Analytics with no sign-in between the start and end date, counted by Collibra after applying the audience filters.',
      source: [`GET ${UA_S}/summary?summaryUserType=Inactive`],
      caveats: [C.refresh, 'Use "Exclude disabled users" to leave disabled accounts out of this count.'],
    },
    totalVisits: {
      title: 'Total visits', scope: 'usage',
      what: 'The number of visits to assets, domains, communities, dashboards and diagrams in the selected period.',
      how: 'Sum of Collibra\u2019s visit counts for the five content types. Community and domain visits don\u2019t include visits to the assets inside them. Asset visits include visits via Data Marketplace.',
      formula: 'Total visits = Asset + Domain + Community + Dashboard + Diagram visits',
      source: [`GET ${UA_U}/visits/summary`, `GET ${UA_U}/visits/timeSeries (sparkline)`],
      caveats: [C.visitsNotPeople, C.refresh],
    },
    visitsPerUser: {
      title: 'Visits per active user', scope: 'usage',
      what: 'How many visits the average active person made in the period.',
      how: 'Total visits divided by the deduplicated number of active users.',
      formula: 'Visits per active user = Total visits ÷ Active users',
      source: [`GET ${UA_U}/visits/summary`, `GET ${UA_S}/summary?summaryUserType=Active`],
      caveats: ['Community/domain and asset-type filters narrow the visits but not the user count, which can lower this ratio.'],
    },
    assetsVisited: {
      title: 'Assets visited', scope: 'usage',
      what: 'The number of different assets that were visited at least once in the period.',
      how: 'Distinct asset IDs in the row-level asset-visit download for the period. Each asset is counted once regardless of how many visits it got.',
      source: [`GET ${UA_U}/visits/timeSeries/download?visitType=Asset`],
      caveats: [C.refresh],
    },
    coverage: {
      title: 'Catalog coverage', scope: 'usage',
      what: 'The share of all assets in the catalog that were visited at least once in the period.',
      how: 'Distinct assets visited divided by the total number of assets in Collibra.',
      formula: 'Coverage % = Assets visited ÷ Total assets × 100',
      source: [`GET ${UA_U}/visits/timeSeries/download?visitType=Asset`, 'GET /rest/2.0/assets?countLimit=-1 (total)'],
      caveats: ['The total includes every asset type, including technical assets such as columns, and ignores the dashboard filters.'],
    },
    sessionsPerUser: {
      title: 'Sessions per user', scope: 'users',
      what: 'The average number of sign-in sessions per active user in the period.',
      how: 'Sum of "Number of Sessions" across all active users in the row-level download, divided by the number of distinct users in that download.',
      formula: 'Sessions per user = Total sessions ÷ Distinct active users',
      source: [`GET ${UA_S}/licenseTypes/timeSeries/download?userType=Active`],
      caveats: [C.nameDedup],
    },
    visitsPerSession: {
      title: 'Visits per session', scope: 'users',
      what: 'How many pages (visits) an average session included.',
      how: 'Sum of all asset, domain, community, dashboard and diagram visits by active users, divided by their total sessions.',
      formula: 'Visits per session = Total visits ÷ Total sessions',
      source: [`GET ${UA_S}/licenseTypes/timeSeries/download?userType=Active`],
    },
    highUsage: {
      title: 'High-usage users', scope: 'users',
      what: 'Distinct people whose usage rate was "High" (signed in more than 50% of the time) in at least one bucket of the period.',
      how: 'Collibra assigns each user a usage rate per bucket: High = signed in more than 50% of the time, Medium = 20–50%, Low = less than 20%. This counts distinct users with at least one High bucket.',
      source: [`GET ${UA_S}/usageRate/timeSeries/download`],
      caveats: ['Usage rate isn\u2019t available per day; with Day granularity, weekly buckets are used.', C.nameDedup],
    },

    /* ── Unique active users (deduplicated) ── */
    uniqueActive: {
      title: 'Unique active users', scope: 'users',
      what: 'How many different people used Collibra in the period, counted once each, next to how often they came back. If 2 people sign in every day for a month, Unique active users is 2 and user-days is about 60.',
      how: 'Unique active users is Collibra\u2019s own distinct count of user IDs with at least one sign-in in the period. User-days adds up the number of distinct active users on each day. Average daily active users = user-days ÷ calendar days. Active days = days with at least one active user. The chart bars are distinct users per bucket; the line is the running total of distinct people seen so far, which ends at the unique count.',
      formula: 'User-days = Σ (distinct users active on each day)\nAvg daily active = User-days ÷ days in range\nStickiness = Avg daily active ÷ Unique active users × 100\nCumulative unique (bucket n) = people whose first visit in the range is in buckets 1…n',
      source: [`GET ${UA_S}/summary?summaryUserType=Active (unique)`, `GET ${UA_S}/licenseTypes/timeSeries?granularity=Day&userType=Active (user-days)`, `GET ${UA_S}/licenseTypes/timeSeries/download?userType=Active (per-bucket and cumulative)`],
      caveats: ['The bars count distinct users within each bucket, so a person active in several buckets appears in each bar: the bars add up to user-days (or user-weeks), not people. The headline and the running-total line are deduplicated.', C.nameDedup, C.refresh],
    },

    /* ── Overview cards ── */
    'ov-trend': {
      title: 'Visits over time', scope: 'usage',
      what: 'Visits per time bucket, split by content type. Shows only the content types selected in Content mix.',
      how: 'Collibra\u2019s visit counts per bucket and content type, stacked. The dashed line (when comparing) is the total of the selected types for the comparison period, aligned bucket by bucket.',
      source: [`GET ${UA_U}/visits/timeSeries`],
      caveats: [C.visitsNotPeople, 'Partial buckets at the start or end of the range are labelled "partial" and cover fewer days.', C.trend],
    },
    'ov-mix': {
      title: 'Content mix', scope: 'usage',
      what: 'The share of visits that went to each content type. Toggle types on or off to see the mix among the remaining types; the selection also applies to "Visits over time".',
      how: 'Visits per content type divided by the total visits of the selected types. The exported table also shows each type\u2019s share of all visits.',
      formula: 'Share % = Visits to type ÷ Visits to all selected types × 100',
      source: [`GET ${UA_U}/visits/summary`],
      caveats: [C.visitsNotPeople],
    },
    'ov-top-assets': {
      title: 'Most visited assets', scope: 'usage',
      what: 'The 10 assets with the most visits in the period, including visits via Data Marketplace.',
      how: 'Collibra\u2019s top-visited list for visit type Asset. Asset type, domain and community are looked up per asset.',
      source: [`GET ${UA_U}/visits/top?visitType=Asset&limit=10`, 'POST /graphql/knowledgeGraph/v1 (asset details)'],
      caveats: [C.visitsNotPeople],
    },
    'ov-top-dash': {
      title: 'Most visited dashboards', scope: 'usage',
      what: 'The 10 dashboards with the most visits in the period.',
      how: 'Collibra\u2019s top-visited list for visit type Dashboard.',
      source: [`GET ${UA_U}/visits/top?visitType=Dashboard&limit=10`],
      caveats: [C.visitsNotPeople],
    },
    'ov-top-users': {
      title: 'Most active users', scope: 'users',
      what: 'The 10 people with the most visits in the period.',
      how: 'Collibra\u2019s top-users list, ranked by each person\u2019s total visits. Each person appears once.',
      source: [`GET ${UA_S}/top?limit=10`],
    },
    'ov-active-users': {
      title: 'Active users over time', scope: 'users',
      what: 'Distinct active users in each time bucket, split by license type.',
      how: 'For each bucket, Collibra counts the distinct users who signed in during that bucket, grouped by their required license.',
      source: [`GET ${UA_S}/licenseTypes/timeSeries?userType=Active`],
      caveats: [C.perBucket],
    },
    'ov-communities': {
      title: 'Top communities', scope: 'usage',
      what: 'Asset visits grouped by the community that owns each asset.',
      how: 'Every visited asset from the row-level download is assigned to its community; visits are summed and distinct assets counted per community.',
      source: [`GET ${UA_U}/visits/timeSeries/download?visitType=Asset`],
      caveats: ['Only asset visits are included; domain and community page visits are not.'],
    },

    /* ── Content tab ── */
    'ct-trend': {
      title: 'Visits over time', scope: 'usage',
      what: 'Visits per time bucket for the selected content type(s).',
      how: 'Collibra\u2019s visit counts per bucket. The dashed line is the comparison period; the optional moving average is the mean of the last N buckets (7 days, 4 weeks, 3 months or 2 quarters).',
      source: [`GET ${UA_U}/visits/timeSeries`],
      caveats: [C.visitsNotPeople, C.trend],
    },
    'ct-heatmap': {
      title: 'Daily visit calendar', scope: 'usage',
      what: 'Visits on each calendar day, laid out by weekday (rows) and week (columns).',
      how: 'Daily visit counts for the selected content type(s). Darker cells mean more visits.',
      source: [`GET ${UA_U}/visits/timeSeries?granularity=Day`],
      caveats: ['At most the most recent 53 weeks of the range are shown.'],
    },
    'ct-weekday': {
      title: 'Weekday profile', scope: 'usage',
      what: 'The average number of visits on each day of the week.',
      how: 'Total visits on all Mondays in the range ÷ number of Mondays in the range, and so on for each weekday.',
      formula: 'Average (weekday) = Σ visits on that weekday ÷ number of those weekdays in the range',
      source: [`GET ${UA_U}/visits/timeSeries?granularity=Day`],
    },
    'ct-treemap': {
      title: 'Where visits happen', scope: 'usage',
      what: 'Visits grouped by domain (inside its community), or by community when "Communities" is selected. Larger rectangles mean more visits.',
      how: 'Visited items from the row-level download are grouped by domain or community, and their visits summed. With "All content", only asset visits are used.',
      source: [`GET ${UA_U}/visits/timeSeries/download`],
    },
    'ct-bytype': {
      title: 'Breakdown', scope: 'usage',
      what: 'Visits grouped by asset type (for assets and diagrams) or by community (for domains and communities).',
      how: 'Visited items from the row-level download are grouped, their visits summed, and distinct items counted per group.',
      source: [`GET ${UA_U}/visits/timeSeries/download`],
    },
    'ct-movers-up': {
      title: 'Rising', scope: 'usage',
      what: 'Items whose visits grew the most compared with the comparison period.',
      how: 'For every item visited in either period: change = current visits − comparison visits. Items with a positive change, largest first.',
      formula: 'Change = Visits (current) − Visits (comparison)\nChange % = Change ÷ Visits (comparison) × 100',
      source: [`GET ${UA_U}/visits/timeSeries/download (both periods)`],
      caveats: ['Needs "Compare to" set to a comparison period.'],
    },
    'ct-movers-down': {
      title: 'Falling', scope: 'usage',
      what: 'Items whose visits dropped the most compared with the comparison period.',
      how: 'For every item visited in either period: change = current visits − comparison visits. Items with a negative change, largest drop first.',
      formula: 'Change = Visits (current) − Visits (comparison)',
      source: [`GET ${UA_U}/visits/timeSeries/download (both periods)`],
      caveats: ['Needs "Compare to" set to a comparison period.'],
    },
    'ct-ranked': {
      title: 'All content ranked', scope: 'usage',
      what: 'Every item visited in the period, with its visits and share of the total. Not limited to a top-100 list.',
      how: 'Row-level visit data is summed per item (by ID). Share % = item visits ÷ total visits of the listed items. Previous/Change compare with the comparison period.',
      source: [`GET ${UA_U}/visits/timeSeries/download`],
      caveats: [C.visitsNotPeople],
    },

    /* ── Users tab ── */
    'us-rate': {
      title: 'Usage rate', scope: 'users',
      what: 'How often users signed in, per bucket: High (more than 50% of the time), Medium (20–50%) or Low (less than 20%).',
      how: 'Collibra classifies each user in each bucket by the share of the bucket\u2019s days on which they signed in, then counts distinct users per class.',
      source: [`GET ${UA_S}/usageRate/timeSeries`],
      caveats: [C.perBucket, 'Usage rate isn\u2019t available per day; with Day granularity, weekly buckets are used.'],
    },
    'us-retention': {
      title: 'Retention', scope: 'users',
      what: 'Users per bucket by retention status. Acquired: signed in for the first time ever. Retained: signed in during this bucket and the previous one. Returning: signed in during this bucket and in the past, but not during the previous bucket.',
      how: 'Collibra assigns each active user one retention status per bucket; the chart counts distinct users per status.',
      source: [`GET ${UA_S}/userRetention/timeSeries`],
      caveats: [C.perBucket],
    },
    'us-license': {
      title: 'Users by license type', scope: 'users',
      what: 'Users of the selected population (Active, Inactive or New) per bucket, split by the license each user requires.',
      how: 'Collibra counts distinct users per bucket and required license type.',
      source: [`GET ${UA_S}/licenseTypes/timeSeries`],
      caveats: [C.perBucket],
    },
    'us-funnel': {
      title: 'Adoption funnel', scope: 'users',
      what: 'How many of your enabled accounts became active, repeat and engaged users in the period. Every stage counts distinct people.',
      how: 'Enabled users: total enabled Collibra accounts. Active users: distinct users with at least one sign-in. Repeat users: active users with 2 or more sessions. Engaged users: users with a Medium or High usage rate in at least one bucket. % of first stage = stage ÷ first stage × 100.',
      source: ['GET /rest/2.0/users?includeDisabled=false (total)', `GET ${UA_S}/summary?summaryUserType=Active`, `GET ${UA_S}/licenseTypes/timeSeries/download`, `GET ${UA_S}/usageRate/timeSeries/download`],
      caveats: ['Enabled users ignores the audience filters.', C.nameDedup],
    },
    'us-top': {
      title: 'Most active users', scope: 'users',
      what: 'The 25 people with the most visits in the period.',
      how: 'Collibra\u2019s top-users list, ranked by each person\u2019s total visits. Each person appears once.',
      source: [`GET ${UA_S}/top?limit=25`],
    },
    'us-scatter': {
      title: 'Sessions vs. visits', scope: 'users',
      what: 'Each dot is one active person: how many sessions they had (across) against how many visits they made (up).',
      how: 'Per-user sums of "Number of Sessions" and of all visit columns from the row-level download.',
      source: [`GET ${UA_S}/licenseTypes/timeSeries/download?userType=Active`],
      caveats: [C.nameDedup],
    },
    'us-table': {
      title: 'Per-user detail', scope: 'users',
      what: 'One row per person in the selected population, with sessions, visits by content type, latest usage rate and retention statuses.',
      how: 'Row-level download rows are summed per person. Usage rate is the person\u2019s rate in their latest bucket; Usage days is the sum of their usage days; Retention lists every status they had in the period.',
      source: [`GET ${UA_S}/licenseTypes/timeSeries/download`, `GET ${UA_S}/usageRate/timeSeries/download`, `GET ${UA_S}/userRetention/timeSeries/download`],
      caveats: [C.nameDedup],
    },

    /* ── Asset Explorer ── */
    assetVisitsPeriod: {
      title: 'Visits in period', scope: 'usage',
      what: 'How many times this asset\u2019s page was visited in the selected period.',
      how: 'Sum of the asset\u2019s visit counts over all buckets in the range. Change % compares with the comparison period.',
      source: [`GET ${UA_U}/assets/{id}/visits/timeseries`],
      caveats: [C.visitsNotPeople],
    },
    assetVisitsAll: {
      title: 'All-time visits', scope: 'all-time',
      what: 'Every visit to this asset since Usage Analytics started recording.',
      how: 'Collibra\u2019s all-time visit total for the asset.',
      source: [`GET ${UA_U}/assets/{id}/summary`],
      caveats: [C.visitsNotPeople],
    },
    assetVisitors: {
      title: 'Unique visitors', scope: 'all-time',
      what: 'The number of different people who have ever visited this asset (deduplicated).',
      how: 'Collibra\u2019s all-time count of distinct users who visited the asset.',
      source: [`GET ${UA_U}/assets/{id}/summary`],
    },
    assetFirstVisit: {
      title: 'First visit', scope: 'all-time',
      what: 'The date of the earliest recorded visit to this asset.',
      how: 'Reported by Collibra Usage Analytics.',
      source: [`GET ${UA_U}/assets/{id}/summary`],
    },
    assetRating: {
      title: 'Rating', scope: 'all-time',
      what: 'The average star rating users have given this asset.',
      how: 'Collibra stores ratings on a 0–1 scale; each is multiplied by 5 and the results averaged.',
      formula: 'Rating = average(rating × 5)',
      source: ['GET /rest/2.0/ratings?assetId={id}'],
    },
    assetModified: {
      title: 'Last modified', scope: 'all-time',
      what: 'When this asset was last changed.',
      how: 'The asset\u2019s last-modified timestamp from Collibra.',
      source: ['POST /graphql/knowledgeGraph/v1 (modifiedOn)', 'GET /rest/2.0/assets/{id} (fallback)'],
    },
    'as-trend': {
      title: 'Visits over time', scope: 'usage',
      what: 'Visits to this asset per time bucket.',
      how: 'Collibra\u2019s per-asset visit counts per bucket. The dashed line is the comparison period; the optional moving average is the mean of the last N buckets.',
      source: [`GET ${UA_U}/assets/{id}/visits/timeseries`],
      caveats: [C.visitsNotPeople, C.trend],
    },
    'as-visitors': {
      title: 'Top visitors', scope: 'usage',
      what: 'The 15 people who visited this asset most often in the period.',
      how: 'Collibra\u2019s top-visitors list for the asset; names are looked up from user IDs.',
      source: [`GET ${UA_U}/assets/{id}/visitors/top?limit=15`, 'GET /rest/2.0/users/{id}'],
    },
    'as-activity': {
      title: 'Recent changes', scope: 'all-time',
      what: 'The latest audit-trail entries for this asset.',
      how: 'Up to 100 most recent activities whose context is this asset.',
      source: ['GET /rest/2.0/activities?contextId={id}&limit=100'],
    },
    'as-ratings': {
      title: 'Ratings & reviews', scope: 'all-time',
      what: 'Every rating and written review given to this asset.',
      how: 'Ratings are converted from Collibra\u2019s 0–1 scale to stars (× 5). Reviewer names are looked up from user IDs.',
      source: ['GET /rest/2.0/ratings?assetId={id}'],
    },
    'as-quick-top': {
      title: 'Most visited in this period', scope: 'usage',
      what: 'The 20 most visited assets in the period, as shortcuts into the Asset Explorer.',
      how: 'Collibra\u2019s top-visited list for visit type Asset.',
      source: [`GET ${UA_U}/visits/top?visitType=Asset&limit=20`],
    },
    'as-quick-recent': {
      title: 'Recently viewed by you', scope: 'all-time',
      what: 'The assets you (the signed-in user) viewed most recently.',
      how: 'Collibra\u2019s navigation history for the current user.',
      source: ['GET /rest/2.0/navigation/recently_viewed'],
    },

    /* ── Popularity ── */
    popAssets: {
      title: 'Assets with views', scope: 'all-time',
      what: 'How many assets have ever been viewed, according to Collibra\u2019s navigation statistics.',
      how: 'The total reported by the most-viewed navigation endpoint.',
      source: ['GET /rest/2.0/navigation/most_viewed'],
      caveats: [C.uaVsNav],
    },
    popViews: {
      title: 'Views in the loaded set', scope: 'all-time',
      what: 'All-time page views summed over the loaded most-viewed assets ("Assets to load").',
      how: 'Sum of numberOfViews for each loaded asset.',
      source: ['GET /rest/2.0/navigation/most_viewed'],
      caveats: [C.uaVsNav, 'Only the loaded assets are included; increase "Assets to load" for a fuller total.'],
    },
    popTop10: {
      title: 'Top 10 share', scope: 'all-time',
      what: 'How concentrated attention is: the share of views that went to the 10 most viewed assets.',
      how: 'Views of the top 10 assets ÷ views of all loaded assets.',
      formula: 'Top 10 share = Σ views (top 10) ÷ Σ views (loaded set) × 100',
      source: ['GET /rest/2.0/navigation/most_viewed'],
    },
    popMedian: {
      title: 'Median views', scope: 'all-time',
      what: 'The middle value of all-time views across the loaded assets: half have more, half have fewer.',
      how: 'Views of the loaded assets sorted ascending; the value at the middle position.',
      source: ['GET /rest/2.0/navigation/most_viewed'],
    },
    popCold: {
      title: 'Cold in period', scope: 'usage',
      what: 'Popular assets (in the loaded all-time most-viewed set) that got no visits at all in the selected period. A decrease is shown as good.',
      how: 'Loaded most-viewed assets whose visit count in the Usage Analytics asset-visit download for the period is 0.',
      source: ['GET /rest/2.0/navigation/most_viewed', `GET ${UA_U}/visits/timeSeries/download?visitType=Asset`],
      caveats: [C.uaVsNav],
    },
    'pop-top': {
      title: 'Most viewed assets of all time', scope: 'all-time',
      what: 'The 20 assets with the most all-time page views.',
      how: 'Collibra\u2019s navigation statistics, sorted by numberOfViews.',
      source: ['GET /rest/2.0/navigation/most_viewed'],
      caveats: [C.uaVsNav],
    },
    'pop-scatter': {
      title: 'Popularity vs. recency', scope: 'all-time',
      what: 'Each dot is a loaded asset: all-time views (log scale, across) against days since it was last viewed (up). Orange dots had no visits in the selected period.',
      how: 'Days since last viewed = today − lastViewedDate, in whole days.',
      source: ['GET /rest/2.0/navigation/most_viewed', `GET ${UA_U}/visits/timeSeries/download?visitType=Asset`],
    },
    'pop-types': {
      title: 'Views by asset type', scope: 'all-time',
      what: 'All-time views of the loaded assets, grouped by asset type.',
      how: 'Views summed per asset type; types beyond the top 7 are combined into "Other".',
      source: ['GET /rest/2.0/navigation/most_viewed', 'POST /graphql/knowledgeGraph/v1 (asset type)'],
    },
    'pop-communities': {
      title: 'Views by community', scope: 'all-time',
      what: 'All-time views of the loaded assets, grouped by the community that owns each asset.',
      how: 'Views summed per community, with the number of loaded assets in each.',
      source: ['GET /rest/2.0/navigation/most_viewed', 'POST /graphql/knowledgeGraph/v1 (community)'],
    },
    'pop-table': {
      title: 'Popularity ranking', scope: 'all-time',
      what: 'Every loaded asset with its all-time views, last-viewed date and visits in the selected period.',
      how: 'Navigation statistics joined with the Usage Analytics asset-visit download by asset ID. Signal = "Active in period" if it had any visits in the period, otherwise "Cold in period".',
      source: ['GET /rest/2.0/navigation/most_viewed', `GET ${UA_U}/visits/timeSeries/download?visitType=Asset`],
      caveats: [C.uaVsNav],
    },

    /* ── Edit activity ── */
    actEvents: {
      title: 'Events', scope: 'date',
      what: 'The number of audit-trail events (changes) in the period for the selected cause.',
      how: 'Count of activities with a timestamp inside the range. Per day = events ÷ days in the range.',
      source: ['GET /rest/2.0/activities?startDate&endDate'],
      caveats: [C.actCap, C.noAudience],
    },
    actContributors: {
      title: 'Contributors', scope: 'date',
      what: 'How many different people made changes in the period (deduplicated).',
      how: 'Distinct user names across the loaded events.',
      source: ['GET /rest/2.0/activities'],
      caveats: [C.actCap],
    },
    actManual: {
      title: 'Manual share', scope: 'date',
      what: 'The share of changes made by hand in the UI, rather than by imports or workflows.',
      how: 'Events with cause MANUAL ÷ all events.',
      formula: 'Manual share = Manual events ÷ All events × 100',
      source: ['GET /rest/2.0/activities'],
      caveats: [C.actCap],
    },
    actBusiest: {
      title: 'Busiest day', scope: 'date',
      what: 'The calendar day with the most events in the period.',
      how: 'Events grouped by local calendar day; the day with the highest count.',
      source: ['GET /rest/2.0/activities'],
      caveats: [C.actCap],
    },
    actAssets: {
      title: 'Assets changed', scope: 'date',
      what: 'How many different assets were changed in the period (deduplicated).',
      how: 'Distinct asset IDs (or names, when no ID is available) across events whose resource kind is Asset.',
      source: ['GET /rest/2.0/activities'],
      caveats: [C.actCap],
    },
    'act-trend': {
      title: 'Changes over time', scope: 'date',
      what: 'Audit-trail events per time bucket, split by action (add, update, remove…).',
      how: 'Each event is placed in the bucket containing its date and counted by action type.',
      source: ['GET /rest/2.0/activities'],
      caveats: [C.actCap],
    },
    'act-cause': {
      title: 'By cause', scope: 'date',
      what: 'Events split by what caused them: manual edits, imports or workflows.',
      how: 'Count of events per cause. Click a slice to filter the tab to that cause.',
      source: ['GET /rest/2.0/activities'],
      caveats: [C.actCap],
    },
    'act-kind': {
      title: 'What changed', scope: 'date',
      what: 'Events grouped by the kind of resource that changed (asset, relation, attribute, comment…).',
      how: 'Count of events per resource kind, decoded from each activity\u2019s description.',
      source: ['GET /rest/2.0/activities'],
      caveats: [C.actCap],
    },
    'act-users': {
      title: 'Top contributors', scope: 'date',
      what: 'The people who made the most changes in the period.',
      how: 'Events grouped by user, with the number of manual events and the time of each person\u2019s latest change.',
      source: ['GET /rest/2.0/activities'],
      caveats: [C.actCap],
    },
    'act-heat': {
      title: 'When changes happen', scope: 'date',
      what: 'Events by weekday and hour of day, in your browser\u2019s local time zone.',
      how: 'Each event is counted in the cell for its local weekday and hour.',
      source: ['GET /rest/2.0/activities'],
      caveats: [C.actCap],
    },
    'act-table': {
      title: 'Event log', scope: 'date',
      what: 'Every loaded audit-trail event, newest first.',
      how: 'Activities as returned by Collibra, with the resource kind, name and field decoded from each description.',
      source: ['GET /rest/2.0/activities'],
      caveats: [C.actCap],
    },

    /* ── Ratings ── */
    rtCount: {
      title: 'Ratings', scope: 'ratings',
      what: 'The number of ratings given (all time, or within the date range when "Selected date range" is chosen).',
      how: 'Count of rating records in scope.',
      source: ['GET /rest/2.0/ratings'],
      caveats: [C.noAudience],
    },
    rtAvg: {
      title: 'Average rating', scope: 'ratings',
      what: 'The mean star rating across all ratings in scope.',
      how: 'Collibra stores ratings on a 0–1 scale; each is multiplied by 5 and the results averaged.',
      formula: 'Average = Σ (rating × 5) ÷ number of ratings',
      source: ['GET /rest/2.0/ratings'],
    },
    rtAssets: {
      title: 'Rated assets', scope: 'ratings',
      what: 'How many different assets received at least one rating (deduplicated).',
      how: 'Distinct asset IDs across the ratings in scope.',
      source: ['GET /rest/2.0/ratings'],
    },
    rtReviewers: {
      title: 'Reviewers', scope: 'ratings',
      what: 'How many different people gave ratings (deduplicated).',
      how: 'Distinct user IDs (createdBy) across the ratings in scope.',
      source: ['GET /rest/2.0/ratings'],
    },
    rtWithReview: {
      title: 'With written review', scope: 'ratings',
      what: 'The share of ratings that include written review text.',
      how: 'Ratings with non-empty review text ÷ all ratings in scope.',
      formula: 'With review % = Ratings with text ÷ All ratings × 100',
      source: ['GET /rest/2.0/ratings'],
    },
    'rt-dist': {
      title: 'Rating distribution', scope: 'ratings',
      what: 'How many ratings gave 1, 2, 3, 4 or 5 stars.',
      how: 'Each rating is converted to stars (× 5), rounded to the nearest whole star, and counted.',
      source: ['GET /rest/2.0/ratings'],
    },
    'rt-trend': {
      title: 'Ratings over time', scope: 'ratings',
      what: 'Number of ratings per time bucket, with the average stars in the tooltip.',
      how: 'Ratings grouped by the bucket of their creation date. With "All time", buckets run from the first rating to the end date.',
      source: ['GET /rest/2.0/ratings'],
    },
    'rt-assets': {
      title: 'Most rated assets', scope: 'ratings',
      what: 'The assets with the most ratings, with their average stars.',
      how: 'Ratings grouped by asset; sorted by number of ratings, then by average.',
      source: ['GET /rest/2.0/ratings', 'POST /graphql/knowledgeGraph/v1 (asset type, domain)'],
    },
    'rt-avg': {
      title: 'Average rating by asset type', scope: 'ratings',
      what: 'The mean stars for each asset type.',
      how: 'Ratings grouped by the rated asset\u2019s type; Σ stars ÷ number of ratings per type.',
      source: ['GET /rest/2.0/ratings', 'POST /graphql/knowledgeGraph/v1 (asset type)'],
    },
    'rt-table': {
      title: 'All ratings', scope: 'ratings',
      what: 'Every rating in scope, newest first, with its review text.',
      how: 'Rating records from Collibra; stars = rating × 5. Reviewer names are looked up from user IDs.',
      source: ['GET /rest/2.0/ratings'],
    },
    'rt-coverage': {
      title: 'Rating coverage of popular assets', scope: 'usage',
      what: 'How many of the 100 most-visited assets in the date range have at least one rating. Popular but unrated assets are good candidates to ask for feedback.',
      how: 'The 100 assets with the most visits in the date range (row-level download) are matched with the rating records by asset ID. Ratings follow the Scope switch (all time or given in the date range).',
      formula: 'Coverage % = Top assets with ≥ 1 rating ÷ Top assets × 100',
      source: [`GET ${UA_U}/visits/timeSeries/download?visitType=Asset`, 'GET /rest/2.0/ratings'],
      caveats: ['Popularity uses the audience filters; ratings don\u2019t.'],
    },

    /* ── Additional Overview measures ── */
    'ov-dash-trend': {
      title: 'Dashboards over time', scope: 'usage',
      what: 'Dashboard visits per time bucket (bars) and how many different dashboards were opened in each bucket (line, right axis).',
      how: 'Bars are Collibra\u2019s dashboard visit counts per bucket. The line counts distinct dashboard IDs with at least one visit in each bucket, from the row-level download at the same granularity. The dashed line is dashboard visits in the comparison period, aligned bucket by bucket.',
      formula: 'Distinct dashboards (bucket) = number of dashboards with visits > 0 in that bucket\nVisits per dashboard = Dashboard visits ÷ distinct dashboards visited in the range',
      source: [`GET ${UA_U}/visits/timeSeries`, `GET ${UA_U}/visits/timeSeries/download?visitType=Dashboard`],
      caveats: [C.visitsNotPeople, C.trend, 'Adding up the per-bucket distinct counts counts a dashboard once per bucket it was visited.'],
    },
    'ov-diag-trend': {
      title: 'Diagrams over time', scope: 'usage',
      what: 'Diagram visits per time bucket (bars) and how many different diagrams were opened in each bucket (line, right axis).',
      how: 'Bars are Collibra\u2019s diagram visit counts per bucket. The line counts distinct diagram IDs with at least one visit in each bucket, from the row-level download at the same granularity. The dashed line is the comparison period.',
      formula: 'Distinct diagrams (bucket) = number of diagrams with visits > 0 in that bucket',
      source: [`GET ${UA_U}/visits/timeSeries`, `GET ${UA_U}/visits/timeSeries/download?visitType=Diagram`],
      caveats: [C.visitsNotPeople, C.trend],
    },

    /* ── Shared ── */
    concentration: {
      title: 'Concentration of visits', scope: 'usage',
      what: 'Whether usage is spread across many items or concentrated on a few. The curve shows what share of all visits the top X% of items receive; the diagonal is a perfectly even spread.',
      how: 'Items with at least one visit are ranked by visits. For every 5% step, the cumulative share of visits of the top items is plotted. The Gini coefficient summarizes the inequality: 0 = every item got the same number of visits, close to 1 = nearly all visits went to one item.',
      formula: 'Cumulative share (top p%) = Σ visits of the top ⌈n × p⌉ items ÷ total visits × 100\nGini = 2 × Σ(i × xᵢ) ÷ (n × Σx) − (n + 1) ÷ n, with xᵢ sorted ascending, i = 1…n',
      source: [`GET ${UA_U}/visits/timeSeries/download`],
      caveats: ['Only items visited at least once are included: never-visited items would make the spread look even more concentrated.'],
    },

    /* ── Content tab additions ── */
    'ct-coverage': {
      title: 'Catalog coverage', scope: 'usage',
      what: 'The share of the catalog that was visited at least once in the period, per asset type or per community.',
      how: 'Distinct visited assets come from the row-level asset-visit download and are grouped by asset type or community. Catalog totals are counted with the REST assets API for each group.',
      formula: 'Coverage % = Distinct assets visited in the group ÷ Assets in the group × 100',
      source: [`GET ${UA_U}/visits/timeSeries/download?visitType=Asset`, 'GET /rest/2.0/assets?typeIds=…&typeInheritance=false&countLimit=-1', 'GET /rest/2.0/assets?communityId=…&countLimit=-1'],
      caveats: ['Totals ignore the dashboard filters and include every asset of the group in the catalog.', 'Only groups with at least one visit are listed; community totals are fetched for the 25 most-visited communities.'],
    },
    'ct-stale': {
      title: 'Stale but popular', scope: 'usage',
      what: 'Popular assets whose content may be outdated: among the 200 most-visited assets in the period, the ones not modified for at least the chosen number of days.',
      how: 'Top-visited assets from the row-level download are enriched with their last-modified date. Days since modified = today − last modified.',
      formula: 'Stale = Days since modified ≥ threshold (90, 180 or 365)',
      source: [`GET ${UA_U}/visits/timeSeries/download?visitType=Asset`, 'POST /graphql/knowledgeGraph/v1 (modifiedOn)'],
      caveats: ['Collibra\u2019s last-modified date changes with any edit to the asset, including relations and attributes.'],
    },

    /* ── Dashboards tab ── */
    'db-visits': {
      title: 'Dashboard visits', scope: 'usage',
      what: 'Visits to dashboards in the period, for the dashboards that match the tab\u2019s dashboard filters.',
      how: 'Sum of per-dashboard visit counts from the row-level download. Change % compares with the same dashboards in the comparison period.',
      formula: 'Dashboard visits = Σ visits of the dashboards shown',
      source: [`GET ${UA_U}/visits/timeSeries/download?visitType=Dashboard`],
      caveats: [C.visitsNotPeople, C.refresh],
    },
    'db-count': {
      title: 'Dashboards visited', scope: 'usage',
      what: 'How many different dashboards were opened at least once in the period.',
      how: 'Distinct dashboard IDs in the row-level download, after the dashboard filters (selection and minimum visits).',
      source: [`GET ${UA_U}/visits/timeSeries/download?visitType=Dashboard`],
      caveats: ['Collibra doesn\u2019t expose a list of all dashboards, so dashboards that were never visited can\u2019t be counted.'],
    },
    'db-avg': {
      title: 'Visits per dashboard', scope: 'usage',
      what: 'The average number of visits per visited dashboard.',
      how: 'Dashboard visits divided by distinct dashboards visited.',
      formula: 'Visits per dashboard = Dashboard visits ÷ Dashboards visited',
      source: [`GET ${UA_U}/visits/timeSeries/download?visitType=Dashboard`],
    },
    'db-share': {
      title: 'Share of all visits', scope: 'usage',
      what: 'What part of all Collibra visits went to the dashboards shown.',
      how: 'Dashboard visits divided by visits to all content types (assets, domains, communities, dashboards, diagrams).',
      formula: 'Share % = Dashboard visits ÷ Total visits × 100',
      source: [`GET ${UA_U}/visits/timeSeries/download?visitType=Dashboard`, `GET ${UA_U}/visits/summary`],
    },
    'db-reach': {
      title: 'Dashboard reach', scope: 'users',
      what: 'The share of active people who opened at least one dashboard in the period.',
      how: 'From the per-user download: people with Dashboard Visits > 0, divided by all active people.',
      formula: 'Reach % = People with ≥ 1 dashboard visit ÷ Active people × 100',
      source: [`GET ${UA_S}/licenseTypes/timeSeries/download?userType=Active`],
      caveats: ['Uses all dashboards: the per-user data doesn\u2019t say which dashboard each person opened, so the dashboard picker doesn\u2019t apply.', C.nameDedup],
    },
    'db-per-viewer': {
      title: 'Visits per viewer', scope: 'users',
      what: 'How many dashboard visits the average dashboard user made.',
      how: 'Total dashboard visits of people who opened at least one dashboard, divided by the number of those people.',
      formula: 'Visits per viewer = Σ dashboard visits of viewers ÷ Number of viewers',
      source: [`GET ${UA_S}/licenseTypes/timeSeries/download?userType=Active`],
      caveats: [C.nameDedup],
    },
    'db-trend': {
      title: 'Dashboard visits over time', scope: 'usage',
      what: 'Visits per bucket to the top N dashboards (stacked), with all other dashboards grouped as "Other".',
      how: 'Per-dashboard, per-bucket visit counts from the row-level download. The dashed line is the total for the same dashboards in the comparison period, aligned bucket by bucket. Optional moving average = mean of the last N buckets.',
      source: [`GET ${UA_U}/visits/timeSeries/download?visitType=Dashboard&granularity=…`],
      caveats: [C.visitsNotPeople, C.trend],
    },
    'db-distinct': {
      title: 'Dashboards visited per period', scope: 'usage',
      what: 'How many different dashboards were opened in each bucket.',
      how: 'For each bucket, the number of dashboards with at least one visit in that bucket.',
      source: [`GET ${UA_U}/visits/timeSeries/download?visitType=Dashboard`],
      caveats: ['Adding the buckets up counts a dashboard once per bucket it was visited.'],
    },
    'db-viewers': {
      title: 'Dashboard viewers over time', scope: 'users',
      what: 'How many people opened at least one dashboard in each bucket (bars), and what share of that bucket\u2019s active people they were (line, right axis).',
      how: 'From the per-user, per-bucket download: people with Dashboard Visits > 0 in a bucket, divided by people active in that bucket.',
      formula: 'Reach % (bucket) = Dashboard viewers in bucket ÷ Active people in bucket × 100',
      source: [`GET ${UA_S}/licenseTypes/timeSeries/download?userType=Active&granularity=…`],
      caveats: [C.perBucket, C.nameDedup],
    },
    'db-weekday': {
      title: 'Weekday profile', scope: 'usage',
      what: 'The average number of dashboard visits on each day of the week.',
      how: 'Daily dashboard visits (filtered dashboards) summed per weekday and divided by the number of those weekdays in the range.',
      formula: 'Average (weekday) = Σ dashboard visits on that weekday ÷ number of those weekdays in the range',
      source: [`GET ${UA_U}/visits/timeSeries/download?visitType=Dashboard&granularity=Day`],
    },
    'db-heatmap': {
      title: 'Dashboard × period heatmap', scope: 'usage',
      what: 'Visits per bucket for each of the top N dashboards. Darker cells mean more visits.',
      how: 'Per-dashboard, per-bucket visit counts from the row-level download, shaded relative to the busiest cell.',
      source: [`GET ${UA_U}/visits/timeSeries/download?visitType=Dashboard`],
    },
    'db-lifecycle': {
      title: 'Dashboard lifecycle', scope: 'usage',
      what: 'Which dashboards are new, coming back, still in use or no longer used, compared with the comparison period.',
      how: 'Each dashboard visited in the current or comparison period is classified. A look-back period of the same length, just before the comparison period, separates New from Reactivated.',
      formula: 'Continuing = visits now > 0 and in comparison > 0\nNew = visits now > 0, none in comparison or look-back\nReactivated = visits now > 0, none in comparison, some in look-back\nDormant = visits in comparison > 0, none now',
      source: [`GET ${UA_U}/visits/timeSeries/download?visitType=Dashboard (current, comparison and look-back periods)`],
      caveats: ['"New" means not visited in the comparison or look-back periods. A dashboard could be older but unused for longer than that.', 'Needs "Compare to" set to a comparison period.'],
    },
    'db-reach-license': {
      title: 'Dashboard reach by license type', scope: 'users',
      what: 'For each license type, the share of its active people who opened at least one dashboard.',
      how: 'People from the per-user download are grouped by required license; viewers are those with Dashboard Visits > 0.',
      formula: 'Reach % (license) = Viewers with that license ÷ Active people with that license × 100',
      source: [`GET ${UA_S}/licenseTypes/timeSeries/download?userType=Active`],
      caveats: [C.nameDedup],
    },
    'db-consumers': {
      title: 'Top dashboard users', scope: 'users',
      what: 'The people with the most dashboard visits, and how much of their Collibra use is dashboards.',
      how: 'Per-user sums of Dashboard Visits and of all visit columns from the per-user download.',
      formula: 'Dashboard share % = Person\u2019s dashboard visits ÷ Person\u2019s total visits × 100',
      source: [`GET ${UA_S}/licenseTypes/timeSeries/download?userType=Active`],
      caveats: [C.nameDedup],
    },
    'db-table': {
      title: 'All dashboards ranked', scope: 'usage',
      what: 'Every dashboard visited in the period (and, without a minimum-visits filter, those only visited in the comparison period), with trend and lifecycle.',
      how: 'Per-dashboard totals and per-bucket values from the row-level download. Share % = dashboard visits ÷ visits to all listed dashboards. Rank change = rank in the comparison period − rank now. Active buckets = buckets with at least one visit.',
      source: [`GET ${UA_U}/visits/timeSeries/download?visitType=Dashboard (current and comparison periods)`],
      caveats: [C.visitsNotPeople],
    },

    /* ── Compare tab ── */
    'cp-trend': {
      title: 'Compare over time', scope: 'usage',
      what: 'The chosen metric per bucket for each selected item, optionally against the median of all items of the same kind.',
      how: 'Visits: assets use the per-asset time series; domains, communities, dashboards and diagrams use the row-level download at the selected granularity. Cumulative = running total. Share of selection = item visits ÷ visits to all selected items in that bucket. Edits = audit-trail events whose context is the item. Normalize: Indexed = value ÷ first non-zero value × 100; % of item total = value ÷ item total × 100. Peer median = per bucket, the median visits of all items of that kind visited at least once in the range.',
      formula: 'Indexed(t) = value(t) ÷ value(first non-zero) × 100\nShare of selection(t) = item(t) ÷ Σ selected items(t) × 100',
      source: [`GET ${UA_U}/assets/{id}/visits/timeseries`, `GET ${UA_U}/visits/timeSeries/download?visitType=…`, 'GET /rest/2.0/activities?contextId=…'],
      caveats: [C.visitsNotPeople, C.trend, 'Edits aren\u2019t available for dashboards.'],
    },
    'cp-multiples': {
      title: 'Small multiples', scope: 'usage',
      what: 'One small chart per selected item, each with its own scale, so the shape of usage can be compared even when volumes differ a lot.',
      how: 'Same per-bucket values as the main comparison chart, without normalization.',
      source: [`GET ${UA_U}/assets/{id}/visits/timeseries`, `GET ${UA_U}/visits/timeSeries/download`],
    },
    'cp-share': {
      title: 'Share of selection over time', scope: 'usage',
      what: 'How the selected items split their combined visits in each bucket.',
      how: 'For each bucket: item visits ÷ visits to all selected items in that bucket × 100. Stacked bars add up to 100%.',
      formula: 'Share(t) = Item visits(t) ÷ Σ selected items\u2019 visits(t) × 100',
      source: [`GET ${UA_U}/assets/{id}/visits/timeseries`, `GET ${UA_U}/visits/timeSeries/download`],
    },
    'cp-edits': {
      title: 'Edits vs visits', scope: 'usage',
      what: 'Curation (edits) against consumption (visits) for the selected items, per bucket and per item.',
      how: 'Edits are audit-trail events in the period whose context is the item; for domains and communities that includes changes to the assets inside. Visits as in the comparison chart.',
      formula: 'Edits per visit = Edits in period ÷ Visits in period',
      source: ['GET /rest/2.0/activities?contextId=…&startDate=…&endDate=…', `GET ${UA_U}/assets/{id}/visits/timeseries`],
      caveats: ['At most 2,000 edits are loaded per item.', 'Audience filters don\u2019t apply to edits.'],
    },
    'cp-visitors': {
      title: 'Top visitors per asset', scope: 'usage',
      what: 'The five people who visited each selected asset most often in the period.',
      how: 'Collibra\u2019s per-asset top-visitors list; names are looked up from user IDs.',
      source: [`GET ${UA_U}/assets/{id}/visitors/top?limit=5`, 'GET /rest/2.0/users/{id}'],
      caveats: ['Available for assets only.'],
    },
    'cp-table': {
      title: 'Side-by-side comparison', scope: 'usage',
      what: 'Usage, standing among peers, curation and freshness for every selected item.',
      how: 'Visits and change come from the item\u2019s time series. Rank in kind and percentile compare the item with all items of the same kind visited in the period (percentile = % of those items with fewer visits, ties counted as half). For assets: all-time visits and unique visitors come from Collibra\u2019s per-asset summary, rating from the ratings API, and freshness from the last-modified date.',
      formula: 'Percentile = (items with fewer visits + ½ × items with equal visits) ÷ items of kind × 100\nVisits per visitor = All-time visits ÷ Unique visitors\nEdits per visit = Edits ÷ Visits\nStale but popular = Days since modified ≥ threshold and percentile ≥ 80',
      source: [`GET ${UA_U}/visits/timeSeries/download`, `GET ${UA_U}/assets/{id}/summary`, 'GET /rest/2.0/ratings?assetId=…', 'GET /rest/2.0/activities?contextId=…'],
      caveats: ['All-time visits and unique visitors are not limited to the date range.'],
    },

    /* ── Users tab: tracked users ── */
    'us-track-trend': {
      title: 'Tracked users over time', scope: 'users',
      what: 'The chosen measure per bucket for each tracked person, against the median of everyone active in the same bucket.',
      how: 'Per-user, per-bucket values from the row-level download: sessions, visits by content type, or visits ÷ sessions. The peer median for a bucket is the median among the people active in that bucket.',
      formula: 'Visits per session(t) = Visits(t) ÷ Sessions(t)\nPeer median(t) = median of the metric over people active in bucket t',
      source: [`GET ${UA_S}/licenseTypes/timeSeries/download?userType=Active&granularity=…`],
      caveats: [C.nameDedup, 'People are matched by display name, which is what the download contains.'],
    },
    'us-track-mix': {
      title: 'What tracked users visit', scope: 'users',
      what: 'For each tracked person, their visits per bucket split by content type, and their usage persona.',
      how: 'Per-user, per-bucket visit columns (asset, domain, community, dashboard, diagram) from the row-level download.',
      source: [`GET ${UA_S}/licenseTypes/timeSeries/download?userType=Active`],
      caveats: ['Usage Analytics doesn\u2019t record which specific assets a person viewed, only how many visits per content type.', C.nameDedup],
    },
    'us-track-rate': {
      title: 'Usage rate & retention by period', scope: 'users',
      what: 'Each tracked person\u2019s usage rate (High / Medium / Low) and retention category in every bucket.',
      how: 'Collibra assigns a usage rate per person and bucket from the share of days they were active (High > 50%, Medium 20–50%, Low < 20%) and a retention category (Acquired, Retained, Returning).',
      source: [`GET ${UA_S}/usageRate/timeSeries/download`, `GET ${UA_S}/userRetention/timeSeries/download`],
      caveats: ['Usage rate isn\u2019t available per day; with Day granularity weekly buckets are used and retention is omitted.', C.nameDedup],
    },
    'us-track-edits': {
      title: 'Edits by tracked users', scope: 'date',
      what: 'How many changes each tracked person made in Collibra per bucket (their curation work, next to their consumption).',
      how: 'Audit-trail events performed by the person in the date range, counted per bucket by event date. The person\u2019s user ID is found from their display name.',
      source: ['GET /rest/2.0/activities?performedByUserId=…&startDate=…&endDate=…', `GET ${UA_S}/top (name → ID)`, 'GET /rest/2.0/users?name=… (name → ID)'],
      caveats: ['At most 5,000 events are loaded per person.', 'If a display name can\u2019t be matched to exactly one account, edits aren\u2019t shown for that person.'],
    },
    'us-track-ratings': {
      title: 'Ratings given by tracked users', scope: 'date',
      what: 'How many ratings each tracked person submitted per bucket.',
      how: 'Ratings created by the person (by user ID), counted per bucket by creation date.',
      source: ['GET /rest/2.0/ratings?userId=…'],
      caveats: ['If a display name can\u2019t be matched to an account, ratings aren\u2019t shown for that person.'],
    },
    'us-track-table': {
      title: 'Tracked users summary', scope: 'users',
      what: 'One row per tracked person: usage, rank among all active people, persona, usage rate, and contributions.',
      how: 'Totals from the per-user download. Rank = position by total visits among all active people. Percentile = % of active people with fewer visits (ties count half). Active buckets % = buckets with at least one session ÷ buckets in range.',
      formula: 'Percentile = (people with fewer visits + ½ × people with equal visits) ÷ active people × 100',
      source: [`GET ${UA_S}/licenseTypes/timeSeries/download`, `GET ${UA_S}/usageRate/timeSeries/download`, `GET ${UA_S}/userRetention/timeSeries/download`, 'GET /rest/2.0/activities', 'GET /rest/2.0/ratings'],
      caveats: [C.nameDedup],
    },

    /* ── Users tab: population ── */
    'us-stickiness': {
      title: 'Stickiness (DAU/MAU)', scope: 'users',
      what: 'How habitual Collibra use is: on a typical day (or week), what share of the month\u2019s users come back. 100% would mean every monthly user is active every day.',
      how: 'Per calendar month: average daily active users ÷ monthly active users, and average weekly active users ÷ monthly active users. The headline is the average over months with activity.',
      formula: 'DAU/MAU = (Σ daily active users ÷ days in month) ÷ distinct users in month × 100\nWAU/MAU = (Σ weekly active users ÷ weeks starting in month) ÷ distinct users in month × 100',
      source: [`GET ${UA_S}/licenseTypes/timeSeries?granularity=Day|Week|Month&userType=Active`],
      caveats: ['Partial months at the edges of the range only use the days inside the range.', 'Always calculated per month, regardless of the granularity setting.'],
    },
    'us-seats': {
      title: 'License seat utilization', scope: 'users',
      what: 'For each license type, how many of the known users actually used Collibra in the period. Unused seats may be candidates for re-assignment.',
      how: 'Active and inactive people from the per-user downloads are grouped by their required license.',
      formula: 'Utilization % = Active users ÷ (Active + Inactive users) × 100',
      source: [`GET ${UA_S}/licenseTypes/timeSeries/download?userType=Active`, `GET ${UA_S}/licenseTypes/timeSeries/download?userType=Inactive`],
      caveats: ['"Required license" is the license a person\u2019s roles require, as reported by Usage Analytics, not necessarily a purchased seat.', 'Use "Exclude disabled users" to leave disabled accounts out.', C.nameDedup],
    },
    'us-churn': {
      title: 'Churned, reactivated & continuing', scope: 'users',
      what: 'Who started, came back, stayed or stopped using Collibra, compared with the comparison period.',
      how: 'People active now are compared by name with people active in the comparison period and with Collibra\u2019s New users for the current period.',
      formula: 'Continuing = active now and in comparison\nNew = active now, first visit ever in this period\nReactivated = active now, not in comparison, not new\nChurned = active in comparison, not now\nChurn rate = Churned ÷ Active in comparison × 100\nRetention rate = Continuing ÷ Active in comparison × 100',
      source: [`GET ${UA_S}/licenseTypes/timeSeries/download?userType=Active (both periods)`, `GET ${UA_S}/licenseTypes/timeSeries/download?userType=New`],
      caveats: ['Needs "Compare to" set to a comparison period.', C.nameDedup],
    },
    'us-cohort': {
      title: 'Cohort retention', scope: 'users',
      what: 'Of the people who started in a given bucket, what share were still active 1, 2, 3… buckets later.',
      how: 'Each active person is assigned to the cohort of their first active bucket in the range. For each cohort and offset k, the share of its members active k buckets later is shown.',
      formula: 'Retention(cohort, +k) = Members active in bucket (cohort + k) ÷ Cohort size × 100',
      source: [`GET ${UA_S}/licenseTypes/timeSeries/download?userType=Active&granularity=…`],
      caveats: ['Approximation: the cohort is the first activity inside the selected range, not a person\u2019s first visit ever. The first cohort therefore includes all existing users.', 'Uses weekly buckets when Day granularity is selected.', C.nameDedup],
    },
    'us-personas': {
      title: 'Usage personas', scope: 'users',
      what: 'Active people grouped by what they mostly visit: dashboard consumers, catalog explorers, mixed users, and light users.',
      how: 'Rules on each person\u2019s visit mix in the period: Light = fewer than 5 visits. Otherwise by the share of visits to dashboards: ≥ 80% Dashboard-focused, ≤ 20% Catalog explorer, otherwise Mixed.',
      formula: 'Dashboard share = Dashboard visits ÷ Total visits',
      source: [`GET ${UA_S}/licenseTypes/timeSeries/download?userType=Active`],
      caveats: ['The thresholds are a convention of this dashboard, not a Collibra definition.', C.nameDedup],
    },
  };

  const Info = {
    scopeText(scope) {
      const r = State.range();
      switch (scope) {
        case 'all-time': return 'All time. The date range and audience filters don\u2019t apply.';
        case 'ratings': return State.s.rscope === 'all' ? `All ratings ever given ("All time"). ${C.noAudience}` : `Ratings given ${fmtRange(r.startDate, r.endDate)}. ${C.noAudience}`;
        case 'date': return `${fmtRange(r.startDate, r.endDate)}. ${C.noAudience}`;
        case 'users': {
          const d = State.describe();
          const ignored = FILTERS.filter((f) => !f.services.includes('users') && State.s.f[f.key].length);
          return ignored.length ? `${d}. Community/domain and asset-type filters don\u2019t apply to user metrics.` : d;
        }
        default: return State.describe();
      }
    },

    /**
     * Open the explanation for a measure. calc: undefined = still loading,
     * [] = unavailable, otherwise the live worked-calculation lines.
     */
    show(key, calc, label) {
      const d = INFO[key] || { title: label || 'This measure', what: 'No description is available for this measure.', scope: 'usage' };
      const title = label || d.title;
      const lines = calc === undefined ? null : (Array.isArray(calc) ? calc : [calc]).filter(Boolean);
      const sec = (head, ...kids) => h('section', { class: 'info-sec' }, h('h4', null, head), ...kids);
      const list = (items, cls) => h('ul', { class: cls || null }, items.map((x) => h('li', null, x)));
      const copy = () => {
        const txt = [
          `How "${title}" is calculated`,
          '', 'What it measures:', d.what,
          ...(d.how ? ['', 'How it\u2019s calculated:', d.how] : []),
          ...(d.formula ? ['', d.formula] : []),
          '', 'In this view:', ...(lines && lines.length ? lines.map((x) => `- ${x}`) : ['- (values not loaded)']), `- Scope: ${this.scopeText(d.scope)}`,
          ...(d.source?.length ? ['', 'Data source:', ...d.source.map((x) => `- ${x}`)] : []),
          ...(d.caveats?.length ? ['', 'Good to know:', ...d.caveats.map((x) => `- ${x}`)] : []),
          '', `${Env.host()} · ${new Date().toLocaleString()}`,
        ].join('\n');
        navigator.clipboard.writeText(txt).then(() => toast('Explanation copied', 'good'), () => toast('Couldn\u2019t copy to the clipboard', 'error'));
      };
      const body = h('div', { class: 'info-dialog' },
        sec('What it measures', h('p', null, d.what)),
        d.how ? sec('How it\u2019s calculated', h('p', null, d.how), d.formula ? h('pre', { class: 'formula' }, d.formula) : null) : null,
        sec('In this view',
          lines === null ? h('p', { class: 'muted' }, 'Loading current values…')
            : lines.length ? list(lines, 'calc') : h('p', { class: 'muted' }, 'Current values aren\u2019t available because the data didn\u2019t load.'),
          h('p', { class: 'note' }, h('strong', null, 'Scope: '), this.scopeText(d.scope))),
        d.source?.length ? sec('Data source', list(d.source.map((x) => h('code', null, x)), 'sources')) : null,
        d.caveats?.length ? sec('Good to know', list(d.caveats)) : null,
        h('div', { class: 'dialog-actions' }, h('button', { class: 'btn btn-sm', type: 'button', onclick: copy }, 'Copy explanation')));
      Modal.show(`How \u201c${title}\u201d is calculated`, body);
    },

    button(label, onClick, cls = 'btn btn-icon info-btn') {
      return h('button', { class: cls, type: 'button', title: `How is \u201c${label}\u201d calculated?`, 'aria-label': `How is ${label} calculated?`, onclick: (e) => { e.stopPropagation(); onClick(); } }, icon('info'));
    },

    /** Plain-text explanation record for exports (same content as the ⓘ dialog). */
    explain(key, calc, label) {
      const d = INFO[key] || { title: label || 'This measure', what: 'No description is available for this measure.', scope: 'usage' };
      const lines = (Array.isArray(calc) ? calc : [calc]).filter(Boolean);
      return {
        measure: label || d.title,
        what: d.what || '',
        how: d.how || '',
        formula: d.formula || '',
        inThisView: lines.join(' | '),
        scope: this.scopeText(d.scope),
        source: (d.source || []).join(' | '),
        caveats: (d.caveats || []).join(' | '),
      };
    },
  };

  const EXPLAIN_COLUMNS = [
    { key: 'widget', label: 'Chart / table' }, { key: 'measure', label: 'Measure' }, { key: 'what', label: 'What it measures' },
    { key: 'how', label: 'How it\u2019s calculated' }, { key: 'formula', label: 'Formula' }, { key: 'inThisView', label: 'In this view' },
    { key: 'scope', label: 'Scope' }, { key: 'source', label: 'Data source' }, { key: 'caveats', label: 'Good to know' },
  ];
  /** Explanation rows for a widget (one per KPI for KPI strips). */
  function explainWidget(w) {
    if (w.kind === 'kpi') return (w.result?.items || []).filter((k) => k.info).map((k) => ({ widget: w.title, ...Info.explain(k.info, k.calc || [], k.label) }));
    return [{ widget: w.title, ...Info.explain(w.infoKey, w.calc() || [], w.title) }];
  }
  const explainDataset = (rows) => ({ columns: EXPLAIN_COLUMNS, rows });

  /**
   * A dashboard card. opts: { id, title, sub, span, height, load(w) → result, chartTypes, stackable, view, info? }
   * result: { spec?, dataset?, empty?: {title,text}, note?, render?(body), tableOpts?, stats?: [{label,value,hint}], calc?: string[] }
   * opts.info is the INFO key (defaults to opts.id); result.calc holds the live worked calculation.
   */
  function card(tab, opts) {
    const w = { tab, opts, gen: 0, result: null, error: null, title: opts.title, view: Prefs.get(opts.id, 'view', opts.view || 'chart') };
    const titleEl = h('h3', null, opts.title);
    const subEl = h('div', { class: 'sub' }, opts.sub || '');
    const tools = h('div', { class: 'card-tools' });
    const optionsRow = h('div', { class: 'card-options' });
    optionsRow.hidden = true;
    const body = h('div', { class: 'card-body' });
    const statsEl = h('div', { class: 'stat-row', role: 'list' });
    statsEl.hidden = true;
    const foot = h('div', { class: 'card-foot' });
    foot.hidden = true;
    const el = h('section', { class: `card span-${opts.span || 6}`, 'aria-label': opts.title, dataset: { widget: opts.id } },
      h('div', { class: 'card-head' }, h('div', { class: 'card-title' }, titleEl, subEl), tools), optionsRow, statsEl, body, foot);
    Object.assign(w, { el, body, foot, tools, optionsRow, subEl, statsEl });
    w.infoKey = opts.info || opts.id;
    /** Live calc for the info dialog: undefined while loading, [] on error. */
    w.calc = () => (w.result ? (w.result.calc || (w.result.empty ? [`${w.result.empty.title || 'No data'}${w.result.empty.text ? ` \u2014 ${w.result.empty.text}` : ''}`] : [])) : w.error ? [] : undefined);
    w.showInfo = () => Info.show(w.infoKey, w.calc(), w.title);

    w.setSub = (t) => { subEl.textContent = t || ''; };
    w.dataset = () => {
      const r = w.result;
      if (!r) return null;
      if (r.dataset) return r.dataset;
      if (r.spec && r.spec.kind === 'series') return seriesDataset(r.spec);
      return null;
    };

    w.run = async () => {
      const gen = ++w.gen;
      w.result = null;
      w.error = null;
      body.replaceChildren(h('div', { class: 'skeleton-block', style: { minHeight: `${opts.height || 260}px` } }));
      foot.hidden = true;
      statsEl.hidden = true;
      w.buildTools();
      try {
        const res = await opts.load(w);
        if (gen !== w.gen) return;
        w.result = res || { empty: { title: 'No data' } };
        w.render();
      } catch (e) {
        if (gen !== w.gen || isAbort(e)) return;
        w.error = e;
        if (e && e.status === 403 && String(e.path || '').includes('usageAnalytics')) App.uaForbidden();
        body.replaceChildren(errorEl(e, () => w.run()));
        console.warn(`[usage-dashboard] ${opts.title}:`, e);
      }
    };

    w.render = () => {
      const r = w.result;
      if (!r) return;
      w.buildTools();
      if (r.note) { foot.hidden = false; foot.replaceChildren(typeof r.note === 'string' ? document.createTextNode(r.note) : r.note); } else foot.hidden = true;
      statsEl.hidden = !(r.stats && r.stats.length && !r.empty);
      if (!statsEl.hidden) {
        statsEl.replaceChildren(...r.stats.map((st) => h('div', { class: `stat${st.primary ? ' primary' : ''}`, role: 'listitem', title: st.hint || null },
          h('div', { class: 'stat-value' }, st.display ?? fmtC(st.value)),
          h('div', { class: 'stat-label' }, st.label))));
      }
      if (r.empty) { body.replaceChildren(stateEl('empty', r.empty.title || 'No data', r.empty.text || '')); return; }
      if (r.render) { body.replaceChildren(); r.render(body); return; }
      const ds = w.dataset();
      w.table = null;
      if ((w.view === 'table' || !r.spec) && ds) {
        w.table = DataTable(body, ds, r.tableOpts || {});
        return;
      }
      if (r.spec) {
        if (r.spec.kind === 'series') {
          r.spec.mode = Prefs.get(opts.id, 'mode', r.spec.mode);
          r.spec.stacked = Prefs.get(opts.id, 'stacked', r.spec.stacked);
        }
        const host = h('div', { class: 'chart-host' });
        body.replaceChildren(host);
        Charts.render(host, r.spec);
      }
    };

    w.buildTools = () => {
      const r = w.result;
      const hasChart = !!(r && r.spec);
      const ds = w.dataset();
      const kids = [Info.button(w.title, w.showInfo)];
      if (hasChart && ds) {
        kids.push(iconBtn(w.view === 'table' ? 'chart' : 'table', w.view === 'table' ? 'Show chart' : 'Show data table', () => {
          w.view = w.view === 'table' ? 'chart' : 'table';
          Prefs.set(opts.id, 'view', w.view);
          w.render();
        }));
      }
      kids.push(iconBtn(el.classList.contains('fullscreen') ? 'collapse' : 'expand', 'Fullscreen', () => {
        if (el.classList.contains('fullscreen')) exitFullscreen();
        else {
          exitFullscreen();
          fsBackdrop = h('div', { class: 'fs-backdrop', onclick: exitFullscreen });
          document.body.append(fsBackdrop);
          el.classList.add('fullscreen');
        }
        w.buildTools();
      }));
      const exp = iconBtn('download', 'Export / print', () => Menus.popup(exp, exportItems(w)));
      exp.setAttribute('aria-haspopup', 'menu');
      kids.push(h('div', { class: 'menu-wrap' }, exp));
      tools.replaceChildren(...kids);

      optionsRow.replaceChildren();
      optionsRow.hidden = true;
      if (hasChart && r.spec.kind === 'series' && opts.chartTypes && w.view === 'chart') {
        const mode = Prefs.get(opts.id, 'mode', r.spec.mode);
        const seg = h('div', { class: 'segmented segmented-sm', role: 'radiogroup', 'aria-label': 'Chart type' },
          opts.chartTypes.map((t) => h('button', {
            type: 'button', role: 'radio', 'aria-checked': String(mode === t),
            onclick: () => { Prefs.set(opts.id, 'mode', t); w.render(); },
          }, t[0].toUpperCase() + t.slice(1))));
        optionsRow.append(seg);
        if (opts.stackable && r.spec.series.filter((x) => !x.overlay).length > 1 && mode !== 'line') {
          const cb = h('input', { type: 'checkbox', checked: Prefs.get(opts.id, 'stacked', r.spec.stacked) });
          cb.addEventListener('change', () => { Prefs.set(opts.id, 'stacked', cb.checked); w.render(); });
          optionsRow.append(h('label', { class: 'switch' }, cb, h('span', { class: 'track' }), 'Stacked'));
        }
        if (r.extraOptions) optionsRow.append(...r.extraOptions(w));
        optionsRow.hidden = false;
      } else if (r && r.extraOptions && w.view === 'chart') {
        optionsRow.append(...r.extraOptions(w));
        optionsRow.hidden = false;
      }
    };

    Widgets.register(tab, w);
    return w;
  }

  function exportItems(w) {
    const ok = !!(w.result && !w.result.empty);
    const ds = ok && w.dataset();
    const visual = ok && (w.result.spec || ds);
    return [
      { label: 'Image' },
      { text: 'PNG image', disabled: !visual, onClick: () => exportVisual(w, 'png') },
      { text: 'JPEG image', disabled: !visual, onClick: () => exportVisual(w, 'jpeg') },
      { text: 'SVG vector', disabled: !visual, onClick: () => exportVisual(w, 'svg') },
      { text: 'PDF document', disabled: !visual, onClick: () => exportVisual(w, 'pdf') },
      { text: 'Print', disabled: !visual, onClick: () => exportVisual(w, 'print') },
      '-',
      { label: 'Data' },
      { text: 'CSV (.csv)', disabled: !ds, onClick: () => exportData(w, 'csv') },
      { text: 'Excel (.xlsx)', disabled: !ds, onClick: () => exportData(w, 'xlsx') },
      { text: 'JSON (.json)', disabled: !ds, onClick: () => exportData(w, 'json') },
    ];
  }

  /** The dataset as currently shown (visible columns, sort and search) — used for image/PDF/print exports. */
  function visibleDataset(w) {
    const ds = w.dataset();
    if (w.table) return { columns: w.table.columns(), rows: w.table.rows() };
    return { columns: ds.columns.filter((c) => !c.hidden), rows: ds.rows };
  }

  /** Build the export SVG for a widget: its chart (as currently shown) or its table (first maxRows rows). */
  function widgetSvg(w, { rows = null, light = false, page = '' } = {}) {
    const make = () => {
      const r = w.result;
      const W = clamp(Math.floor(w.body.clientWidth || 900), 640, 1400);
      let inner;
      let title = w.title;
      if (r.stats && r.stats.length) title += ` \u2014 ${r.stats.map((st) => `${st.label}: ${st.display ?? fmtN(st.value)}`).join(' \u00b7 ')}`;
      if (r.spec && w.view !== 'table') {
        inner = Charts.kinds[r.spec.kind](W, r.spec);
        inner.setAttribute('font-family', Theme.font);
      } else {
        const ds = visibleDataset(w);
        const slice = rows || ds.rows.slice(0, 40);
        inner = Export.tableSvg(ds, slice, W);
        if (!rows && ds.rows.length > slice.length) title += ` (first ${slice.length} of ${fmtN(ds.rows.length)} rows)`;
      }
      return Export.compose(title + page, inner);
    };
    return light ? Theme.withLight(make) : make();
  }

  /** "How it's calculated" notes as print-friendly HTML. */
  function explainHtml(list) {
    if (!list.length) return '';
    const row = (label, v) => (v ? `<p><strong>${esc(label)}:</strong> ${esc(v)}</p>` : '');
    return `<h2 style="font-size:15px;margin:22px 0 6px">How it\u2019s calculated</h2>${list.map((x) => `<div style="margin:0 0 12px">
      <h3 style="font-size:13px;margin:8px 0 4px">${esc(x.measure)}</h3>${row('What it measures', x.what)}${row('How it\u2019s calculated', x.how)}${row('Formula', x.formula)}${row('In this view', x.inThisView)}${row('Data source', x.source)}${row('Good to know', x.caveats)}</div>`).join('')}`;
  }

  async function exportVisual(w, fmt) {
    try {
      const name = Export.fileName(w.title, fmt === 'jpeg' ? 'jpg' : fmt);
      if (fmt === 'svg') {
        const svg = widgetSvg(w);
        downloadBlob(new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(svg)}`], { type: 'image/svg+xml' }), name);
      } else if (fmt === 'png' || fmt === 'jpeg') {
        const canvas = await Export.canvasOf(widgetSvg(w), 2);
        downloadBlob(await Export.canvasBlob(canvas, `image/${fmt}`), name);
      } else if (fmt === 'pdf') {
        toast('Building PDF…');
        const pages = [];
        if (w.result.spec && w.view !== 'table') pages.push(await Export.pdfPage(widgetSvg(w, { light: true })));
        else {
          const per = 24;
          const all = visibleDataset(w).rows.slice(0, 2400);
          const n = Math.max(1, Math.ceil(all.length / per));
          for (let i = 0; i < n; i++) pages.push(await Export.pdfPage(widgetSvg(w, { light: true, rows: all.slice(i * per, (i + 1) * per), page: n > 1 ? ` — page ${i + 1} of ${n}` : '' })));
        }
        downloadBlob(Export.pdf(pages, w.title), name);
      } else if (fmt === 'print') {
        const header = `<h1>${esc(w.title)}</h1><div class="meta">${esc(State.describe())}</div>`;
        const notes = explainHtml(explainWidget(w));
        if (w.result.spec && w.view !== 'table') Export.print(w.title, header + widgetSvg(w, { light: true }).outerHTML + notes);
        else Export.print(w.title, header + Export.tableHtml(visibleDataset(w)) + notes);
      }
    } catch (e) {
      console.error(e);
      toast(`Export failed: ${e.message}`, 'error');
    }
  }

  function exportData(w, fmt) {
    const ds = w.dataset();
    if (!ds) return;
    if (fmt === 'csv') downloadBlob(new Blob([Export.csvString(ds)], { type: 'text/csv;charset=utf-8' }), Export.fileName(w.title, 'csv'));
    else if (fmt === 'xlsx') downloadBlob(Export.xlsx([{ name: w.title, ds }, { name: 'How calculated', ds: explainDataset(explainWidget(w)), filter: false }], w.title), Export.fileName(w.title, 'xlsx'));
    else if (fmt === 'json') {
      const out = { meta: Export.meta(w.title), explanation: explainWidget(w), columns: ds.columns.filter((c) => !c.noExport).map((c) => ({ key: c.key, label: c.label, type: c.type || 'text' })), rows: Export.jsonObj(ds) };
      downloadBlob(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }), Export.fileName(w.title, 'json'));
    }
  }

  /** Export every loaded widget on the current tab. */
  async function exportAll(fmt) {
    const tab = State.s.tab;
    const tabTitle = $(`#tab-${tab}`).textContent.trim();
    const ws = Widgets.all(tab).filter((w) => w.result && !w.result.empty);
    if (fmt === 'print') { window.print(); return; }
    if (!ws.length) { toast('Nothing loaded on this tab yet.', 'error'); return; }
    const withData = ws.map((w) => ({ w, ds: w.dataset() })).filter((x) => x.ds);
    const title = `${tabTitle} dashboard`;
    const explained = explainDataset(withData.flatMap((x) => explainWidget(x.w)));
    try {
      if (fmt === 'xlsx') {
        downloadBlob(Export.xlsx([...withData.map((x) => ({ name: x.w.title, ds: x.ds })), { name: 'How calculated', ds: explained, filter: false }], title), Export.fileName(title, 'xlsx'));
      } else if (fmt === 'csv') {
        const used = new Set();
        const files = withData.map((x) => {
          let n = slug(x.w.title), i = 2;
          while (used.has(n)) n = `${slug(x.w.title)}-${i++}`;
          used.add(n);
          return { name: `${n}.csv`, data: Export.csvString(x.ds) };
        });
        files.push({ name: 'how-calculated.csv', data: Export.csvString(explained) });
        downloadBlob(zipBlob(files), Export.fileName(title, 'zip'));
      } else if (fmt === 'json') {
        const out = { meta: Export.meta(title), widgets: withData.map((x) => ({ title: x.w.title, explanation: explainWidget(x.w), columns: x.ds.columns.filter((c) => !c.noExport).map((c) => ({ key: c.key, label: c.label, type: c.type || 'text' })), rows: Export.jsonObj(x.ds) })) };
        downloadBlob(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }), Export.fileName(title, 'json'));
      } else if (fmt === 'pdf') {
        toast('Building PDF report…');
        const pages = [];
        for (const w of ws) {
          if (w.kind === 'kpi') {
            const kds = w.dataset();
            const slim = { ...kds, columns: kds.columns.filter((c) => c.key !== 'calc') };
            pages.push(await Export.pdfPage(Theme.withLight(() => Export.compose(w.title, Export.tableSvg(slim, slim.rows, 1000)))));
          }
          else if (w.result.spec || w.dataset()) pages.push(await Export.pdfPage(widgetSvg(w, { light: true })));
        }
        downloadBlob(Export.pdf(pages, title), Export.fileName(title, 'pdf'));
      }
    } catch (e) {
      console.error(e);
      toast(`Export failed: ${e.message}`, 'error');
    }
  }

  /**
   * KPI strip. load() → [{ label, value, display?, unit?, delta?, prev?, spark?, color?, ring?, meta?, invert?, help?, info?, calc? }]
   * info is the INFO key for the ⓘ dialog; calc holds the live worked calculation lines.
   */
  function kpiStrip(tab, { id, title = 'Key metrics', count = 6, load }) {
    const el = h('div', { class: 'kpis', role: 'list', 'aria-label': title });
    const w = { tab, kind: 'kpi', title, gen: 0, result: null, el, opts: { id } };
    w.dataset = () => (w.result ? {
      columns: [{ key: 'label', label: 'Metric' }, { key: 'value', label: 'Value', type: 'number' }, { key: 'prev', label: 'Comparison value', type: 'number' }, { key: 'delta', label: 'Change %', type: 'delta' }, { key: 'meta', label: 'Notes' }, { key: 'calc', label: 'Calculation' }],
      rows: w.result.items.map((k) => ({ label: k.label, value: k.value == null ? null : Math.round(k.value * 100) / 100, prev: k.prev == null ? null : Math.round(k.prev * 100) / 100, delta: k.delta == null ? null : Math.round(k.delta * 10) / 10, meta: k.metaText || k.meta || '', calc: (Array.isArray(k.calc) ? k.calc : [k.calc]).filter(Boolean).join(' | ') })),
    } : null);
    w.render = () => {
      if (!w.result) return;
      el.replaceChildren(...w.result.items.map((k, i) => {
        const color = k.color || Theme.palette[i % Theme.palette.length];
        let delta = null;
        if (k.delta != null && Number.isFinite(k.delta)) {
          const good = k.invert ? k.delta < 0 : k.delta > 0;
          const cls = Math.abs(k.delta) < 0.05 ? 'flat' : good ? 'up' : 'down';
          delta = h('span', { class: `delta ${cls}`, title: `vs ${State.compareLabel()}${k.prev != null ? `: ${fmtN(k.prev)}` : ''}` }, `${k.delta > 0 ? '▲' : k.delta < 0 ? '▼' : '•'} ${fmtPct(Math.abs(k.delta), Math.abs(k.delta) < 10 ? 1 : 0)}`);
        } else if (k.prev === 0 && k.value > 0) {
          delta = h('span', { class: 'delta up', title: `vs ${State.compareLabel()}: 0` }, 'New');
        }
        return h('div', { class: 'kpi', role: 'listitem', style: { '--kpi-color': color }, title: k.help || null, dataset: { info: k.info || '' } },
          h('div', { class: 'kpi-label' }, h('span', null, k.label), k.info ? Info.button(k.label, () => Info.show(k.info, k.calc || [], k.label), 'kpi-info') : null),
          h('div', { class: 'kpi-row' },
            h('div', { class: 'kpi-value' }, k.display ?? fmtC(k.value), k.unit ? h('small', null, k.unit) : null),
            k.ring != null ? ring(k.ring, color) : k.spark && k.spark.length > 1 ? sparkline(k.spark, color) : null),
          h('div', { class: 'kpi-meta' }, delta, k.meta ? h('span', null, k.meta) : null));
      }));
    };
    w.run = async () => {
      const gen = ++w.gen;
      el.replaceChildren(...Array.from({ length: count }, () => h('div', { class: 'kpi skeleton' }, h('div', { class: 'kpi-label' }, '\u00a0'), h('div', { class: 'kpi-value' }, '\u00a0'), h('div', { class: 'kpi-meta' }, '\u00a0'))));
      try {
        const items = await load(w);
        if (gen !== w.gen) return;
        w.result = { items };
        w.render();
      } catch (e) {
        if (gen !== w.gen || isAbort(e)) return;
        if (e && e.status === 403 && String(e.path || '').includes('usageAnalytics')) App.uaForbidden();
        el.replaceChildren(h('div', { class: 'card span-12', style: { gridColumn: '1 / -1' } }, errorEl(e, () => w.run())));
      }
    };
    Widgets.register(tab, w);
    return w;
  }

  function grid(...cards) { return h('div', { class: 'grid' }, cards.map((c) => c.el || c)); }

  function panelIntro(title, sub, ...controls) {
    return h('div', { class: 'panel-intro' },
      h('div', null, h('h2', null, title), sub ? h('div', { class: 'sub' }, sub) : null),
      h('div', { class: 'grow' }),
      h('div', { class: 'panel-controls' }, ...controls));
  }

  function segmented(values, current, onChange, label, fmt = (v) => v) {
    return h('div', { class: 'segmented segmented-sm', role: 'radiogroup', 'aria-label': label },
      values.map((v) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(v === current), onclick: () => onChange(v) }, fmt(v))));
  }

  function selectEl(values, current, onChange, label, fmt = (v) => v) {
    const sel = h('select', { class: 'input', 'aria-label': label }, values.map((v) => h('option', { value: v, selected: String(v) === String(current) }, fmt(v))));
    sel.addEventListener('change', () => onChange(sel.value));
    return h('label', { class: 'inline' }, label, sel);
  }

  function runAll(tab) { Widgets.all(tab).forEach((w) => w.run()); }

  /* ────────────────────────────────────────────────────────────────────────
     Tab helpers
     ──────────────────────────────────────────────────────────────────────── */

  /** Lazily-shared promise that resets on failure (so Retry re-fetches). */
  function memo(fn) {
    let p = null;
    return () => {
      if (!p) { p = fn(); p.catch(() => { p = null; }); }
      return p;
    };
  }
  /** Swallow non-abort errors (optional data), keep aborts propagating. */
  const soft = (e) => { if (isAbort(e)) throw e; console.warn('[usage-dashboard] optional data unavailable:', e); return null; };
  const maWindow = (g) => ({ Day: 7, Week: 4, Month: 3, Quarter: 2 })[g] || 3;
  const titleCase = (v) => String(v).charAt(0) + String(v).slice(1).toLowerCase();
  const openAsset = (id) => { if (isUuid(id)) App.update({ tab: 'asset', asset: id }); };
  /** Add an item to the Compare tab selection (and switch to it). */
  function addToCompare(kind, id, label, { go = true } = {}) {
    const key = `${kind}:${id}`;
    if (label) State.labels.set(`item:${id}`, label);
    const items = State.s.items.includes(key) ? State.s.items : [...State.s.items, key];
    if (items.length > MAX_COMPARE) { toast(`Compare holds up to ${MAX_COMPARE} items. Remove one first.`, 'error'); return; }
    App.update({ items, ...(go ? { tab: 'compare' } : {}) });
    if (!go) toast(`Added ${label || kind} to Compare (${items.length}/${MAX_COMPARE})`, 'good');
  }

  /** Click-to-zoom into a time bucket (sets a custom range). */
  function zoomTo(row) {
    if (!row || row.startDate === row.endDate) return;
    App.update({ range: 'custom', from: row.startDate, to: row.endDate, g: 'Auto' });
    toast(`Zoomed to ${fmtRange(row.startDate, row.endDate)}`);
  }

  function compareOverlay(curRows, prevRows, key = 'total', name) {
    if (!prevRows) return null;
    return {
      name: name || `Total, ${State.compareLabel()}`,
      values: curRows.map((_, i) => (prevRows[i] ? prevRows[i][key] : null)),
      color: Theme.v('--text-3'),
      overlay: true,
      dashed: true,
    };
  }

  function maToggle(id) {
    const cb = h('input', { type: 'checkbox', checked: Prefs.get(id, 'ma', false) });
    cb.addEventListener('change', () => { Prefs.set(id, 'ma', cb.checked); App.rerun(id); });
    return h('label', { class: 'switch', title: 'Show a moving average trend line' }, cb, h('span', { class: 'track' }), 'Moving average');
  }

  function trendToggle(id) {
    const cb = h('input', { type: 'checkbox', checked: Prefs.get(id, 'trend', false) });
    cb.addEventListener('change', () => { Prefs.set(id, 'trend', cb.checked); App.rerun(id); });
    return h('label', { class: 'switch', title: 'Show a linear trend line and growth rate' }, cb, h('span', { class: 'track' }), 'Trend line');
  }
  const trendOn = (id) => Prefs.get(id, 'trend', false);

  /** Linear-fit overlay series + calc lines (slope, R², compound growth) for a value series. */
  function trendInfo(values, g, name = 'Trend', color = Theme.v('--accent') || Theme.palette[4]) {
    const fit = linearFit(values);
    const cg = compoundGrowth(values);
    const gl = g.toLowerCase();
    if (!fit) return { series: null, calc: ['Trend: needs at least 2 buckets.'] };
    return {
      series: { name: `${name} (linear trend)`, values: fit.fitted, color, overlay: true, dashed: true },
      calc: [
        `Trend (least-squares line): ${fit.slope >= 0 ? '+' : ''}${fmt1(fit.slope)} per ${gl} on an average of ${fmt1(fit.mean)} (${fit.mean ? `${fit.slope >= 0 ? '+' : ''}${fmt1((fit.slope / fit.mean) * 100)}%` : 'n/a'} of the average per ${gl}); R\u00b2 = ${fit.r2.toFixed(2)}${fit.r2 < 0.3 ? ' (weak fit: the trend explains little of the variation)' : ''}.`,
        cg ? `Compound growth: (${fmtN(cg.to)} \u00f7 ${fmtN(cg.from)})^(1 \u00f7 ${cg.periods}) \u2212 1 = ${cg.pct >= 0 ? '+' : ''}${fmt1(cg.pct)}% per ${gl}, between the first and last ${gl}s with activity.` : `Compound growth: needs activity in at least two ${gl}s.`,
      ],
    };
  }

  /** Toggle chips (multi-select), e.g. content types in Content mix. */
  function toggleChips(values, isOn, onToggle, label, colorOf) {
    return h('div', { class: 'toggle-chips', role: 'group', 'aria-label': label },
      values.map((v, i) => {
        const b = h('button', { type: 'button', class: 'toggle-chip', 'aria-pressed': String(isOn(v)), title: isOn(v) ? `Hide ${v}` : `Show ${v}`, onclick: () => onToggle(v) },
          h('span', { class: 'dot', 'aria-hidden': 'true' }), v);
        if (colorOf) b.style.setProperty('--chip-color', colorOf(v, i));
        return b;
      }));
  }

  /**
   * Multi-select list picker anchored to a button. opts: { title, load() → [{id,label,meta}],
   * selected: [], max?, onApply(ids), search? (q) → Promise<[{id,label,meta}]> for remote search }.
   */
  function openListPicker(btn, opts) {
    if (Menus.open && Menus.open.btn === btn) { Menus.close(); return; }
    const selected = new Set(opts.selected || []);
    const max = opts.max || Infinity;
    let list = null, remote = [], seq = 0;
    const known = new Map();
    const search = h('input', { type: 'search', placeholder: opts.placeholder || `Search ${opts.title.toLowerCase()}\u2026`, 'aria-label': `Search ${opts.title}` });
    const listEl = h('div', { class: 'picker-list' });
    const countEl = h('span', null);
    const setCount = () => { countEl.textContent = `${selected.size}${Number.isFinite(max) ? ` of ${max}` : ''} selected`; };
    const shown = () => {
      const q = search.value.trim().toLowerCase();
      const local = (list || []).filter((x) => !q || x.label.toLowerCase().includes(q) || String(x.meta || '').toLowerCase().includes(q));
      const ids = new Set(local.map((x) => x.id));
      const sel = [...selected].filter((id) => !ids.has(id)).map((id) => known.get(id) || { id, label: opts.labelOf ? opts.labelOf(id) : id });
      return [...sel, ...local, ...remote.filter((x) => !ids.has(x.id) && !selected.has(x.id))];
    };
    const draw = () => {
      if (!list) { listEl.replaceChildren(h('div', { class: 'menu-empty' }, h('span', { class: 'spinner sm' }), ' Loading\u2026')); return; }
      const items = shown();
      items.forEach((x) => known.set(x.id, x));
      if (!items.length) { listEl.replaceChildren(h('div', { class: 'menu-empty' }, search.value ? 'No matches' : opts.emptyText || 'Nothing to pick in this date range')); return; }
      listEl.replaceChildren(...items.slice(0, 500).map((x) => {
        const cb = h('input', { type: 'checkbox', checked: selected.has(x.id), disabled: !selected.has(x.id) && selected.size >= max });
        cb.addEventListener('change', () => {
          if (cb.checked) { if (selected.size >= max) { cb.checked = false; toast(`You can pick up to ${max}.`); return; } selected.add(x.id); } else selected.delete(x.id);
          setCount();
          listEl.querySelectorAll('input[type=checkbox]').forEach((i) => { i.disabled = !i.checked && selected.size >= max; });
        });
        return h('label', { class: 'picker-item' }, cb, h('span', null, x.label), x.meta ? h('span', { class: 'tag' }, x.meta) : null);
      }));
    };
    const doRemote = debounce(async () => {
      const q = search.value.trim();
      const my = ++seq;
      if (!opts.search || q.length < 2) { remote = []; draw(); return; }
      try { const r = await opts.search(q); if (my === seq) { remote = r; draw(); } } catch (e) { if (!isAbort(e)) { remote = []; draw(); } }
    }, 250);
    search.addEventListener('input', () => { draw(); doRemote(); });
    const apply = () => { Menus.close(); opts.onApply([...selected], known); };
    search.addEventListener('keydown', (e) => { if (e.key === 'Enter') apply(); });
    const menu = h('div', { class: 'menu picker', role: 'dialog', 'aria-label': opts.title, dataset: { temp: '1' } },
      h('div', { class: 'picker-head' }, search, h('div', { class: 'picker-tools' }, countEl,
        h('span', null, h('button', { type: 'button', onclick: () => { selected.clear(); setCount(); draw(); } }, 'Clear')))),
      listEl,
      h('div', { class: 'picker-foot' },
        opts.footNote ? h('span', { class: 'note', style: { marginRight: 'auto', padding: 0 } }, opts.footNote) : null,
        h('button', { class: 'btn btn-sm', type: 'button', onclick: () => Menus.close() }, 'Cancel'),
        h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: apply }, 'Apply')));
    Menus.close();
    btn.parentElement.append(menu);
    btn.setAttribute('aria-expanded', 'true');
    Menus.open = { btn, menu };
    setCount();
    draw();
    Promise.resolve(opts.load()).then((l) => { list = l || []; list.forEach((x) => known.set(x.id, x)); draw(); }, (e) => { if (!isAbort(e)) { list = []; draw(); } });
    setTimeout(() => search.focus(), 0);
  }

  /** Button that opens a list picker; shows the selection count. */
  function pickerButton(label, count, onOpen) {
    const btn = h('button', { class: `btn btn-sm filter-btn${count ? ' active' : ''}`, type: 'button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false' },
      h('span', null, label), h('span', { class: 'count', hidden: !count }, String(count)),
      s('svg', { class: 'caret', viewBox: '0 0 24 24', 'aria-hidden': 'true' }, s('path', { d: 'M7 10l5 5 5-5z', fill: 'currentColor' })));
    btn.addEventListener('click', () => onOpen(btn));
    return h('div', { class: 'menu-wrap' }, btn);
  }

  /** Small selection chip with a remove button. */
  function selChip(text, onRemove, meta) {
    return h('span', { class: 'chip' }, meta ? h('b', null, meta) : null, text,
      h('button', { type: 'button', 'aria-label': `Remove ${text}`, onclick: onRemove }, '\u2715'));
  }

  /** Values re-expressed for comparison: absolute, indexed (first non-zero = 100) or % of the series total. */
  function normalize(values, mode) {
    if (mode === 'index') {
      const base = values.find((v) => v > 0);
      return values.map((v) => (base ? (v / base) * 100 : null));
    }
    if (mode === 'pct') {
      const t = sum(values);
      return values.map((v) => (t ? (v / t) * 100 : 0));
    }
    return values;
  }

  const cumulative = (values) => { let a = 0; return values.map((v) => (a += v || 0)); };

  /** "Comparison: 3 → change +33.3%" line for info dialogs (null when not comparing). */
  function cmpCalc(cur, prev, fmt = fmtN) {
    const cr = State.compareRange();
    if (!cr || prev == null) return null;
    const d = pctChange(cur, prev);
    return `Comparison (${State.compareLabel()}, ${fmtRange(cr.startDate, cr.endDate)}): ${fmt(prev)}. Change = (${fmt(cur)} \u2212 ${fmt(prev)}) \u00f7 ${fmt(prev)} = ${d == null ? 'n/a (comparison is 0)' : `${d > 0 ? '+' : ''}${fmt1(d)}%`}.`;
  }

  /** Visits over time for one content kind: bars = visits, line (right axis) = distinct items visited per bucket. */
  function kindTrendCard(tab, id, kind, r, cr, g, span = 6) {
    const gl = g.toLowerCase();
    const nouns = pluralWord(kind.toLowerCase());
    return card(tab, {
      id, title: `${pluralWord(kind)} over time`, sub: `Bars: ${kind.toLowerCase()} visits per ${gl} \u00b7 line (right axis): distinct ${nouns} visited`, span, height: 260, chartTypes: ['bar', 'line', 'area'],
      load: async () => {
        const [cur, prev, items] = await Promise.all([Data.contentTrend(r, g), cr ? Data.contentTrend(cr, g) : null, Data.itemSeries(kind, r, g).catch(soft)]);
        const visits = cur.rows.map((x) => x[kind]);
        const total = sum(visits);
        const prevTotal = prev ? sum(prev.rows, (x) => x[kind]) : null;
        const distinctAll = items ? items.items.length : null;
        const series = [{ name: `${kind} visits`, values: visits, color: colorFor(kind) }];
        if (items) series.push({ name: `Distinct ${nouns} visited`, values: items.distinct, color: Theme.palette[5], y2: true });
        const ov = compareOverlay(cur.rows, prev && prev.rows, kind, `${kind} visits, ${State.compareLabel()}`);
        if (ov) series.push(ov);
        const tr = trendOn(id) ? trendInfo(visits, g, `${kind} visits`) : null;
        if (tr && tr.series) series.push(tr.series);
        const delta = prevTotal != null ? pctChange(total, prevTotal) : null;
        let peak = -1;
        visits.forEach((v, i) => { if (peak < 0 || v > visits[peak]) peak = i; });
        const calc = [
          `${fmtN(total)} ${kind.toLowerCase()} visits over ${plural(cur.rows.length, `${gl} bucket`)} = ${fmt1(cur.rows.length ? total / cur.rows.length : 0)} per ${gl} on average.`,
          distinctAll != null ? `${plural(distinctAll, `distinct ${kind.toLowerCase()}`)} received at least one visit in the whole range. Per-${gl} distinct counts are on the right axis; adding them up counts an item once per ${gl} it was visited.` : 'Distinct counts aren\u2019t available (the row-level download failed).',
          peak >= 0 && visits[peak] ? `Busiest ${gl}: ${cur.rows[peak].full} with ${fmtN(visits[peak])} visits${items ? ` to ${plural(items.distinct[peak], kind.toLowerCase())}` : ''}.` : null,
          cmpCalc(total, prevTotal),
          ...(tr ? tr.calc : []),
        ];
        if (!total) return { empty: { title: `No ${kind.toLowerCase()} visits`, text: `No ${nouns} were visited in this period with the current filters.` }, calc };
        return {
          stats: [
            { label: `${kind} visits`, value: total, primary: true },
            { label: `Distinct ${nouns}`, value: distinctAll, display: distinctAll == null ? '\u2013' : fmtN(distinctAll), hint: 'Visited at least once in the range' },
            { label: `Visits per ${kind.toLowerCase()}`, value: distinctAll ? total / distinctAll : null, display: distinctAll ? fmt1(total / distinctAll) : '\u2013', hint: `${kind} visits \u00f7 distinct ${nouns} visited` },
            { label: `vs ${State.compareLabel()}`, value: delta, display: delta == null ? '\u2013' : `${delta > 0 ? '+' : ''}${fmt1(delta)}%`, hint: prevTotal != null ? `Comparison: ${fmtN(prevTotal)} visits` : 'No comparison' },
          ],
          spec: { kind: 'series', mode: 'bar', title: `${pluralWord(kind)} over time`, height: 260, legend: 'always', categories: catsOf(cur.rows), series, onClick: (i) => zoomTo(cur.rows[i]) },
          dataset: {
            columns: [
              { key: 'period', label: 'Period' }, { key: 'start', label: 'Start', type: 'date' }, { key: 'end', label: 'End', type: 'date' },
              { key: 'visits', label: `${kind} visits`, type: 'number' }, { key: 'distinct', label: `Distinct ${nouns} visited`, type: 'number' },
              { key: 'prev', label: `${kind} visits, ${State.compareLabel()}`, type: 'number', hidden: !prev },
            ],
            rows: cur.rows.map((x, i) => ({ period: x.label, start: x.startDate, end: x.endDate, visits: x[kind], distinct: items ? items.distinct[i] : null, prev: prev && prev.rows[i] ? prev.rows[i][kind] : null })),
          },
          extraOptions: () => [trendToggle(id),
            kind === 'Dashboard'
              ? h('button', { class: 'btn btn-ghost btn-xs', type: 'button', onclick: () => App.update({ tab: 'dashboards' }) }, 'Dashboard details \u2192')
              : h('button', { class: 'btn btn-ghost btn-xs', type: 'button', onclick: () => App.update({ tab: 'content', ctype: kind }) }, `${pluralWord(kind)} in Content \u2192`)],
          calc,
        };
      },
    });
  }

  /** Deduplicated active users: headline distinct count, user-days, and a cumulative-unique line. */
  function uniqueActiveCard(tab, id, r, g, span = 6) {
    const gl = g.toLowerCase();
    return card(tab, {
      id, info: 'uniqueActive', title: 'Unique active users', sub: `Each person counted once \u00b7 bars: active per ${gl} \u00b7 line: running total of people`, span, height: 240, chartTypes: ['bar', 'line', 'area'],
      load: async () => {
        const u = await Data.uniqueActive(r, g);
        const last = u.buckets.length ? u.buckets[u.buckets.length - 1].cumulative : 0;
        const people = (n) => `${fmtN(n)} ${n === 1 ? 'person' : 'people'}`;
        const calc = [
          `Unique active users: ${people(u.unique)} signed in at least once (Collibra\u2019s distinct count by user ID).`,
          `User-days: ${fmtN(u.userDays)}. Adding up each day\u2019s active users counts a person once per day they were active.`,
          `Average daily active users = ${fmtN(u.userDays)} user-days \u00f7 ${fmtN(u.days)} days = ${fmt1(u.avgDaily)}.`,
          `Active days: ${fmtN(u.activeDays)} of ${fmtN(u.days)} days had at least one active user.`,
          u.unique ? `On average each person was active on ${fmt1(u.userDays / u.unique)} of those days.` : null,
          g !== 'Day' ? `The ${gl}ly bars add up to ${fmtN(u.userBuckets)} user-${gl}s; the running-total line ends at ${people(last)}.` : `The running-total line ends at ${people(last)}.`,
          u.unique ? `Stickiness = avg daily active \u00f7 unique active users = ${fmt1(u.avgDaily)} \u00f7 ${fmtN(u.unique)} = ${fmtPct((u.avgDaily / u.unique) * 100)}. On an average day, that share of this period\u2019s users signed in.` : null,
        ];
        const mismatch = u.downloadDistinct !== u.unique;
        if (mismatch) calc.push(`The row-level download (deduplicated by name) has ${people(u.downloadDistinct)}, while Collibra\u2019s count by user ID is ${fmtN(u.unique)}. The headline uses Collibra\u2019s count; the chart uses the download.`);
        const stats = [
          { label: 'Unique active users', value: u.unique, primary: true, hint: 'Distinct people with at least one sign-in in the period' },
          { label: 'User-days', value: u.userDays, hint: 'Sum of daily active users: not deduplicated across days' },
          { label: 'Avg daily active', value: u.avgDaily, display: fmt1(u.avgDaily), hint: 'User-days \u00f7 days in range' },
          { label: 'Active days', value: u.activeDays, display: `${fmtN(u.activeDays)} / ${fmtN(u.days)}`, hint: 'Days with at least one active user' },
          { label: 'Stickiness', value: u.unique ? (u.avgDaily / u.unique) * 100 : null, display: u.unique ? fmtPct((u.avgDaily / u.unique) * 100) : '\u2013', hint: 'Avg daily active \u00f7 unique active users in the range (DAU \u00f7 range uniques)' },
        ];
        if (!u.unique && !u.userDays) return { empty: { title: 'No active users', text: 'Nobody signed in to Collibra in this period with the current filters.' }, calc };
        const series = [
          { name: `Active users per ${gl}`, values: u.buckets.map((b) => b.active), color: colorFor('Active') },
          { name: 'Running total of unique people', values: u.buckets.map((b) => b.cumulative), color: Theme.palette[5], overlay: true },
        ];
        const rows = [
          ...u.buckets.map((b) => ({ period: b.label, start: b.startDate, end: b.endDate, active: b.active, userDays: b.userDays, newUnique: b.newUnique, cumulative: b.cumulative })),
          { period: 'Whole range (deduplicated)', start: r.startDate, end: r.endDate, active: u.unique, userDays: u.userDays, newUnique: u.downloadDistinct, cumulative: last },
        ];
        return {
          stats,
          calc,
          spec: { kind: 'series', mode: 'bar', title: 'Unique active users', height: 240, legend: 'always', categories: catsOf(u.buckets), series, emptyText: 'No active users in this period', onClick: (i) => zoomTo(u.buckets[i]) },
          dataset: {
            columns: [
              { key: 'period', label: 'Period' }, { key: 'start', label: 'Start', type: 'date' }, { key: 'end', label: 'End', type: 'date' },
              { key: 'active', label: 'Distinct active users', type: 'number' }, { key: 'userDays', label: 'User-days', type: 'number' },
              { key: 'newUnique', label: 'First seen in range', type: 'number' }, { key: 'cumulative', label: 'Running total of unique people', type: 'number' },
            ],
            rows,
          },
          note: mismatch ? 'Chart counts people by display name; the headline uses Collibra\u2019s count by user ID. Open \u24d8 for details.' : null,
        };
      },
    });
  }

  /* ────────────────────────────────────────────────────────────────────────
     Tab: Overview
     ──────────────────────────────────────────────────────────────────────── */

  function buildOverview(panel) {
    const T = 'overview';
    const r = State.range(), cr = State.compareRange(), g = State.gran();
    panel.append(panelIntro('Overview', `${fmtRange(r.startDate, r.endDate)} · ${g} granularity${cr ? ` · compared with ${State.compareLabel()} (${fmtRange(cr.startDate, cr.endDate)})` : ''}`));

    const kpis = kpiStrip(T, {
      id: 'ov-kpis',
      count: 6,
      load: async () => {
        const [c0, c1, u0, u1, trend, active, assets, assetsPrev, totals] = await Promise.all([
          Data.contentSummary(r), cr ? Data.contentSummary(cr) : null,
          Data.userSummary(r), cr ? Data.userSummary(cr) : null,
          Data.contentTrend(r, g),
          Data.userTrend('license', r, g, 'Active').catch(soft),
          Data.contentDetail('Asset', r).catch(soft),
          cr ? Data.contentDetail('Asset', cr).catch(soft) : null,
          Data.catalogTotals().catch(soft),
        ]);
        const vpu = u0.Active ? c0.total / u0.Active : 0;
        const vpuPrev = u1 && u1.Active ? c1.total / u1.Active : (u1 ? 0 : null);
        const nAssets = assets ? assets.length : null;
        const coverage = nAssets != null && totals && totals.assets ? (nAssets / totals.assets) * 100 : null;
        const sparkSum = active ? sum(active.rows, (x) => x.total) : null;
        const typeSum = UA.TYPES.map((t) => `${t} ${fmtN(c0[t])}`).join(' + ');
        return [
          { label: 'Total visits', info: 'totalVisits', value: c0.total, prev: c1?.total, delta: c1 ? pctChange(c0.total, c1.total) : null, spark: trend.rows.map((x) => x.total), color: Theme.palette[0], meta: `${fmtN(c0.Asset)} assets · ${fmtN(c0.Dashboard)} dashboards`,
            calc: [`${fmtN(c0.total)} visits = ${typeSum}.`, cmpCalc(c0.total, c1?.total)] },
          { label: 'Active users', info: 'activeUsers', value: u0.Active, prev: u1?.Active, delta: u1 ? pctChange(u0.Active, u1.Active) : null, spark: active ? active.rows.map((x) => x.total) : null, color: Theme.palette[1], meta: totals && totals.users ? `of ${fmtN(totals.users)} enabled users` : '',
            calc: [`${fmtN(u0.Active)} distinct ${u0.Active === 1 ? 'person' : 'people'} signed in at least once. Each person is counted once.`,
              sparkSum != null && sparkSum !== u0.Active ? `The sparkline\u2019s ${g.toLowerCase()} buckets add up to ${fmtN(sparkSum)}, because a person active in several buckets is counted in each one.` : null,
              totals && totals.users ? `${fmtN(u0.Active)} of ${fmtN(totals.users)} enabled accounts = ${fmtPct((u0.Active / totals.users) * 100)}.` : null,
              cmpCalc(u0.Active, u1?.Active)] },
          { label: 'New users', info: 'newUsers', value: u0.New, prev: u1?.New, delta: u1 ? pctChange(u0.New, u1.New) : null, color: Theme.palette[5], meta: 'first visit in period',
            calc: [`${fmtN(u0.New)} distinct ${u0.New === 1 ? 'person' : 'people'} signed in for the first time ever in this period.`, cmpCalc(u0.New, u1?.New)] },
          { label: 'Visits per active user', info: 'visitsPerUser', value: vpu, display: fmt1(vpu), prev: vpuPrev, delta: vpuPrev != null ? pctChange(vpu, vpuPrev) : null, color: Theme.palette[3],
            calc: [u0.Active ? `${fmtN(c0.total)} visits \u00f7 ${fmtN(u0.Active)} active users = ${fmt1(vpu)}.` : 'No active users, so the ratio is 0.', cmpCalc(vpu, vpuPrev, fmt1)] },
          { label: 'Assets visited', info: 'assetsVisited', value: nAssets, prev: assetsPrev ? assetsPrev.length : null, delta: assetsPrev ? pctChange(nAssets, assetsPrev.length) : null, color: Theme.palette[2], meta: 'distinct assets',
            calc: assets ? [`${fmtN(nAssets)} distinct assets received ${fmtN(sum(assets, (x) => x.visits))} asset visits in total.`, cmpCalc(nAssets, assetsPrev ? assetsPrev.length : null)] : [] },
          { label: 'Catalog coverage', info: 'coverage', value: coverage, display: coverage == null ? '–' : fmtPct(coverage, coverage < 1 ? 2 : 1), ring: coverage ?? 0, color: Theme.palette[7], meta: totals && nAssets != null ? `${fmtN(nAssets)} of ${fmtN(totals.assets)} assets` : '', metaText: 'Distinct assets visited / total assets',
            calc: coverage != null ? [`${fmtN(nAssets)} assets visited \u00f7 ${fmtN(totals.assets)} assets in Collibra \u00d7 100 = ${fmtPct(coverage, 2)}.`] : [] },
        ];
      },
    });

    const selTypes = () => UA.TYPES.filter((t) => !State.s.mixOff.includes(t));
    const toggleMix = (t) => {
      const off = new Set(State.s.mixOff);
      if (off.has(t)) off.delete(t);
      else if (UA.TYPES.length - off.size <= 1) { toast('Keep at least one content type selected.'); return; }
      else off.add(t);
      App.update({ mixOff: UA.TYPES.filter((x) => off.has(x)) });
    };
    const mixNote = (types) => (types.length < UA.TYPES.length ? `Included content types: ${types.join(', ')}. Excluded: ${UA.TYPES.filter((t) => !types.includes(t)).join(', ')}.` : 'All five content types are included.');

    const trend = card(T, {
      id: 'ov-trend', title: 'Visits over time', sub: 'By content type \u00b7 follows the Content mix selection \u00b7 click a period to zoom in', span: 8, height: 320, chartTypes: ['area', 'bar', 'line'], stackable: true,
      load: async () => {
        const types = selTypes();
        const selSum = (x) => sum(types, (t) => x[t]);
        const [cur, prev] = await Promise.all([Data.contentTrend(r, g), cr ? Data.contentTrend(cr, g) : null]);
        const totals = cur.rows.map(selSum);
        const series = types.map((t) => ({ name: t, values: cur.rows.map((x) => x[t]), color: colorFor(t, UA.TYPES.indexOf(t)) }));
        if (prev) series.push({ name: `Total, ${State.compareLabel()}`, values: cur.rows.map((_, i) => (prev.rows[i] ? selSum(prev.rows[i]) : null)), color: Theme.v('--text-3'), overlay: true, dashed: true });
        const tr = trendOn('ov-trend') ? trendInfo(totals, g, 'Total') : null;
        if (tr && tr.series) series.push(tr.series);
        let peak = -1;
        totals.forEach((v, i) => { if (peak < 0 || v > totals[peak]) peak = i; });
        return {
          spec: { kind: 'series', mode: 'area', stacked: true, title: 'Visits over time', height: 320, categories: catsOf(cur.rows), series, onClick: (i) => zoomTo(cur.rows[i]) },
          extraOptions: () => [trendToggle('ov-trend')],
          calc: [
            mixNote(types),
            `${plural(cur.rows.length, `${g.toLowerCase()} bucket`)}; ${fmtN(sum(totals))} visits in total.`,
            peak >= 0 && totals[peak] ? `Busiest bucket: ${cur.rows[peak].full} with ${fmtN(totals[peak])} visits.` : null,
            prev ? `Comparison total: ${fmtN(sum(prev.rows, selSum))} visits.` : null,
            ...(tr ? tr.calc : []),
          ],
        };
      },
    });

    const mix = card(T, {
      id: 'ov-mix', title: 'Content mix', sub: 'Share of visits \u00b7 toggle types below \u00b7 click a slice to explore', span: 4, height: 260,
      load: async () => {
        const c = await Data.contentSummary(r);
        const types = selTypes();
        const selTotal = sum(types, (t) => c[t]);
        const items = types.map((t) => ({ label: t, value: c[t], color: colorFor(t, UA.TYPES.indexOf(t)) }));
        const rows = UA.TYPES.map((t) => ({
          label: t, included: types.includes(t) ? 'Yes' : 'No', value: c[t],
          share: types.includes(t) && selTotal ? (c[t] / selTotal) * 100 : null,
          shareAll: c.total ? (c[t] / c.total) * 100 : 0,
        }));
        return {
          spec: { kind: 'donut', title: 'Content mix', items, centerLabel: types.length < UA.TYPES.length ? 'selected visits' : 'visits', valueLabel: 'Visits', onClick: (it) => App.update({ tab: 'content', ctype: it.label }) },
          dataset: {
            columns: [{ key: 'label', label: 'Content type' }, { key: 'included', label: 'Included' }, { key: 'value', label: 'Visits', type: 'number' },
              { key: 'share', label: 'Share of selected %', type: 'pct' }, { key: 'shareAll', label: 'Share of all visits %', type: 'pct' }],
            rows,
          },
          extraOptions: () => [toggleChips(UA.TYPES, (t) => !State.s.mixOff.includes(t), toggleMix, 'Content types in the mix', (t, i) => colorFor(t, i))],
          calc: [
            mixNote(types),
            ...items.map((x) => `${x.label}: ${fmtN(x.value)} \u00f7 ${fmtN(selTotal)} = ${fmtPct(selTotal ? (x.value / selTotal) * 100 : 0)}`),
            types.length < UA.TYPES.length ? `The selected types account for ${fmtN(selTotal)} of ${fmtN(c.total)} visits (${fmtPct(c.total ? (selTotal / c.total) * 100 : 0)}).` : null,
          ],
        };
      },
    });

    const dashTrend = kindTrendCard(T, 'ov-dash-trend', 'Dashboard', r, cr, g);
    const diagTrend = kindTrendCard(T, 'ov-diag-trend', 'Diagram', r, cr, g);

    const topAssets = card(T, {
      id: 'ov-top-assets', title: 'Most visited assets', sub: 'Click to open in Asset Explorer', span: 4,
      load: async () => {
        const top = await Data.contentTop('Asset', 10, r);
        if (!top.length) return { empty: { title: 'No asset visits', text: 'No asset pages were visited in this period.' } };
        const ctx = await Data.assetContext(top.map((x) => x.id)).catch(soft) || new Map();
        const rows = top.map((x) => ({ ...x, ...(ctx.get(x.id) ? { type: ctx.get(x.id).type, domain: ctx.get(x.id).domain, community: ctx.get(x.id).community } : {}) }));
        return {
          spec: { kind: 'hbar', title: 'Most visited assets', valueLabel: 'Visits', color: colorFor('Asset'), items: rows.map((x) => ({ label: x.name, value: x.visits, sub: [x.type, x.domain, x.community].filter(Boolean).join(' · '), onClick: () => openAsset(x.id) })) },
          dataset: { columns: [{ key: 'rank', label: '#', type: 'number' }, { key: 'name', label: 'Asset', link: (x) => Env.assetUrl(x.id) }, { key: 'type', label: 'Asset type' }, { key: 'domain', label: 'Domain' }, { key: 'community', label: 'Community' }, { key: 'visits', label: 'Visits', type: 'number', bar: true }], rows },
          tableOpts: { onRowClick: (x) => openAsset(x.id) },
          calc: [`Showing ${plural(rows.length, 'asset')}; #1 is \u201c${rows[0].name}\u201d with ${plural(rows[0].visits, 'visit')}.`, `These ${fmtN(rows.length)} assets account for ${fmtN(sum(rows, (x) => x.visits))} visits.`],
        };
      },
    });

    const topDash = card(T, {
      id: 'ov-top-dash', title: 'Most visited dashboards', sub: 'Click to open the dashboard', span: 4,
      load: async () => {
        const top = await Data.contentTop('Dashboard', 10, r);
        if (!top.length) return { empty: { title: 'No dashboard visits', text: 'No dashboards were visited in this period.' } };
        return {
          spec: { kind: 'hbar', title: 'Most visited dashboards', valueLabel: 'Visits', color: colorFor('Dashboard'), items: top.map((x) => ({ label: x.name, value: x.visits, onClick: () => window.open(Env.dashboardUrl(x.id), '_blank', 'noopener') })) },
          dataset: { columns: [{ key: 'rank', label: '#', type: 'number' }, { key: 'name', label: 'Dashboard', link: (x) => Env.dashboardUrl(x.id) }, { key: 'visits', label: 'Visits', type: 'number', bar: true }], rows: top },
          calc: [`Showing ${plural(top.length, 'dashboard')}; #1 is \u201c${top[0].name}\u201d with ${plural(top[0].visits, 'visit')}.`, `These dashboards account for ${fmtN(sum(top, (x) => x.visits))} visits.`],
        };
      },
    });

    const topUsers = card(T, {
      id: 'ov-top-users', title: 'Most active users', sub: 'By number of visits', span: 4,
      load: async () => {
        const top = await Data.userTop(10, r);
        if (!top.length) return { empty: { title: 'No active users', text: 'Nobody visited Collibra in this period with the current filters.' } };
        return {
          spec: { kind: 'hbar', title: 'Most active users', valueLabel: 'Visits', color: colorFor('Active'), items: top.map((x) => ({ label: x.name, value: x.visits })) },
          dataset: { columns: [{ key: 'rank', label: '#', type: 'number' }, { key: 'name', label: 'User', link: (x) => (isUuid(x.id) ? Env.userUrl(x.id) : null) }, { key: 'visits', label: 'Visits', type: 'number', bar: true }], rows: top },
          calc: [`Showing ${plural(top.length, 'person')} (each once); #1 is ${top[0].name} with ${plural(top[0].visits, 'visit')}.`, `Together they made ${fmtN(sum(top, (x) => x.visits))} visits.`],
        };
      },
    });

    const activeUsers = card(T, {
      id: 'ov-active-users', title: 'Active users over time', sub: `Distinct users per ${g.toLowerCase()}, by license type \u00b7 a user active in several ${g.toLowerCase()}s is counted in each`, span: 6, height: 280, chartTypes: ['bar', 'area', 'line'], stackable: true,
      load: async () => {
        const t = await Data.userTrend('license', r, g, 'Active');
        const series = t.categories.map((c, i) => ({ name: c, values: t.rows.map((x) => x[c]), color: colorFor(c, i) }));
        const bucketSum = sum(t.rows, (x) => x.total);
        const peak = t.rows.reduce((a, x) => (x.total > (a ? a.total : -1) ? x : a), null);
        return {
          spec: { kind: 'series', mode: 'bar', stacked: true, title: 'Active users over time', height: 280, legend: 'always', categories: catsOf(t.rows), series, emptyText: 'No active users in this period', onClick: (i) => zoomTo(t.rows[i]) },
          calc: [
            peak && peak.total ? `Busiest ${g.toLowerCase()}: ${peak.full} with ${fmtN(peak.total)} distinct active users.` : 'No active users in any bucket.',
            `Adding up all ${fmtN(t.rows.length)} buckets gives ${fmtN(bucketSum)} user-${g.toLowerCase()}s. That is not the number of people; see \u201cUnique active users\u201d for the deduplicated count.`,
            t.categories.length ? `License types shown: ${t.categories.join(', ')}.` : null,
          ],
        };
      },
    });

    const unique = uniqueActiveCard(T, 'ov-unique', r, g);

    const communities = card(T, {
      id: 'ov-communities', title: 'Top communities', sub: 'Asset visits by community · click to filter', span: 12,
      load: async () => {
        const detail = await Data.contentDetail('Asset', r);
        const m = new Map();
        for (const x of detail) {
          const k = x.communityId || x.community || '(none)';
          const e = m.get(k) || { id: x.communityId, name: x.community || '(no community)', visits: 0, assets: 0 };
          e.visits += x.visits; e.assets++;
          m.set(k, e);
        }
        const rows = [...m.values()].sort((a, b) => b.visits - a.visits);
        if (!rows.length) return { empty: { title: 'No asset visits', text: 'No asset pages were visited in this period.' } };
        return {
          spec: {
            kind: 'hbar', title: 'Top communities', valueLabel: 'Asset visits', color: colorFor('Community'),
            items: rows.slice(0, 10).map((x) => ({ label: x.name, value: x.visits, sub: `${fmtN(x.assets)} distinct assets`, onClick: isUuid(x.id) ? () => { App.update({ f: { ...State.s.f, orgs: uniq([...State.s.f.orgs, x.id]) } }); State.labels.set(`orgs:${x.id}`, x.name); toast(`Filtered to ${x.name}`); } : null })),
          },
          dataset: { columns: [{ key: 'name', label: 'Community', link: (x) => Env.urlFor('Community', x.id) }, { key: 'assets', label: 'Distinct assets', type: 'number' }, { key: 'visits', label: 'Asset visits', type: 'number', bar: true }], rows },
          calc: [`${fmtN(sum(rows, (x) => x.visits))} asset visits across ${plural(detail.length, 'distinct asset')} in ${plural(rows.length, 'community')}.`, `Top: ${rows[0].name} with ${fmtN(rows[0].visits)} visits to ${plural(rows[0].assets, 'asset')}.`],
        };
      },
    });

    panel.append(kpis.el, grid(trend, mix), grid(dashTrend, diagTrend), grid(unique, activeUsers), grid(topAssets, topDash, topUsers), grid(communities));
    runAll(T);
  }

  /* ────────────────────────────────────────────────────────────────────────
     Tab: Content
     ──────────────────────────────────────────────────────────────────────── */

  function buildContent(panel) {
    const T = 'content';
    const r = State.range(), cr = State.compareRange(), g = State.gran();
    const type = State.s.ctype;
    const types = type === 'All' ? UA.TYPES : [type];
    const label = type === 'All' ? 'content items' : pluralWord(type.toLowerCase());

    panel.append(panelIntro('Content usage', `Visits to ${type === 'All' ? 'all content' : label} · ${fmtRange(r.startDate, r.endDate)}`,
      segmented(['All', ...UA.TYPES], type, (v) => App.update({ ctype: v }), 'Content type', (v) => (v === 'All' ? 'All content' : pluralWord(v)))));

    const detail = memo(() => (type === 'All' ? Data.contentDetailAll(r) : Data.contentDetail(type, r)));
    const detailPrev = memo(() => (cr ? (type === 'All' ? Data.contentDetailAll(cr) : Data.contentDetail(type, cr)) : Promise.resolve(null)));

    const trend = card(T, {
      id: 'ct-trend', title: `Visits over time — ${type === 'All' ? 'all content' : pluralWord(type)}`, sub: 'Click a period to zoom in', span: 12, height: 320, chartTypes: ['line', 'area', 'bar'], stackable: true,
      load: async () => {
        const [cur, prev] = await Promise.all([Data.contentTrend(r, g), cr ? Data.contentTrend(cr, g) : null]);
        const series = types.map((t) => ({ name: t, values: cur.rows.map((x) => x[t]), color: colorFor(t) }));
        const totalKey = type === 'All' ? 'total' : type;
        const ov = compareOverlay(cur.rows, prev && prev.rows, totalKey, `${type === 'All' ? 'Total' : type}, ${State.compareLabel()}`);
        if (ov) series.push(ov);
        if (Prefs.get('ct-trend', 'ma', false)) {
          const n = maWindow(g);
          series.push({ name: `${n}-${g.toLowerCase()} moving average`, values: movingAverage(cur.rows.map((x) => x[totalKey]), n), color: Theme.v('--warn'), overlay: true });
        }
        const tr = trendOn('ct-trend') ? trendInfo(cur.rows.map((x) => x[totalKey]), g, type === 'All' ? 'Total' : type) : null;
        if (tr && tr.series) series.push(tr.series);
        return {
          spec: { kind: 'series', mode: type === 'All' ? 'area' : 'line', stacked: type === 'All', title: 'Visits over time', height: 320, categories: catsOf(cur.rows), series, onClick: (i) => zoomTo(cur.rows[i]) },
          extraOptions: () => [maToggle('ct-trend'), trendToggle('ct-trend')],
          calc: [
            `Content: ${type === 'All' ? 'all types' : pluralWord(type)}. ${fmtN(sum(cur.rows, (x) => x[totalKey]))} visits over ${plural(cur.rows.length, `${g.toLowerCase()} bucket`)}.`,
            `Average per bucket: ${fmt1(cur.rows.length ? sum(cur.rows, (x) => x[totalKey]) / cur.rows.length : 0)} visits.`,
            prev ? `Comparison period: ${fmtN(sum(prev.rows, (x) => x[totalKey]))} visits.` : null,
            Prefs.get('ct-trend', 'ma', false) ? `Moving average window: ${maWindow(g)} ${g.toLowerCase()}s.` : null,
            ...(tr ? tr.calc : []),
          ],
        };
      },
    });

    const heat = card(T, {
      id: 'ct-heatmap', title: 'Daily visit calendar', sub: 'Visits per day, by weekday and week', span: 7, height: 220,
      load: async () => {
        const start = daysInclusive(r.startDate, r.endDate) > 371 ? addDays(r.endDate, -370) : r.startDate;
        const range = { startDate: start, endDate: r.endDate };
        const daily = await Data.contentTrend(range, 'Day');
        const byDay = new Map(daily.rows.map((x) => [x.startDate, sum(types, (t) => x[t])]));
        const weeks = makeBuckets(start, r.endDate, 'Week');
        const values = WEEKDAYS.map((_, wd) => weeks.map((wk) => {
          const day = addDays(wk.bucketStartDate, wd);
          return day < start || day > r.endDate ? null : byDay.get(day) || 0;
        }));
        const rows = daily.rows.map((x) => ({ date: x.startDate, weekday: WEEKDAYS[weekdayIdx(x.startDate)], visits: sum(types, (t) => x[t]) }));
        return {
          spec: {
            kind: 'heatmap', title: 'Daily visit calendar', rows: WEEKDAYS, cols: weeks.map((wk) => fmtDateShort(wk.bucketStartDate)), values,
            cellTip: (i, j, v) => { const day = addDays(weeks[j].bucketStartDate, i); return `<div class="tt-title">${esc(WEEKDAYS[i])}, ${esc(fmtDate(day))}</div>${ttRow('', 'Visits', fmtN(v))}`; },
          },
          dataset: { columns: [{ key: 'date', label: 'Date', type: 'date' }, { key: 'weekday', label: 'Weekday' }, { key: 'visits', label: 'Visits', type: 'number' }], rows },
          note: start !== r.startDate ? 'Showing the most recent 53 weeks of the selected range.' : null,
          calc: (() => {
            const best = rows.reduce((a, x) => (x.visits > (a ? a.visits : -1) ? x : a), null);
            return [
              `${plural(rows.length, 'day')} shown, ${fmtN(rows.filter((x) => x.visits > 0).length)} with at least one visit; ${fmtN(sum(rows, (x) => x.visits))} visits in total.`,
              best && best.visits ? `Busiest day: ${best.weekday} ${fmtDate(best.date)} with ${plural(best.visits, 'visit')}.` : null,
            ];
          })(),
        };
      },
    });

    const weekday = card(T, {
      id: 'ct-weekday', title: 'Weekday profile', sub: 'Average visits per weekday', span: 5, height: 220,
      load: async () => {
        const daily = await Data.contentTrend(r, 'Day');
        const tot = new Array(7).fill(0), cnt = new Array(7).fill(0);
        for (const x of daily.rows) { const i = weekdayIdx(x.startDate); tot[i] += sum(types, (t) => x[t]); cnt[i]++; }
        const avg = tot.map((v, i) => (cnt[i] ? v / cnt[i] : 0));
        return {
          spec: { kind: 'series', mode: 'bar', title: 'Weekday profile', height: 220, integer: false, valueFormat: fmt1, categories: WEEKDAYS.map((d) => ({ label: d, full: `${d} (${cnt[WEEKDAYS.indexOf(d)]} days)` })), series: [{ name: 'Average visits', values: avg, color: type === 'All' ? Theme.palette[0] : colorFor(type) }] },
          dataset: { columns: [{ key: 'day', label: 'Weekday' }, { key: 'days', label: 'Days in range', type: 'number' }, { key: 'total', label: 'Total visits', type: 'number' }, { key: 'avg', label: 'Average visits', type: 'number' }], rows: WEEKDAYS.map((d, i) => ({ day: d, days: cnt[i], total: tot[i], avg: Math.round(avg[i] * 100) / 100 })) },
          calc: WEEKDAYS.map((d, i) => `${d}: ${fmtN(tot[i])} visits \u00f7 ${plural(cnt[i], 'day')} = ${fmt1(avg[i])}`),
        };
      },
    });

    const tree = card(T, {
      id: 'ct-treemap', title: 'Where visits happen', sub: type === 'Community' ? 'Visits by community' : type === 'Dashboard' ? '' : 'Visits by domain, grouped by community', span: 7, height: 340,
      load: async () => {
        if (type === 'Dashboard') return { empty: { title: 'Not applicable', text: 'Dashboards aren\u2019t organized into communities and domains.' } };
        const src = type === 'All' ? await Data.contentDetail('Asset', r) : await detail();
        const m = new Map();
        for (const x of src) {
          const key = type === 'Community' ? x.id : x.domainId || x.domain || '(none)';
          const e = m.get(key) || { label: type === 'Community' ? x.name : x.domain || '(no domain)', group: x.community || '(no community)', value: 0, id: type === 'Community' ? x.id : x.domainId };
          e.value += x.visits;
          m.set(key, e);
        }
        const items = [...m.values()];
        if (!items.length) return { empty: { title: 'No visits', text: `No ${label} visits in this period.` } };
        return {
          spec: { kind: 'treemap', title: 'Where visits happen', height: 340, items, valueLabel: 'Visits', onClick: (it) => { const url = Env.urlFor(type === 'Community' ? 'Community' : 'Domain', it.id); if (url) window.open(url, '_blank', 'noopener'); } },
          dataset: { columns: [{ key: 'label', label: type === 'Community' ? 'Community' : 'Domain', link: (x) => Env.urlFor(type === 'Community' ? 'Community' : 'Domain', x.id) }, { key: 'group', label: 'Community' }, { key: 'value', label: 'Visits', type: 'number', bar: true }], rows: items.sort((a, b) => b.value - a.value) },
          note: type === 'All' ? 'Based on asset visits.' : null,
          calc: [`${fmtN(sum(items, (x) => x.value))} ${type === 'All' ? 'asset ' : ''}visits grouped into ${plural(items.length, type === 'Community' ? 'community' : 'domain')}.`, `Largest: ${items[0].label} with ${fmtN(items[0].value)} visits (${fmtPct((items[0].value / (sum(items, (x) => x.value) || 1)) * 100)}).`],
        };
      },
    });

    const byType = card(T, {
      id: 'ct-bytype', title: ['Domain', 'Community'].includes(type) ? 'Top communities' : 'Visits by asset type', sub: type === 'All' ? 'Asset visits' : '', span: 5,
      load: async () => {
        if (type === 'Dashboard') return { empty: { title: 'Not applicable', text: 'Dashboards don\u2019t have asset types.' } };
        const src = type === 'All' ? await Data.contentDetail('Asset', r) : await detail();
        const keyOf = ['Domain', 'Community'].includes(type) ? (x) => x.community || '(no community)' : (x) => x.assetType || '(unknown type)';
        const m = new Map();
        for (const x of src) { const k = keyOf(x); const e = m.get(k) || { label: k, value: 0, items: 0 }; e.value += x.visits; e.items++; m.set(k, e); }
        const rows = [...m.values()].sort((a, b) => b.value - a.value);
        if (!rows.length) return { empty: { title: 'No visits', text: `No ${label} visits in this period.` } };
        return {
          spec: { kind: 'hbar', title: 'Breakdown', valueLabel: 'Visits', items: rows.slice(0, 14).map((x, i) => ({ label: x.label, value: x.value, color: Theme.palette[i % 10], sub: `${fmtN(x.items)} distinct items` })) },
          dataset: { columns: [{ key: 'label', label: ['Domain', 'Community'].includes(type) ? 'Community' : 'Asset type' }, { key: 'items', label: 'Distinct items', type: 'number' }, { key: 'value', label: 'Visits', type: 'number', bar: true }], rows },
          calc: [`${fmtN(sum(rows, (x) => x.value))} visits to ${plural(sum(rows, (x) => x.items), 'distinct item')} in ${plural(rows.length, 'group')}.`, `Largest: ${rows[0].label} with ${fmtN(rows[0].value)} visits to ${plural(rows[0].items, 'item')}.`],
        };
      },
    });

    const moverCard = (dir) => card(T, {
      id: `ct-movers-${dir}`, title: dir === 'up' ? 'Rising' : 'Falling', sub: cr ? `Biggest change vs ${State.compareLabel()}` : 'Needs a comparison period', span: 6,
      load: async () => {
        if (!cr) return { empty: { title: 'No comparison selected', text: 'Choose "Compare to: Previous period" or "Same period last year" to see movers.' } };
        const [cur, prev] = await Promise.all([detail(), detailPrev()]);
        const pm = new Map((prev || []).map((x) => [`${x.kind}:${x.id}`, x]));
        const cm = new Map(cur.map((x) => [`${x.kind}:${x.id}`, x]));
        const keys = uniq([...cm.keys(), ...pm.keys()]);
        const rows = keys.map((k) => {
          const c = cm.get(k), p = pm.get(k);
          const base = c || p;
          const now = c ? c.visits : 0, before = p ? p.visits : 0;
          return { ...base, visits: now, prev: before, diff: now - before, change: pctChange(now, before) };
        }).filter((x) => (dir === 'up' ? x.diff > 0 : x.diff < 0)).sort((a, b) => (dir === 'up' ? b.diff - a.diff : a.diff - b.diff));
        if (!rows.length) return { empty: { title: dir === 'up' ? 'Nothing rising' : 'Nothing falling', text: `No ${label} ${dir === 'up' ? 'gained' : 'lost'} visits compared with the ${State.compareLabel()}.` } };
        return {
          spec: { kind: 'hbar', title: dir === 'up' ? 'Rising' : 'Falling', valueLabel: dir === 'up' ? 'Visits gained' : 'Visits lost', color: Theme.v(dir === 'up' ? '--good' : '--bad'), items: rows.slice(0, 10).map((x) => ({ label: x.name, value: Math.abs(x.diff), sub: `${type === 'All' ? `${x.kind} · ` : ''}${fmtN(x.prev)} → ${fmtN(x.visits)}`, onClick: x.kind === 'Asset' ? () => openAsset(x.id) : null })) },
          dataset: { columns: [{ key: 'name', label: 'Name', link: (x) => Env.urlFor(x.kind, x.id) }, { key: 'kind', label: 'Content type' }, { key: 'prev', label: 'Previous visits', type: 'number' }, { key: 'visits', label: 'Current visits', type: 'number' }, { key: 'diff', label: 'Change', type: 'number' }, { key: 'change', label: 'Change %', type: 'delta', isNew: (x) => x.prev === 0 && x.visits > 0 }], rows },
          calc: [
            `${plural(rows.length, 'item')} ${dir === 'up' ? 'gained' : 'lost'} visits; ${fmtN(Math.abs(sum(rows, (x) => x.diff)))} visits ${dir === 'up' ? 'gained' : 'lost'} in total.`,
            `#1: ${rows[0].name}: ${fmtN(rows[0].prev)} \u2192 ${fmtN(rows[0].visits)} (change ${rows[0].diff > 0 ? '+' : ''}${fmtN(rows[0].diff)}).`,
            `Compared with ${State.compareLabel()} (${fmtRange(cr.startDate, cr.endDate)}).`,
          ],
        };
      },
    });

    const ranked = card(T, {
      id: 'ct-ranked', title: `All ${type === 'All' ? 'content' : pluralWord(type.toLowerCase())} ranked`, sub: 'Every item visited in the period (not limited to the top 100)', span: 12,
      load: async () => {
        const [cur, prev] = await Promise.all([detail(), detailPrev()]);
        if (!cur.length) return { empty: { title: 'No visits', text: `No ${label} visits in this period with the current filters.` } };
        const pm = prev ? new Map(prev.map((x) => [`${x.kind}:${x.id}`, x.visits])) : null;
        const total = sum(cur, (x) => x.visits);
        const rows = cur.map((x, i) => ({
          ...x, rank: i + 1, share: total ? (x.visits / total) * 100 : 0,
          prev: pm ? pm.get(`${x.kind}:${x.id}`) || 0 : null,
          change: pm ? pctChange(x.visits, pm.get(`${x.kind}:${x.id}`) || 0) : null,
        }));
        const hasAssetType = types.some((t) => ['Asset', 'Diagram'].includes(t));
        const columns = [
          { key: 'rank', label: '#', type: 'number' },
          { key: 'name', label: 'Name', link: (x) => Env.urlFor(x.kind, x.id) },
          type === 'All' ? { key: 'kind', label: 'Content type' } : null,
          type === 'Diagram' ? { key: 'asset', label: 'Diagram of', link: (x) => Env.urlFor('Asset', x.assetId) } : null,
          hasAssetType ? { key: 'assetType', label: 'Asset type' } : null,
          ['Asset', 'Diagram', 'All'].includes(type) ? { key: 'domain', label: 'Domain' } : null,
          type !== 'Dashboard' && type !== 'Community' ? { key: 'community', label: 'Community' } : null,
          type !== 'Dashboard' ? { key: 'hierarchy', label: 'Community hierarchy', hidden: true } : null,
          { key: 'visits', label: 'Visits', type: 'number', bar: true },
          { key: 'share', label: 'Share', type: 'pct' },
          pm ? { key: 'prev', label: 'Previous', type: 'number' } : null,
          pm ? { key: 'change', label: 'Change', type: 'delta', isNew: (x) => x.prev === 0 && x.visits > 0 } : null,
          { key: 'id', label: 'ID', hidden: true },
        ].filter(Boolean);
        return {
          dataset: { columns, rows },
          tableOpts: { sort: 'visits', dir: 'desc', pageSize: 25, searchPlaceholder: 'Search by name, type, domain…', onRowClick: (x) => { if (x.kind === 'Asset') openAsset(x.id); else if (x.kind === 'Diagram') openAsset(x.assetId); } },
          calc: [
            `${plural(rows.length, 'item')} with ${fmtN(total)} visits in total.`,
            `Share % = item visits \u00f7 ${fmtN(total)}. #1: ${rows[0].name} with ${fmtN(rows[0].visits)} visits = ${fmtPct(rows[0].share)}.`,
            pm ? `Previous / Change use ${State.compareLabel()}.` : null,
          ],
        };
      },
    });

    const conc = concentrationCard(T, 'ct-concentration', {
      noun: type === 'All' ? 'item' : type.toLowerCase(),
      loader: async () => (await detail()).map((x) => ({ id: x.id, name: type === 'All' ? `${x.name} (${x.kind})` : x.name, visits: x.visits, link: Env.urlFor(x.kind, x.id) })),
    });

    const coverage = card(T, {
      id: 'ct-coverage', title: 'Catalog coverage', sub: 'Share of the catalog visited at least once, by asset type or community', span: 6,
      load: async () => {
        if (!['All', 'Asset'].includes(type)) return { empty: { title: 'Assets only', text: 'Coverage is calculated for assets. Choose \u201cAll content\u201d or \u201cAssets\u201d.' } };
        const by = Prefs.get('ct-coverage', 'by', 'type');
        const visited = await Data.contentDetail('Asset', r);
        const groups = new Map();
        for (const x of visited) {
          const key = by === 'type' ? x.assetType || '(unknown type)' : x.communityId || '(none)';
          const e = groups.get(key) || { key, label: by === 'type' ? key : x.community || '(no community)', id: by === 'type' ? null : x.communityId, visited: 0, visits: 0 };
          e.visited++; e.visits += x.visits;
          groups.set(key, e);
        }
        let totals;
        if (by === 'type') {
          const types = await Data.filterList('assetTypes', r).catch(soft) || [];
          const t = await Data.assetTypeTotals(types.filter((x) => groups.has(x.label)));
          totals = (e) => t.get(e.label);
        } else {
          const top = [...groups.values()].sort((a, b) => b.visits - a.visits).slice(0, 25);
          const t = await Data.communityTotals(top.map((e) => e.id));
          totals = (e) => t.get(e.id);
        }
        const rows = [...groups.values()].map((e) => { const total = totals(e) ?? null; return { ...e, total, pct: total ? Math.min(100, (e.visited / total) * 100) : null }; })
          .filter((e) => e.total != null).sort((a, b) => b.total - a.total);
        const seg = segmented(['type', 'community'], by, (v) => { Prefs.set('ct-coverage', 'by', v); App.rerun('ct-coverage'); }, 'Group by', (v) => (v === 'type' ? 'Asset type' : 'Community'));
        if (!rows.length) return { empty: { title: 'No totals available', text: 'Catalog totals couldn\u2019t be loaded for the visited groups.' }, extraOptions: () => [seg] };
        const tv = sum(rows, (x) => x.visited), tt = sum(rows, (x) => x.total);
        return {
          stats: [{ label: 'Coverage (shown groups)', value: tt ? (tv / tt) * 100 : null, display: fmtPct(tt ? (tv / tt) * 100 : null, 2), primary: true }, { label: 'Assets visited', value: tv }, { label: 'Assets in these groups', value: tt }],
          spec: { kind: 'hbar', title: 'Catalog coverage', valueLabel: 'Coverage', valueFormat: (v) => fmtPct(v, v < 1 ? 2 : 1), color: colorFor('Asset'), items: rows.slice(0, 15).map((x) => ({ label: x.label, value: x.pct || 0, sub: `${fmtN(x.visited)} of ${fmtN(x.total)} assets visited \u00b7 ${fmtN(x.visits)} visits` })) },
          dataset: { columns: [{ key: 'label', label: by === 'type' ? 'Asset type' : 'Community', link: (x) => (x.id ? Env.communityUrl(x.id) : null) }, { key: 'visited', label: 'Assets visited', type: 'number' }, { key: 'total', label: 'Assets in catalog', type: 'number' }, { key: 'pct', label: 'Coverage %', type: 'pct' }, { key: 'visits', label: 'Visits', type: 'number' }], rows },
          extraOptions: () => [seg],
          calc: [
            ...rows.slice(0, 15).map((x) => `${x.label}: ${fmtN(x.visited)} visited \u00f7 ${fmtN(x.total)} in catalog = ${fmtPct(x.pct, 2)}`),
            by === 'type' ? 'Totals count assets of exactly that type (no subtypes), across the whole catalog.' : 'Totals are taken for the 25 most-visited communities, across the whole catalog.',
            `Overall for the groups shown: ${fmtN(tv)} \u00f7 ${fmtN(tt)} = ${fmtPct(tt ? (tv / tt) * 100 : null, 2)}.`,
          ],
        };
      },
    });

    const stale = card(T, {
      id: 'ct-stale', title: 'Stale but popular', sub: `Top-visited assets not modified in ${State.s.stale}+ days`, span: 12,
      load: async () => {
        const seg = segmented([90, 180, 365], State.s.stale, (v) => App.update({ stale: v }), 'Not modified for', (v) => `${v} days`);
        if (!['All', 'Asset'].includes(type)) return { empty: { title: 'Assets only', text: 'Choose \u201cAll content\u201d or \u201cAssets\u201d.' }, extraOptions: () => [seg] };
        const top = (await Data.contentDetail('Asset', r)).slice(0, 200);
        const ctx = await Data.assetContext(top.map((x) => x.id));
        const now = Date.now();
        const all = top.map((x, i) => { const c = ctx.get(x.id) || {}; const days = c.modifiedOn ? Math.floor((now - c.modifiedOn) / DAY) : null; return { id: x.id, rank: i + 1, name: x.name, type: c.type || x.assetType, domain: c.domain || x.domain, community: c.community || x.community, visits: x.visits, modified: c.modifiedOn || null, days }; });
        const rows = all.filter((x) => x.days != null && x.days >= State.s.stale);
        const known = all.filter((x) => x.days != null).length;
        return {
          stats: [{ label: 'Stale assets', value: rows.length, primary: true }, { label: 'Share of top assets', value: known ? (rows.length / known) * 100 : null, display: fmtPct(known ? (rows.length / known) * 100 : null) }, { label: 'Their visits', value: sum(rows, (x) => x.visits) }],
          dataset: {
            columns: [{ key: 'rank', label: 'Visit rank', type: 'number' }, { key: 'name', label: 'Asset', link: (x) => Env.assetUrl(x.id) }, { key: 'type', label: 'Asset type' }, { key: 'domain', label: 'Domain', hidden: true }, { key: 'community', label: 'Community' },
              { key: 'visits', label: 'Visits', type: 'number', bar: true }, { key: 'modified', label: 'Last modified', type: 'datetime', hidden: true }, { key: 'days', label: 'Days since modified', type: 'number' }],
            rows,
          },
          tableOpts: { sort: 'visits', dir: 'desc', onRowClick: (x) => openAsset(x.id), emptyText: `None of the top ${top.length} assets is older than ${State.s.stale} days.` },
          extraOptions: () => [seg],
          calc: [
            `Checked the ${fmtN(top.length)} most-visited assets in the period (${fmtN(known)} with a known modification date).`,
            `${plural(rows.length, 'asset')} weren\u2019t modified for at least ${State.s.stale} days = ${fmtPct(known ? (rows.length / known) * 100 : null)}; together they got ${fmtN(sum(rows, (x) => x.visits))} visits.`,
            'Days since modified = today \u2212 the asset\u2019s last-modified date (any change to the asset, its attributes or relations, as recorded by Collibra).',
          ],
        };
      },
    });

    panel.append(grid(trend), grid(heat, weekday), grid(tree, byType), grid(conc, coverage), grid(moverCard('up'), moverCard('down')), grid(stale), grid(ranked));
    runAll(T);
  }

  /* ────────────────────────────────────────────────────────────────────────
     Shared: concentration (Pareto curve + Gini)
     ──────────────────────────────────────────────────────────────────────── */

  /** loader() → [{ id?, name, visits, link? }] */
  function concentrationCard(tab, id, { title = 'Concentration of visits', noun, loader, span = 6, info = 'concentration' }) {
    const nouns = pluralWord(noun);
    return card(tab, {
      id, info, title, sub: `How evenly visits spread across ${nouns} \u00b7 the further the curve is above the diagonal, the more concentrated`, span, height: 260,
      load: async () => {
        const list = (await loader()).filter((x) => x.visits > 0).sort((a, b) => b.visits - a.visits);
        const c = concentration(list.map((x) => x.visits));
        if (!c.n) return { empty: { title: 'No visits', text: `No ${nouns} were visited in this period.` } };
        let acc = 0;
        const rows = list.map((x, i) => { acc += x.visits; return { rank: i + 1, name: x.name, id: x.id, link: x.link, visits: x.visits, share: (x.visits / c.total) * 100, cum: (acc / c.total) * 100 }; });
        return {
          stats: [
            { label: 'Gini', value: c.gini, display: c.gini == null ? '\u2013' : c.gini.toFixed(2), primary: true, hint: '0 = visits spread evenly, 1 = all visits on one item' },
            { label: `Top 10% of ${nouns}`, value: c.top10, display: fmtPct(c.top10), hint: 'Share of visits going to the most-visited 10%' },
            { label: `Top 20% of ${nouns}`, value: c.top20, display: fmtPct(c.top20), hint: 'Share of visits going to the most-visited 20%' },
            { label: '80% of visits from', value: c.k80, display: `${fmtN(c.k80)} (${fmtPct(c.k80pct, 0)})`, hint: `${pluralWord(noun)} needed to reach 80% of visits` },
          ],
          spec: {
            kind: 'series', mode: 'area', title, height: 260, integer: false, yFormat: (v) => `${fmtN(v)}%`, valueFormat: (v) => fmtPct(v), legend: 'always',
            categories: c.curve.map((p) => ({ label: `${p.pct}%`, full: `Top ${p.pct}% of ${nouns} (${fmtN(p.items)})` })),
            series: [
              { name: 'Cumulative share of visits', values: c.curve.map((p) => p.share), color: Theme.palette[0] },
              { name: 'Perfectly even spread', values: c.curve.map((p) => p.pct), color: Theme.v('--text-3'), overlay: true, dashed: true },
            ],
          },
          dataset: {
            columns: [{ key: 'rank', label: '#', type: 'number' }, { key: 'name', label: titleCase(noun), link: (x) => x.link || null }, { key: 'visits', label: 'Visits', type: 'number', bar: true },
              { key: 'share', label: 'Share %', type: 'pct' }, { key: 'cum', label: 'Cumulative share %', type: 'pct' }],
            rows,
          },
          calc: [
            `${plural(c.n, `${noun} with visits`)}, ${fmtN(c.total)} visits in total.`,
            `Gini = 2 \u00d7 \u03a3(rank \u00d7 visits) \u00f7 (n \u00d7 total) \u2212 (n + 1) \u00f7 n, ranking ascending = ${c.gini == null ? 'n/a' : c.gini.toFixed(3)}.`,
            `Top 10% = the ${fmtN(Math.max(1, Math.ceil(c.n * 0.1)))} most-visited ${nouns}: ${fmtPct(c.top10)} of visits. Top 20% (${fmtN(Math.max(1, Math.ceil(c.n * 0.2)))}): ${fmtPct(c.top20)}.`,
            `80% of visits come from ${fmtN(c.k80)} of ${fmtN(c.n)} ${nouns} (${fmtPct(c.k80pct)}).`,
          ],
        };
      },
    });
  }

  /* ────────────────────────────────────────────────────────────────────────
     Tab: Dashboards
     ──────────────────────────────────────────────────────────────────────── */

  function buildDashboards(panel) {
    const T = 'dashboards';
    const r = State.range(), cr = State.compareRange(), g = State.gran();
    const gl = g.toLowerCase();
    const { dsel, dmin, dtop } = State.s;
    const lookback = cr ? { startDate: addDays(cr.startDate, -daysInclusive(cr.startDate, cr.endDate)), endDate: addDays(cr.startDate, -1) } : null;
    const ignored = FILTERS.filter((f) => !f.services.includes('users') && State.s.f[f.key].length).map((f) => f.label);

    const cur = memo(() => Data.itemSeries('Dashboard', r, g));
    const prev = memo(() => (cr ? Data.itemSeries('Dashboard', cr, g) : Promise.resolve(null)));
    const back = memo(() => (lookback ? Data.itemSeries('Dashboard', lookback, 'Quarter').catch(soft) : Promise.resolve(null)));
    const users = memo(() => Data.userSeries(r, g, 'Active'));
    const usersPrev = memo(() => (cr ? Data.userSeries(cr, g, 'Active').catch(soft) : Promise.resolve(null)));

    const inSel = (x) => !dsel.length || dsel.includes(x.id);
    const keep = (x) => inSel(x) && x.total >= dmin;
    const filterNote = [dsel.length ? `${plural(dsel.length, 'selected dashboard')}` : null, dmin ? `at least ${plural(dmin, 'visit')} in the period` : null].filter(Boolean).join(', ');
    const filterCalc = filterNote ? `Dashboard filters: ${filterNote}.` : 'All dashboards with visits in the period.';
    const dashLabel = (id) => State.labels.get(`item:${id}`) || `Dashboard ${id.slice(0, 8)}`;
    const visitorLabel = `${fmtRange(r.startDate, r.endDate)}`;

    const picker = pickerButton('Dashboards', dsel.length, (btn) => openListPicker(btn, {
      title: 'Dashboards',
      selected: dsel,
      labelOf: dashLabel,
      footNote: 'Dashboards visited in this or the comparison period',
      load: async () => {
        const [c, p] = await Promise.all([cur(), prev().catch(soft)]);
        const m = new Map();
        for (const x of [...(p ? p.items : []), ...c.items]) m.set(x.id, { id: x.id, label: x.name, meta: `${fmtN(c.byId.get(x.id)?.total || 0)} visits` });
        return [...m.values()].sort((a, b) => a.label.localeCompare(b.label));
      },
      onApply: (ids, known) => { ids.forEach((id) => { const k = known.get(id); if (k) State.labels.set(`item:${id}`, k.label); }); App.update({ dsel: ids }); },
    }));
    panel.append(panelIntro('Dashboards', `${visitorLabel} \u00b7 audience filters apply${ignored.length ? ` \u00b7 dashboards don\u2019t belong to communities or asset types, so the ${ignored.join(' and ')} filters may hide them` : ''}`,
      picker,
      selectEl([0, 1, 5, 10, 50, 100], dmin, (v) => App.update({ dmin: Number(v) }), 'Min visits', (v) => (Number(v) ? `\u2265 ${v}` : 'Any')),
      segmented([5, 10, 20], dtop, (v) => App.update({ dtop: v }), 'Top N in charts', (v) => `Top ${v}`)));
    if (dsel.length) {
      panel.append(h('div', { class: 'active-filters sel-chips' }, dsel.map((id) => selChip(dashLabel(id), () => App.update({ dsel: dsel.filter((x) => x !== id) }), 'Dashboard:')),
        h('button', { class: 'chip-clear', type: 'button', onclick: () => App.update({ dsel: [] }) }, 'Clear')));
      cur().then((c) => { c.items.forEach((x) => State.labels.set(`item:${x.id}`, x.name)); $$('.sel-chips .chip').forEach((el, i) => { const id = dsel[i]; if (id && c.byId.get(id)) el.childNodes[1].textContent = c.byId.get(id).name; }); }).catch(() => {});
    }

    const kpis = kpiStrip(T, {
      id: 'db-kpis', count: 6,
      load: async () => {
        const [c, p, s0, s1, us, usp] = await Promise.all([cur(), prev(), Data.contentSummary(r), cr ? Data.contentSummary(cr) : null, users().catch(soft), usersPrev()]);
        const items = c.items.filter(keep);
        const pItems = p ? p.items.filter(inSel) : null;
        const visits = sum(items, (x) => x.total);
        const pv = pItems ? sum(pItems, (x) => x.total) : null;
        const n = items.length;
        const pn = pItems ? pItems.length : null;
        const avg = n ? visits / n : 0;
        const pavg = pn ? pv / pn : (pItems ? 0 : null);
        const share = s0.total ? (visits / s0.total) * 100 : null;
        const pshare = s1 && s1.total && pv != null ? (pv / s1.total) * 100 : null;
        const reachOf = (u) => {
          if (!u || !u.users.length) return null;
          const viewers = u.users.filter((x) => x.tot.Dashboard > 0);
          return { viewers, active: u.users.length, pct: (viewers.length / u.users.length) * 100, perViewer: viewers.length ? sum(viewers, (x) => x.tot.Dashboard) / viewers.length : 0 };
        };
        const rc = reachOf(us), rp = reachOf(usp);
        const spark = c.buckets.map((_, i) => sum(items, (x) => x.values[i]));
        const sel = dsel.length || dmin ? ' Reach uses all dashboards: the user download doesn\u2019t say which dashboard each person opened.' : '';
        return [
          { label: 'Dashboard visits', info: 'db-visits', value: visits, prev: pv, delta: pv != null ? pctChange(visits, pv) : null, spark, color: colorFor('Dashboard'),
            calc: [filterCalc, `${fmtN(visits)} visits = sum of the per-dashboard visit counts in the row-level download.`, cmpCalc(visits, pv)] },
          { label: 'Dashboards visited', info: 'db-count', value: n, prev: pn, delta: pn != null ? pctChange(n, pn) : null, color: Theme.palette[5], meta: 'distinct, at least 1 visit',
            calc: [filterCalc, `${plural(n, 'distinct dashboard')} had at least one visit${dmin ? ` (and at least ${fmtN(dmin)})` : ''}.`, cmpCalc(n, pn)] },
          { label: 'Visits per dashboard', info: 'db-avg', value: avg, display: fmt1(avg), prev: pavg, delta: pavg != null ? pctChange(avg, pavg) : null, color: Theme.palette[3],
            calc: [n ? `${fmtN(visits)} visits \u00f7 ${plural(n, 'dashboard')} = ${fmt1(avg)}.` : 'No dashboards visited.', cmpCalc(avg, pavg, fmt1)] },
          { label: 'Share of all visits', info: 'db-share', value: share, display: fmtPct(share), prev: pshare, delta: pshare != null && share != null ? pctChange(share, pshare) : null, ring: share ?? 0, color: Theme.palette[7],
            calc: [`${fmtN(visits)} dashboard visits \u00f7 ${fmtN(s0.total)} visits to all content \u00d7 100 = ${fmtPct(share)}.`, pshare != null ? `Comparison: ${fmtPct(pshare)}.` : null] },
          { label: 'Dashboard reach', info: 'db-reach', value: rc ? rc.pct : null, display: rc ? fmtPct(rc.pct) : '\u2013', prev: rp ? rp.pct : null, delta: rc && rp ? pctChange(rc.pct, rp.pct) : null, ring: rc ? rc.pct : 0, color: colorFor('Active'), meta: rc ? `${fmtN(rc.viewers.length)} of ${fmtN(rc.active)} active users` : '',
            calc: rc ? [`${fmtN(rc.viewers.length)} people opened at least one dashboard \u00f7 ${fmtN(rc.active)} active people \u00d7 100 = ${fmtPct(rc.pct)}.${sel}`, rp ? `Comparison: ${fmtN(rp.viewers.length)} of ${fmtN(rp.active)} = ${fmtPct(rp.pct)}.` : null] : [] },
          { label: 'Visits per viewer', info: 'db-per-viewer', value: rc ? rc.perViewer : null, display: rc ? fmt1(rc.perViewer) : '\u2013', prev: rp ? rp.perViewer : null, delta: rc && rp ? pctChange(rc.perViewer, rp.perViewer) : null, color: Theme.palette[2], meta: 'dashboard visits per dashboard user',
            calc: rc && rc.viewers.length ? [`${fmtN(sum(rc.viewers, (x) => x.tot.Dashboard))} dashboard visits \u00f7 ${fmtN(rc.viewers.length)} dashboard viewers = ${fmt1(rc.perViewer)}.${sel}`] : [] },
        ];
      },
    });

    const trend = card(T, {
      id: 'db-trend', title: 'Dashboard visits over time', sub: `Top ${dtop} dashboards stacked, the rest grouped as \u201cOther\u201d \u00b7 click a period to zoom in`, span: 12, height: 320, chartTypes: ['area', 'bar', 'line'], stackable: true,
      load: async () => {
        const [c, p] = await Promise.all([cur(), prev()]);
        const items = c.items.filter(keep);
        if (!items.length) return { empty: { title: 'No dashboard visits', text: 'No dashboards match the filters in this period.' }, calc: [filterCalc] };
        const top = items.slice(0, dtop), rest = items.slice(dtop);
        const series = top.map((x, i) => ({ name: x.name, values: x.values, color: Theme.palette[i % Theme.palette.length] }));
        if (rest.length) series.push({ name: `Other (${fmtN(rest.length)})`, values: c.buckets.map((_, i) => sum(rest, (x) => x.values[i])), color: Theme.v('--text-3') });
        const totals = c.buckets.map((_, i) => sum(items, (x) => x.values[i]));
        if (p) {
          const pi = p.items.filter(inSel);
          series.push({ name: `Total, ${State.compareLabel()}`, values: c.buckets.map((_, i) => (i < p.buckets.length ? sum(pi, (x) => x.values[i]) : null)), color: Theme.v('--text-2'), overlay: true, dashed: true });
        }
        if (Prefs.get('db-trend', 'ma', false)) series.push({ name: `${maWindow(g)}-${gl} moving average`, values: movingAverage(totals, maWindow(g)), color: Theme.v('--warn'), overlay: true });
        const tr = trendOn('db-trend') ? trendInfo(totals, g, 'Total') : null;
        if (tr && tr.series) series.push(tr.series);
        return {
          spec: { kind: 'series', mode: 'area', stacked: true, title: 'Dashboard visits over time', height: 320, categories: catsOf(c.buckets), series, onClick: (i) => zoomTo(c.buckets[i]) },
          extraOptions: () => [maToggle('db-trend'), trendToggle('db-trend')],
          calc: [
            filterCalc,
            `${fmtN(sum(totals))} visits to ${plural(items.length, 'dashboard')} over ${plural(c.buckets.length, `${gl} bucket`)}; the top ${fmtN(top.length)} account for ${fmtN(sum(top, (x) => x.total))} (${fmtPct(sum(totals) ? (sum(top, (x) => x.total) / sum(totals)) * 100 : 0)}).`,
            rest.length ? `\u201cOther\u201d adds up the remaining ${plural(rest.length, 'dashboard')}.` : null,
            ...(tr ? tr.calc : []),
          ],
        };
      },
    });

    const distinct = card(T, {
      id: 'db-distinct', title: 'Dashboards visited per period', sub: `Distinct dashboards with at least one visit per ${gl}`, span: 4, height: 240, chartTypes: ['bar', 'line'],
      load: async () => {
        const [c, p] = await Promise.all([cur(), prev()]);
        const items = c.items.filter(keep);
        const vals = c.buckets.map((_, i) => items.reduce((n, x) => n + (x.values[i] > 0 ? 1 : 0), 0));
        const series = [{ name: 'Distinct dashboards', values: vals, color: Theme.palette[5] }];
        if (p) {
          const pi = p.items.filter(inSel);
          series.push({ name: `Distinct, ${State.compareLabel()}`, values: c.buckets.map((_, i) => (i < p.buckets.length ? pi.reduce((n, x) => n + (x.values[i] > 0 ? 1 : 0), 0) : null)), color: Theme.v('--text-3'), overlay: true, dashed: true });
        }
        return {
          spec: { kind: 'series', mode: 'bar', title: 'Dashboards visited per period', height: 240, categories: catsOf(c.buckets), series, onClick: (i) => zoomTo(c.buckets[i]) },
          calc: [filterCalc, `Average ${fmt1(vals.length ? sum(vals) / vals.length : 0)} distinct dashboards per ${gl}; ${plural(items.length, 'distinct dashboard')} across the whole range.`, `Adding the ${gl}s up (${fmtN(sum(vals))}) counts a dashboard once per ${gl} it was visited.`],
        };
      },
    });

    const viewers = card(T, {
      id: 'db-viewers', title: 'Dashboard viewers over time', sub: `Bars: people who opened a dashboard per ${gl} \u00b7 line: % of that ${gl}\u2019s active users`, span: 4, height: 240, chartTypes: ['bar', 'line'],
      load: async () => {
        const u = await users();
        const vw = u.buckets.map((_, i) => u.users.filter((x) => x.Dashboard[i] > 0).length);
        const act = u.buckets.map((_, i) => u.users.filter((x) => x.active[i]).length);
        const pct = vw.map((v, i) => (act[i] ? (v / act[i]) * 100 : 0));
        return {
          spec: {
            kind: 'series', mode: 'bar', title: 'Dashboard viewers over time', height: 240, legend: 'always', categories: catsOf(u.buckets), y2Format: (v) => `${fmtN(v)}%`, y2Integer: false, onClick: (i) => zoomTo(u.buckets[i]),
            series: [{ name: 'Dashboard viewers', values: vw, color: colorFor('Dashboard') }, { name: 'Reach % of active users', values: pct, color: Theme.palette[1], y2: true, format: (v) => fmtPct(v) }],
          },
          dataset: {
            columns: [{ key: 'period', label: 'Period' }, { key: 'start', label: 'Start', type: 'date' }, { key: 'end', label: 'End', type: 'date' }, { key: 'viewers', label: 'Dashboard viewers', type: 'number' }, { key: 'active', label: 'Active users', type: 'number' }, { key: 'pct', label: 'Reach %', type: 'pct' }],
            rows: u.buckets.map((b, i) => ({ period: b.label, start: b.startDate, end: b.endDate, viewers: vw[i], active: act[i], pct: pct[i] })),
          },
          calc: [`Per ${gl}: people with at least one dashboard visit \u00f7 people active that ${gl} \u00d7 100.`, `Across buckets: ${fmtN(sum(vw))} viewer-${gl}s of ${fmtN(sum(act))} active user-${gl}s.`, 'Counts are of all dashboards (the dashboard picker doesn\u2019t apply).', C.nameDedup],
        };
      },
    });

    const weekday = card(T, {
      id: 'db-weekday', title: 'Weekday profile', sub: 'Average dashboard visits per weekday', span: 4, height: 240,
      load: async () => {
        const daily = await Data.itemSeries('Dashboard', r, 'Day');
        const items = daily.items.filter(keep);
        const tot = new Array(7).fill(0), cnt = new Array(7).fill(0);
        daily.buckets.forEach((b, i) => { const k = weekdayIdx(b.startDate); tot[k] += sum(items, (x) => x.values[i]); cnt[k]++; });
        const avg = tot.map((v, i) => (cnt[i] ? v / cnt[i] : 0));
        return {
          spec: { kind: 'series', mode: 'bar', title: 'Weekday profile', height: 240, integer: false, valueFormat: fmt1, categories: WEEKDAYS.map((d, i) => ({ label: d, full: `${d} (${cnt[i]} days)` })), series: [{ name: 'Average visits', values: avg, color: colorFor('Dashboard') }] },
          dataset: { columns: [{ key: 'day', label: 'Weekday' }, { key: 'days', label: 'Days in range', type: 'number' }, { key: 'total', label: 'Total visits', type: 'number' }, { key: 'avg', label: 'Average visits', type: 'number' }], rows: WEEKDAYS.map((d, i) => ({ day: d, days: cnt[i], total: tot[i], avg: Math.round(avg[i] * 100) / 100 })) },
          calc: [filterCalc, ...WEEKDAYS.map((d, i) => `${d}: ${fmtN(tot[i])} visits \u00f7 ${plural(cnt[i], 'day')} = ${fmt1(avg[i])}`)],
        };
      },
    });

    const heat = card(T, {
      id: 'db-heatmap', title: 'Dashboard \u00d7 period heatmap', sub: `Visits per ${gl} for the top ${dtop} dashboards`, span: 12, height: 260,
      load: async () => {
        const c = await cur();
        const items = c.items.filter(keep).slice(0, dtop);
        if (!items.length) return { empty: { title: 'No dashboard visits', text: 'No dashboards match the filters in this period.' }, calc: [filterCalc] };
        const names = items.map((x) => truncate(x.name, 220, 11));
        return {
          spec: {
            kind: 'heatmap', title: 'Dashboard \u00d7 period heatmap', rows: names, cols: c.buckets.map((b) => b.label), values: items.map((x) => x.values), cellH: 22,
            cellTip: (i, j, v) => `<div class="tt-title">${esc(items[i].name)}</div><div class="tt-sub">${esc(c.buckets[j].full)}</div>${ttRow('', 'Visits', fmtN(v))}`,
          },
          dataset: {
            columns: [{ key: 'name', label: 'Dashboard', link: (x) => Env.dashboardUrl(x.id) }, ...c.buckets.map((b, j) => ({ key: `b${j}`, label: b.label, type: 'number' })), { key: 'total', label: 'Total', type: 'number' }],
            rows: items.map((x) => ({ id: x.id, name: x.name, total: x.total, ...Object.fromEntries(x.values.map((v, j) => [`b${j}`, v])) })),
          },
          calc: [filterCalc, `${plural(items.length, 'dashboard')} \u00d7 ${plural(c.buckets.length, `${gl} bucket`)}. Darker = more visits, relative to the busiest cell (${fmtN(Math.max(...items.flatMap((x) => x.values)))} visits).`],
        };
      },
    });

    const lifecycle = card(T, {
      id: 'db-lifecycle', title: 'Dashboard lifecycle', sub: cr ? `New, reactivated, continuing and dormant vs ${State.compareLabel()}` : 'Needs a comparison period', span: 6, height: 240,
      load: async () => {
        if (!cr) return { empty: { title: 'No comparison period', text: 'Set \u201cCompare to\u201d to see which dashboards are new, continuing or dormant.' } };
        const [c, p, b] = await Promise.all([cur(), prev(), back()]);
        const rows = lifecycleRows(c, p, b, inSel);
        const order = ['New', 'Reactivated', 'Continuing', 'Dormant'];
        const counts = Object.fromEntries(order.map((k) => [k, rows.filter((x) => x.status === k).length]));
        const colors = { New: Theme.v('--good'), Reactivated: Theme.palette[5], Continuing: Theme.palette[0], Dormant: Theme.v('--bad') };
        return {
          spec: { kind: 'donut', title: 'Dashboard lifecycle', items: order.map((k) => ({ label: k, value: counts[k], color: colors[k] })), centerLabel: 'dashboards', valueLabel: 'Dashboards' },
          dataset: {
            columns: [{ key: 'name', label: 'Dashboard', link: (x) => Env.dashboardUrl(x.id) }, { key: 'status', label: 'Status' }, { key: 'cur', label: 'Visits', type: 'number' }, { key: 'prev', label: `Visits, ${State.compareLabel()}`, type: 'number' }, { key: 'back', label: 'Visits, look-back period', type: 'number' }],
            rows,
          },
          tableOpts: { sort: 'cur', dir: 'desc' },
          calc: [
            `Comparison: ${fmtRange(cr.startDate, cr.endDate)}. Look-back: ${fmtRange(lookback.startDate, lookback.endDate)}.`,
            ...order.map((k) => `${k}: ${plural(counts[k], 'dashboard')}.`),
            b ? null : 'The look-back period couldn\u2019t be loaded, so nothing is classified as Reactivated.',
            dsel.length ? `Limited to ${plural(dsel.length, 'selected dashboard')}.` : null,
          ],
        };
      },
    });

    const conc = concentrationCard(T, 'db-concentration', {
      noun: 'dashboard',
      loader: async () => (await cur()).items.filter(keep).map((x) => ({ id: x.id, name: x.name, visits: x.total, link: Env.dashboardUrl(x.id) })),
    });

    const moverCard = (dir) => card(T, {
      id: `db-movers-${dir}`, info: dir === 'up' ? 'ct-movers-up' : 'ct-movers-down', title: dir === 'up' ? 'Rising dashboards' : 'Falling dashboards', sub: cr ? `Biggest change in visits vs ${State.compareLabel()}` : 'Needs a comparison period', span: 6,
      load: async () => {
        if (!cr) return { empty: { title: 'No comparison period', text: 'Set \u201cCompare to\u201d to see rising and falling dashboards.' } };
        const [c, p] = await Promise.all([cur(), prev()]);
        const rows = moverRows(c, p, inSel).filter((x) => (dir === 'up' ? x.change > 0 : x.change < 0)).sort((a, b) => (dir === 'up' ? b.change - a.change : a.change - b.change));
        if (!rows.length) return { empty: { title: dir === 'up' ? 'Nothing rising' : 'Nothing falling', text: `No dashboard has ${dir === 'up' ? 'more' : 'fewer'} visits than in the comparison period.` } };
        return {
          spec: { kind: 'hbar', title: dir === 'up' ? 'Rising dashboards' : 'Falling dashboards', valueLabel: 'Change in visits', color: dir === 'up' ? Theme.v('--good') : Theme.v('--bad'), items: rows.slice(0, 10).map((x) => ({ label: x.name, value: Math.abs(x.change), sub: `${fmtN(x.prev)} \u2192 ${fmtN(x.cur)} visits`, onClick: () => window.open(Env.dashboardUrl(x.id), '_blank', 'noopener') })), valueFormat: (v) => `${dir === 'up' ? '+' : '\u2212'}${fmtN(v)}` },
          dataset: { columns: [{ key: 'name', label: 'Dashboard', link: (x) => Env.dashboardUrl(x.id) }, { key: 'prev', label: 'Before', type: 'number' }, { key: 'cur', label: 'Now', type: 'number' }, { key: 'change', label: 'Change', type: 'number' }, { key: 'pct', label: 'Change %', type: 'delta' }], rows },
          calc: [`${plural(rows.length, 'dashboard')} ${dir === 'up' ? 'gained' : 'lost'} visits; total change ${fmtN(sum(rows, (x) => x.change))}.`, `Largest: \u201c${rows[0].name}\u201d, ${fmtN(rows[0].prev)} \u2192 ${fmtN(rows[0].cur)}.`],
        };
      },
    });

    const reachLicense = card(T, {
      id: 'db-reach-license', title: 'Dashboard reach by license type', sub: 'Share of each license type\u2019s active users who opened a dashboard', span: 6,
      load: async () => {
        const u = await users();
        const m = new Map();
        for (const x of u.users) {
          const k = x.license || '(unknown)';
          const e = m.get(k) || { license: k, active: 0, viewers: 0, visits: 0 };
          e.active++;
          if (x.tot.Dashboard > 0) { e.viewers++; e.visits += x.tot.Dashboard; }
          m.set(k, e);
        }
        const rows = [...m.values()].map((e) => ({ ...e, pct: e.active ? (e.viewers / e.active) * 100 : 0, perViewer: e.viewers ? e.visits / e.viewers : 0 })).sort((a, b) => b.pct - a.pct);
        if (!rows.length) return { empty: { title: 'No active users', text: 'Nobody was active in this period.' } };
        return {
          spec: { kind: 'hbar', title: 'Dashboard reach by license type', valueLabel: 'Reach', valueFormat: (v) => fmtPct(v), color: colorFor('Dashboard'), items: rows.map((x) => ({ label: x.license, value: x.pct, sub: `${fmtN(x.viewers)} of ${fmtN(x.active)} active users \u00b7 ${fmtN(x.visits)} dashboard visits` })) },
          dataset: { columns: [{ key: 'license', label: 'License type' }, { key: 'active', label: 'Active users', type: 'number' }, { key: 'viewers', label: 'Dashboard viewers', type: 'number' }, { key: 'pct', label: 'Reach %', type: 'pct' }, { key: 'visits', label: 'Dashboard visits', type: 'number' }, { key: 'perViewer', label: 'Visits per viewer', type: 'number', format: fmt1 }], rows },
          calc: rows.map((x) => `${x.license}: ${fmtN(x.viewers)} \u00f7 ${fmtN(x.active)} = ${fmtPct(x.pct)}`),
        };
      },
    });

    const consumers = card(T, {
      id: 'db-consumers', title: 'Top dashboard users', sub: 'People with the most dashboard visits', span: 6,
      load: async () => {
        const u = await users();
        const rows = u.users.filter((x) => x.tot.Dashboard > 0).sort((a, b) => b.tot.Dashboard - a.tot.Dashboard)
          .map((x, i) => ({ rank: i + 1, name: x.name, license: x.license, dash: x.tot.Dashboard, visits: x.tot.visits, share: x.tot.visits ? (x.tot.Dashboard / x.tot.visits) * 100 : 0, buckets: x.Dashboard.filter((v) => v > 0).length }));
        if (!rows.length) return { empty: { title: 'No dashboard users', text: 'Nobody opened a dashboard in this period.' } };
        return {
          spec: { kind: 'hbar', title: 'Top dashboard users', valueLabel: 'Dashboard visits', color: colorFor('Dashboard'), rowH: 24, items: rows.slice(0, 15).map((x) => ({ label: x.name, value: x.dash, sub: `${fmtPct(x.share, 0)} of their visits \u00b7 ${x.license}`, onClick: () => App.update({ tab: 'users', users: uniq([...State.s.users, x.name]).slice(-MAX_TRACKED_USERS) }) })) },
          dataset: { columns: [{ key: 'rank', label: '#', type: 'number' }, { key: 'name', label: 'User' }, { key: 'license', label: 'License' }, { key: 'dash', label: 'Dashboard visits', type: 'number', bar: true }, { key: 'visits', label: 'All visits', type: 'number' }, { key: 'share', label: 'Dashboard share %', type: 'pct' }, { key: 'buckets', label: `Active ${gl}s`, type: 'number' }], rows },
          calc: [`${plural(rows.length, 'person')} opened at least one dashboard; together ${fmtN(sum(rows, (x) => x.dash))} dashboard visits.`, `Dashboard share = a person\u2019s dashboard visits \u00f7 all their visits.`, 'Click a person to track them on Users & Adoption.', C.nameDedup],
        };
      },
    });

    const table = card(T, {
      id: 'db-table', title: 'All dashboards ranked', sub: 'Every dashboard visited in this or the comparison period', span: 12,
      load: async () => {
        const [c, p, b] = await Promise.all([cur(), prev(), back()]);
        const life = cr ? new Map(lifecycleRows(c, p, b, inSel).map((x) => [x.id, x.status])) : new Map();
        const prevRank = new Map(p ? p.items.map((x, i) => [x.id, i + 1]) : []);
        const all = c.items.filter(keep);
        const total = sum(all, (x) => x.total);
        const rows = all.map((x, i) => {
          const pv = p ? p.byId.get(x.id)?.total || 0 : null;
          const act = x.values.filter((v) => v > 0).length;
          const fi = x.values.findIndex((v) => v > 0), li = x.values.length - 1 - [...x.values].reverse().findIndex((v) => v > 0);
          return {
            id: x.id, rank: i + 1, name: x.name, visits: x.total, prev: pv, delta: pv ? pctChange(x.total, pv) : null, share: total ? (x.total / total) * 100 : 0,
            prevRank: prevRank.get(x.id) ?? null, rankChange: prevRank.has(x.id) ? prevRank.get(x.id) - (i + 1) : null,
            active: act, activePct: (act / c.buckets.length) * 100, first: fi >= 0 ? c.buckets[fi].startDate : '', last: fi >= 0 ? c.buckets[li].startDate : '',
            status: life.get(x.id) || '', series: x.values,
          };
        });
        if (p && !dmin) for (const x of p.items.filter(inSel)) if (!c.byId.has(x.id)) rows.push({ id: x.id, rank: null, name: x.name, visits: 0, prev: x.total, delta: -100, share: 0, prevRank: prevRank.get(x.id), rankChange: null, active: 0, activePct: 0, first: '', last: '', status: life.get(x.id) || 'Dormant', series: c.buckets.map(() => 0) });
        if (!rows.length) return { empty: { title: 'No dashboards', text: 'No dashboards match the filters in this period.' }, calc: [filterCalc] };
        return {
          dataset: {
            columns: [
              { key: 'rank', label: '#', type: 'number' },
              { key: 'name', label: 'Dashboard', link: (x) => Env.dashboardUrl(x.id) },
              { key: 'visits', label: 'Visits', type: 'number', bar: true },
              { key: 'prev', label: `Visits, ${State.compareLabel()}`, type: 'number', hidden: !p },
              { key: 'delta', label: 'Change %', type: 'delta', hidden: !p, isNew: (x) => !x.prev && x.visits > 0 },
              { key: 'share', label: 'Share %', type: 'pct' },
              { key: 'rankChange', label: 'Rank change', type: 'number', hidden: !p, format: (v) => (v > 0 ? `\u25b2 ${v}` : v < 0 ? `\u25bc ${-v}` : '\u2022') },
              { key: 'active', label: `Active ${gl}s`, type: 'number' },
              { key: 'activePct', label: `Active ${gl}s %`, type: 'pct', hidden: true },
              { key: 'first', label: `First active ${gl}`, type: 'date', hidden: true },
              { key: 'last', label: `Last active ${gl}`, type: 'date' },
              { key: 'status', label: 'Lifecycle', hidden: !cr },
              { key: 'series', label: `Visits per ${gl}`, value: (x) => x.series.join(' | '), render: (x) => sparkline(x.series, colorFor('Dashboard'), 110, 26) },
              { key: 'cmp', label: '', noExport: true, value: () => '', render: (x) => h('button', { class: 'btn btn-ghost btn-xs', type: 'button', title: 'Add to Compare', onclick: (e) => { e.stopPropagation(); addToCompare('Dashboard', x.id, x.name, { go: false }); } }, '+ Compare') },
            ],
            rows,
          },
          tableOpts: { sort: 'visits', dir: 'desc', searchPlaceholder: 'Search dashboards\u2026' },
          calc: [filterCalc, `${plural(rows.length, 'dashboard')}; ${fmtN(total)} visits. Share % = dashboard visits \u00f7 visits to all listed dashboards.`, p ? 'Rank change = rank in the comparison period \u2212 rank now (\u25b2 = moved up).' : null, `Active ${gl}s = ${gl}s with at least one visit, out of ${fmtN(c.buckets.length)}.`],
        };
      },
    });

    panel.append(kpis.el, grid(trend), grid(distinct, viewers, weekday), grid(heat), grid(lifecycle, conc), grid(moverCard('up'), moverCard('down')), grid(reachLicense, consumers), grid(table));
    runAll(T);
  }

  /** Change in visits per item between two itemSeries results. */
  function moverRows(c, p, inSel = () => true) {
    const ids = uniq([...c.items.filter(inSel).map((x) => x.id), ...p.items.filter(inSel).map((x) => x.id)]);
    return ids.map((id) => {
      const a = c.byId.get(id), b = p.byId.get(id);
      const cur = a ? a.total : 0, prev = b ? b.total : 0;
      return { id, name: (a || b).name, cur, prev, change: cur - prev, pct: prev ? ((cur - prev) / prev) * 100 : null };
    });
  }

  /** Lifecycle status per item: New / Reactivated / Continuing / Dormant (current vs comparison vs look-back). */
  function lifecycleRows(c, p, b, inSel = () => true) {
    return moverRows(c, p, inSel).map((x) => {
      const bk = b ? b.byId.get(x.id)?.total || 0 : 0;
      const status = x.cur > 0 && x.prev > 0 ? 'Continuing' : x.cur > 0 ? (bk > 0 ? 'Reactivated' : 'New') : 'Dormant';
      return { id: x.id, name: x.name, status, cur: x.cur, prev: x.prev, back: b ? bk : null };
    });
  }

  /* ────────────────────────────────────────────────────────────────────────
     Tab: Users & Adoption
     ──────────────────────────────────────────────────────────────────────── */

  const PERSONAS = ['Dashboard-focused', 'Mixed', 'Catalog explorer', 'Light'];
  /** Usage persona from a person's visit mix in the period. */
  function personaOf(visits, dashboard) {
    if (visits < 5) return 'Light';
    const d = dashboard / visits;
    if (d >= 0.8) return 'Dashboard-focused';
    if (d <= 0.2) return 'Catalog explorer';
    return 'Mixed';
  }
  const PERSONA_RULES = 'Light = fewer than 5 visits in the period. Otherwise, by the share of the person\u2019s visits that went to dashboards: Dashboard-focused \u2265 80%, Catalog explorer \u2264 20% (mostly assets, domains, communities, diagrams), Mixed in between.';

  const TRACK_METRICS = { visits: 'All visits', sessions: 'Sessions', perSession: 'Visits per session', Asset: 'Asset visits', Dashboard: 'Dashboard visits', Domain: 'Domain visits', Community: 'Community visits', Diagram: 'Diagram visits' };
  const RATE_LEVEL = { High: 3, Medium: 2, Low: 1 };

  /** Cards for the users picked in "Track users" (empty list when none). */
  function trackedUserCards(T, r, g, us) {
    const names = State.s.users;
    if (!names.length) return [];
    const gl = g.toLowerCase();
    const ids = memo(() => Data.resolveUsers(names, r));
    const rate = memo(() => Data.rateSeries(r, g).catch(soft));
    const ret = memo(() => Data.retentionSeries(r, g).catch(soft));
    const colorOf = (i) => Theme.palette[i % Theme.palette.length];
    const picked = async () => {
      const u = await us();
      return names.map((n, i) => ({ name: n, color: colorOf(i), u: u.byName.get(n) || null }));
    };
    const metricOf = (u, m, b) => {
      if (!u) return 0;
      if (m === 'perSession') return u.sessions[b] ? u.visits[b] / u.sessions[b] : 0;
      return u[m][b];
    };
    const contributions = memo(async () => {
      const map = await ids();
      return Promise.all(names.map(async (n) => {
        const id = map.get(n);
        if (!id) return { id: null, edits: null, ratings: null };
        const [ev, rt] = await Promise.all([
          Data.activitiesFor({ performedByUserId: id }, r, 5000).catch(soft),
          Api.get('/rest/2.0/ratings', { userId: id, limit: 1000 }).catch(soft),
        ]);
        const ratings = rt ? (rt.results || []).map((x) => ({ date: localIsoOfMs(x.createdOn), stars: (Number(x.rating) || 0) * 5 })).filter((x) => x.date >= r.startDate && x.date <= r.endDate) : null;
        return { id, edits: ev ? { values: Data.countByBucket(ev.events, r, g), total: ev.events.length, capped: ev.capped } : null, ratings: ratings ? { values: Data.countByBucket(ratings, r, g), total: ratings.length, avg: ratings.length ? sum(ratings, (x) => x.stars) / ratings.length : null } : null };
      }));
    });
    const missingNote = (list) => { const miss = list.filter((p) => !p.u).map((p) => p.name); return miss.length ? `No activity in this period for: ${miss.join(', ')}.` : null; };

    const trend = card(T, {
      id: 'us-track-trend', title: 'Tracked users over time', sub: `One line per person \u00b7 dashed: median of all people active in each ${gl}`, span: 12, height: 320, chartTypes: ['line', 'bar', 'area'],
      load: async () => {
        const [u, list] = await Promise.all([us(), picked()]);
        const m = Prefs.get('us-track-trend', 'metric', 'visits');
        const bench = Prefs.get('us-track-trend', 'bench', true);
        const series = list.map((p) => ({ name: p.name, values: u.buckets.map((_, b) => metricOf(p.u, m, b)), color: p.color }));
        let med = null;
        if (bench) {
          med = u.buckets.map((_, b) => median(u.users.filter((x) => x.active[b]).map((x) => metricOf(x, m, b))));
          series.push({ name: 'Median active user', values: med, color: Theme.v('--text-3'), overlay: true, dashed: true });
        }
        const metricSel = selectEl(Object.keys(TRACK_METRICS), m, (v) => { Prefs.set('us-track-trend', 'metric', v); App.rerun('us-track-trend'); }, 'Metric', (v) => TRACK_METRICS[v]);
        const cb = h('input', { type: 'checkbox', checked: bench });
        cb.addEventListener('change', () => { Prefs.set('us-track-trend', 'bench', cb.checked); App.rerun('us-track-trend'); });
        return {
          spec: { kind: 'series', mode: 'line', title: `Tracked users: ${TRACK_METRICS[m]}`, height: 320, legend: 'always', integer: m !== 'perSession', valueFormat: m === 'perSession' ? fmt1 : fmtN, categories: catsOf(u.buckets), series, onClick: (i) => zoomTo(u.buckets[i]) },
          extraOptions: () => [metricSel, h('label', { class: 'switch' }, cb, h('span', { class: 'track' }), 'Peer median')],
          calc: [
            `Metric: ${TRACK_METRICS[m]} per ${gl}${m === 'perSession' ? ' (visits \u00f7 sessions in that bucket)' : ''}.`,
            ...list.map((p) => (p.u ? `${p.name}: ${m === 'perSession' ? fmt1(p.u.tot.sessions ? p.u.tot.visits / p.u.tot.sessions : 0) : fmtN(m === 'sessions' ? p.u.tot.sessions : p.u.tot[m] ?? p.u.tot.visits)} over the period, active in ${fmtN(p.u.tot.activeBuckets)} of ${fmtN(u.buckets.length)} ${gl}s.` : null)),
            bench ? `Peer median: for each ${gl}, the median value among the ${fmtN(median(u.buckets.map((_, b) => u.users.filter((x) => x.active[b]).length)) || 0)} (median) people active in that ${gl}. People with no activity in a bucket are left out.` : null,
            missingNote(list), C.nameDedup,
          ],
        };
      },
    });

    const mix = card(T, {
      id: 'us-track-mix', title: 'What tracked users visit', sub: `Visits by content type per ${gl}, one chart per person`, span: 12,
      load: async () => {
        const [u, list] = await Promise.all([us(), picked()]);
        const rows = [];
        list.forEach((p) => { if (p.u) u.buckets.forEach((b, j) => rows.push({ user: p.name, period: b.label, start: b.startDate, end: b.endDate, sessions: p.u.sessions[j], ...Object.fromEntries(UA.TYPES.map((t) => [t, p.u[t][j]])), visits: p.u.visits[j] })); });
        return {
          render: (body) => {
            const gridEl = h('div', { class: 'multiples' });
            body.append(gridEl);
            list.forEach((p) => {
              const host = h('div', { class: 'chart-host' });
              gridEl.append(h('div', { class: 'multiple' }, h('div', { class: 'multiple-head' }, h('strong', { title: p.name }, p.name), h('span', { class: 'muted' }, p.u ? `${fmtN(p.u.tot.visits)} visits \u00b7 ${personaOf(p.u.tot.visits, p.u.tot.Dashboard)}` : 'no activity')), host));
              if (p.u) Charts.render(host, { kind: 'series', mode: 'bar', stacked: true, title: p.name, height: 150, legend: false, categories: catsOf(u.buckets), series: UA.TYPES.map((t, i) => ({ name: t, values: p.u[t], color: colorFor(t, i) })) });
              else host.append(stateEl('empty', 'No activity', 'This person had no recorded visits in the period.'));
            });
            body.append(h('div', { class: 'legend-row' }, UA.TYPES.map((t, i) => h('span', { class: 'legend-item' }, h('span', { class: 'dot', style: { background: colorFor(t, i) } }), t))));
          },
          dataset: { columns: [{ key: 'user', label: 'User' }, { key: 'period', label: 'Period' }, { key: 'start', label: 'Start', type: 'date' }, { key: 'end', label: 'End', type: 'date' }, { key: 'sessions', label: 'Sessions', type: 'number' }, ...UA.TYPES.map((t) => ({ key: t, label: `${t} visits`, type: 'number' })), { key: 'visits', label: 'Total visits', type: 'number' }], rows },
          calc: [...list.filter((p) => p.u).map((p) => `${p.name}: ${UA.TYPES.map((t) => `${t} ${fmtN(p.u.tot[t])}`).join(', ')} = ${fmtN(p.u.tot.visits)} visits; persona ${personaOf(p.u.tot.visits, p.u.tot.Dashboard)}.`), PERSONA_RULES, missingNote(list)],
        };
      },
    });

    const rateCard = card(T, {
      id: 'us-track-rate', title: 'Usage rate & retention by period', sub: 'Darker = higher usage rate (Low / Medium / High) \u00b7 hover for usage days and retention', span: 12, height: 200,
      load: async () => {
        const [rs, rt] = await Promise.all([rate(), ret()]);
        if (!rs) return { empty: { title: 'Not available', text: 'The usage-rate download couldn\u2019t be loaded.' } };
        const sameGran = rs.gran === g && rt;
        const values = names.map((n) => rs.buckets.map((_, j) => RATE_LEVEL[rs.users.get(n)?.rate[j]] || 0));
        const rows = [];
        names.forEach((n) => rs.buckets.forEach((b, j) => {
          const x = rs.users.get(n);
          rows.push({ user: n, period: b.label, start: b.startDate, end: b.endDate, rate: x?.rate[j] || '', days: x ? x.days[j] : 0, retention: sameGran ? rt.users.get(n)?.[j] || '' : '' });
        }));
        return {
          spec: {
            kind: 'heatmap', title: 'Usage rate & retention by period', rows: names.map((n) => truncate(n, 180, 11)), cols: rs.buckets.map((b) => b.label), values, cellH: 24,
            cellTip: (i, j) => { const x = rows[i * rs.buckets.length + j]; return `<div class="tt-title">${esc(x.user)}</div><div class="tt-sub">${esc(rs.buckets[j].full)}</div>${ttRow('', 'Usage rate', x.rate || 'Not active')}${ttRow('', 'Usage days', fmtN(x.days))}${x.retention ? ttRow('', 'Retention', x.retention) : ''}`; },
          },
          dataset: { columns: [{ key: 'user', label: 'User' }, { key: 'period', label: 'Period' }, { key: 'start', label: 'Start', type: 'date' }, { key: 'end', label: 'End', type: 'date' }, { key: 'rate', label: 'Usage rate' }, { key: 'days', label: 'Usage days', type: 'number' }, { key: 'retention', label: 'Retention' }], rows },
          note: rs.adjusted ? 'Usage rate isn\u2019t available per day, so weekly buckets are shown (retention is omitted).' : null,
          calc: [
            'Usage rate per bucket comes from Collibra: High = active more than 50% of the bucket\u2019s days, Medium = 20\u201350%, Low = less than 20%. Cells: High = darkest, empty = not active.',
            ...names.map((n) => { const x = rs.users.get(n); return x ? `${n}: ${fmtN(sum(x.days))} usage days; High in ${x.rate.filter((v) => v === 'High').length}, Medium in ${x.rate.filter((v) => v === 'Medium').length}, Low in ${x.rate.filter((v) => v === 'Low').length} ${rs.gran.toLowerCase()}s.` : `${n}: no usage-rate rows.`; }),
            sameGran ? 'Retention per bucket: Acquired = first visit ever, Retained = also active in the previous bucket, Returning = came back after a gap.' : null,
            C.nameDedup,
          ],
        };
      },
    });

    const contribCard = (id, what) => card(T, {
      id, title: what === 'edits' ? 'Edits by tracked users' : 'Ratings given by tracked users', sub: what === 'edits' ? `Audit-trail changes made per ${gl}` : `Ratings submitted per ${gl}`, span: 6, height: 260, chartTypes: ['bar', 'line'],
      load: async () => {
        const [con, list] = await Promise.all([contributions(), picked()]);
        const { buckets } = Data._buckets(r, g);
        const series = [];
        const calc = [];
        list.forEach((p, i) => {
          const c = con[i];
          if (!c.id) { calc.push(`${p.name}: couldn\u2019t match this name to a Collibra user, so ${what} aren\u2019t shown.`); return; }
          const d = c[what];
          if (!d) { calc.push(`${p.name}: ${what} couldn\u2019t be loaded.`); return; }
          series.push({ name: p.name, values: d.values, color: p.color });
          calc.push(`${p.name}: ${fmtN(d.total)} ${what} in the period${what === 'ratings' && d.avg != null ? `, average ${fmt1(d.avg)} stars` : ''}${d.capped ? ' (capped at 5,000 events)' : ''}.`);
        });
        calc.push(what === 'edits' ? 'Edits = audit-trail events performed by the user (any resource), counted by the day they happened.' : 'Ratings = ratings the user submitted, counted by creation date.');
        if (!series.length) return { empty: { title: 'Not available', text: 'None of the tracked users could be matched to a Collibra account.' }, calc };
        return { spec: { kind: 'series', mode: 'bar', title: what === 'edits' ? 'Edits by tracked users' : 'Ratings given by tracked users', height: 260, legend: 'always', categories: catsOf(buckets), series, emptyText: `No ${what} in this period`, onClick: (i) => zoomTo(buckets[i]) }, calc };
      },
    });

    const table = card(T, {
      id: 'us-track-table', title: 'Tracked users summary', sub: 'Usage, rank among active users, persona and contributions', span: 12,
      load: async () => {
        const [u, list, con, rs, rt] = await Promise.all([us(), picked(), contributions().catch(soft), rate(), ret()]);
        const allVisits = u.users.map((x) => x.tot.visits);
        const rows = list.map((p, i) => {
          const x = p.u;
          const pos = x ? u.users.indexOf(x) : -1;
          const rr = rs && rs.users.get(p.name);
          const latest = rr ? [...rr.rate].reverse().find(Boolean) || '' : '';
          const cats = rt && rt.users.get(p.name) ? uniq(rt.users.get(p.name).filter(Boolean)).join(', ') : '';
          const c = con && con[i];
          return {
            name: p.name, userId: c?.id || '', license: x?.license || '', roles: x?.roles || [], sessions: x ? x.tot.sessions : 0, visits: x ? x.tot.visits : 0,
            ...Object.fromEntries(UA.TYPES.map((t) => [t, x ? x.tot[t] : 0])),
            perSession: x && x.tot.sessions ? x.tot.visits / x.tot.sessions : null, activePct: x ? (x.tot.activeBuckets / u.buckets.length) * 100 : 0,
            first: x && x.first >= 0 ? u.buckets[x.first].startDate : '', last: x && x.last >= 0 ? u.buckets[x.last].startDate : '',
            rank: pos >= 0 ? pos + 1 : null, pctl: x ? percentileRank(allVisits, x.tot.visits) : null, persona: x ? personaOf(x.tot.visits, x.tot.Dashboard) : 'Inactive',
            rate: latest, usageDays: rr ? sum(rr.days) : null, retention: cats,
            edits: c?.edits ? c.edits.total : null, ratings: c?.ratings ? c.ratings.total : null,
          };
        });
        return {
          dataset: {
            columns: [
              { key: 'name', label: 'User', link: (x) => (isUuid(x.userId) ? Env.userUrl(x.userId) : null) },
              { key: 'license', label: 'License' },
              { key: 'roles', label: 'Roles', hidden: true },
              { key: 'persona', label: 'Persona' },
              { key: 'sessions', label: 'Sessions', type: 'number' },
              { key: 'visits', label: 'Visits', type: 'number', bar: true },
              ...UA.TYPES.map((t) => ({ key: t, label: `${t} visits`, type: 'number', hidden: t === 'Diagram' || t === 'Community' })),
              { key: 'perSession', label: 'Visits / session', type: 'number', format: fmt1 },
              { key: 'activePct', label: `Active ${gl}s %`, type: 'pct' },
              { key: 'first', label: `First active ${gl}`, type: 'date', hidden: true },
              { key: 'last', label: `Last active ${gl}`, type: 'date' },
              { key: 'rank', label: 'Rank (visits)', type: 'number', format: (v) => `#${fmtN(v)}`, sortValue: (x) => (x.rank == null ? null : -x.rank) },
              { key: 'pctl', label: 'Percentile', type: 'number', format: (v) => `${Math.round(v)}th` },
              { key: 'rate', label: 'Usage rate (latest)' },
              { key: 'usageDays', label: 'Usage days', type: 'number' },
              { key: 'retention', label: 'Retention', hidden: true },
              { key: 'edits', label: 'Edits', type: 'number' },
              { key: 'ratings', label: 'Ratings given', type: 'number' },
            ],
            rows,
          },
          tableOpts: { search: false, sort: 'visits', dir: 'desc' },
          calc: [
            `Rank and percentile compare each tracked person with all ${fmtN(u.users.length)} active people by total visits (percentile = % with fewer visits, ties count half).`,
            `Active ${gl}s % = ${gl}s with at least one session \u00f7 ${fmtN(u.buckets.length)} ${gl}s in the range.`,
            PERSONA_RULES,
            'Edits and ratings need the person\u2019s Collibra user ID, which is looked up by display name.',
            C.nameDedup,
          ],
        };
      },
    });

    return [grid(trend), grid(mix), grid(rateCard), grid(contribCard('us-track-edits', 'edits'), contribCard('us-track-ratings', 'ratings')), grid(table)];
  }

  /** Stickiness, seat utilization, churn, cohort retention and personas. */
  function populationCards(T, r, cr, g, detail) {
    const months = makeBuckets(r.startDate, r.endDate, 'Month').map((b) => ({ ...b, label: bucketLabel(b, 'Month'), full: bucketFull(b, 'Month') }));

    const stickiness = card(T, {
      id: 'us-stickiness', title: 'Stickiness (DAU/MAU)', sub: 'How many of a month\u2019s users come back on a typical day or week', span: 6, height: 260, chartTypes: ['line', 'bar'],
      load: async () => {
        const [d, w, m] = await Promise.all([Data.userTrend('license', r, 'Day'), Data.userTrend('license', r, 'Week'), Data.userTrend('license', r, 'Month')]);
        const rows = months.map((mb) => {
          const days = d.rows.filter((x) => x.startDate >= mb.startDate && x.startDate <= mb.endDate);
          const weeks = w.rows.filter((x) => x.bucketStartDate >= mb.bucketStartDate && x.bucketStartDate <= mb.bucketEndDate);
          const mau = m.rows.find((x) => x.bucketStartDate === mb.bucketStartDate)?.total || 0;
          const dau = days.length ? sum(days, (x) => x.total) / days.length : 0;
          const wau = weeks.length ? sum(weeks, (x) => x.total) / weeks.length : 0;
          return { ...mb, mau, dau, wau, dauMau: mau ? (dau / mau) * 100 : null, wauMau: mau ? (wau / mau) * 100 : null, days: days.length };
        });
        const valid = rows.filter((x) => x.mau);
        if (!valid.length) return { empty: { title: 'No active users', text: 'Nobody signed in during this period.' } };
        const avg = (k) => sum(valid, (x) => x[k]) / valid.length;
        return {
          stats: [
            { label: 'DAU/MAU', value: avg('dauMau'), display: fmtPct(avg('dauMau')), primary: true, hint: 'Average daily active users \u00f7 monthly active users, averaged over months' },
            { label: 'WAU/MAU', value: avg('wauMau'), display: fmtPct(avg('wauMau')), hint: 'Average weekly active users \u00f7 monthly active users' },
            { label: 'Avg DAU', value: avg('dau'), display: fmt1(avg('dau')) },
            { label: 'Avg MAU', value: avg('mau'), display: fmt1(avg('mau')) },
          ],
          spec: {
            kind: 'series', mode: 'line', title: 'Stickiness (DAU/MAU)', height: 260, legend: 'always', integer: false, yFormat: (v) => `${fmtN(v)}%`, valueFormat: (v) => fmtPct(v), categories: catsOf(rows),
            series: [{ name: 'DAU/MAU', values: rows.map((x) => x.dauMau), color: Theme.palette[0] }, { name: 'WAU/MAU', values: rows.map((x) => x.wauMau), color: Theme.palette[5] }],
          },
          dataset: {
            columns: [{ key: 'label', label: 'Month' }, { key: 'startDate', label: 'Start', type: 'date' }, { key: 'endDate', label: 'End', type: 'date' }, { key: 'days', label: 'Days', type: 'number' },
              { key: 'dau', label: 'Avg daily active', type: 'number', format: fmt1 }, { key: 'wau', label: 'Avg weekly active', type: 'number', format: fmt1 }, { key: 'mau', label: 'Monthly active', type: 'number' },
              { key: 'dauMau', label: 'DAU/MAU %', type: 'pct' }, { key: 'wauMau', label: 'WAU/MAU %', type: 'pct' }],
            rows,
          },
          note: rows.some((x) => x.startDate !== x.bucketStartDate || x.endDate !== x.bucketEndDate) ? 'Partial months at the edges of the range use only the days inside the range.' : null,
          calc: [
            ...valid.map((x) => `${x.label}: DAU ${fmt1(x.dau)} (avg of ${fmtN(x.days)} days) \u00f7 MAU ${fmtN(x.mau)} = ${fmtPct(x.dauMau)}; WAU ${fmt1(x.wau)} \u00f7 ${fmtN(x.mau)} = ${fmtPct(x.wauMau)}.`),
            `Headline = average over ${plural(valid.length, 'month')} with activity.`,
          ],
        };
      },
    });

    const seats = card(T, {
      id: 'us-seats', title: 'License seat utilization', sub: 'Active users \u00f7 all known users, per license type', span: 6,
      load: async () => {
        const [act, ina] = await Promise.all([detail(), Data.userDetail(r, 'Inactive')]);
        const m = new Map();
        const add = (u, k) => { const l = u.license || '(unknown)'; const e = m.get(l) || { license: l, active: 0, inactive: 0 }; e[k]++; m.set(l, e); };
        act.forEach((u) => add(u, 'active'));
        ina.forEach((u) => add(u, 'inactive'));
        const rows = [...m.values()].map((e) => ({ ...e, total: e.active + e.inactive, pct: e.active + e.inactive ? (e.active / (e.active + e.inactive)) * 100 : 0 })).sort((a, b) => b.total - a.total);
        if (!rows.length) return { empty: { title: 'No users', text: 'No users match the filters.' } };
        const ta = sum(rows, (x) => x.active), tt = sum(rows, (x) => x.total);
        return {
          stats: [{ label: 'Overall utilization', value: tt ? (ta / tt) * 100 : null, display: fmtPct(tt ? (ta / tt) * 100 : null), primary: true }, { label: 'Unused seats', value: tt - ta, hint: 'Known users with no sign-in in the period' }],
          spec: { kind: 'hbar', title: 'License seat utilization', valueLabel: 'Utilization', valueFormat: (v) => fmtPct(v), color: colorFor('Active'), items: rows.map((x) => ({ label: x.license, value: x.pct, sub: `${fmtN(x.active)} active of ${fmtN(x.total)} users \u00b7 ${fmtN(x.inactive)} unused` })) },
          dataset: { columns: [{ key: 'license', label: 'License type' }, { key: 'active', label: 'Active users', type: 'number' }, { key: 'inactive', label: 'Inactive users', type: 'number' }, { key: 'total', label: 'Known users', type: 'number' }, { key: 'pct', label: 'Utilization %', type: 'pct' }], rows },
          calc: [...rows.map((x) => `${x.license}: ${fmtN(x.active)} \u00f7 (${fmtN(x.active)} + ${fmtN(x.inactive)}) = ${fmtPct(x.pct)}`), `Overall: ${fmtN(ta)} \u00f7 ${fmtN(tt)} = ${fmtPct(tt ? (ta / tt) * 100 : null)}.`, C.nameDedup],
        };
      },
    });

    const churn = card(T, {
      id: 'us-churn', title: 'Churned, reactivated & continuing', sub: cr ? `Who came, stayed or left vs ${State.compareLabel()}` : 'Needs a comparison period', span: 6, height: 240,
      load: async () => {
        if (!cr) return { empty: { title: 'No comparison period', text: 'Set \u201cCompare to\u201d to see churned and reactivated users.' } };
        const [now, before, fresh] = await Promise.all([detail(), Data.userDetail(cr, 'Active'), Data.userDetail(r, 'New').catch(soft)]);
        const nowM = new Map(now.map((u) => [u.name, u])), prevM = new Map(before.map((u) => [u.name, u]));
        const newSet = new Set((fresh || []).map((u) => u.name));
        const rows = [];
        for (const u of now) rows.push({ name: u.name, license: u.license, status: prevM.has(u.name) ? 'Continuing' : newSet.has(u.name) ? 'New' : 'Reactivated', now: u.visits, before: prevM.get(u.name)?.visits || 0 });
        for (const u of before) if (!nowM.has(u.name)) rows.push({ name: u.name, license: u.license, status: 'Churned', now: 0, before: u.visits });
        const order = ['New', 'Reactivated', 'Continuing', 'Churned'];
        const counts = Object.fromEntries(order.map((k) => [k, rows.filter((x) => x.status === k).length]));
        const colors = { New: Theme.v('--good'), Reactivated: Theme.palette[5], Continuing: Theme.palette[0], Churned: Theme.v('--bad') };
        const churnRate = before.length ? (counts.Churned / before.length) * 100 : null;
        return {
          stats: [{ label: 'Churn rate', value: churnRate, display: fmtPct(churnRate), primary: true, hint: 'Churned \u00f7 active in the comparison period' }, { label: 'Retention rate', value: before.length ? (counts.Continuing / before.length) * 100 : null, display: fmtPct(before.length ? (counts.Continuing / before.length) * 100 : null), hint: 'Continuing \u00f7 active in the comparison period' }],
          spec: { kind: 'donut', title: 'Churned, reactivated & continuing', items: order.map((k) => ({ label: k, value: counts[k], color: colors[k] })), centerLabel: 'people', valueLabel: 'People' },
          dataset: { columns: [{ key: 'name', label: 'User' }, { key: 'license', label: 'License' }, { key: 'status', label: 'Status' }, { key: 'now', label: 'Visits now', type: 'number' }, { key: 'before', label: `Visits, ${State.compareLabel()}`, type: 'number' }], rows },
          tableOpts: { sort: 'status', dir: 'asc' },
          calc: [
            `Now: ${fmtN(now.length)} active people; comparison (${fmtRange(cr.startDate, cr.endDate)}): ${fmtN(before.length)}.`,
            `New: ${fmtN(counts.New)} (first visit ever in this period). Reactivated: ${fmtN(counts.Reactivated)} (active now, not in the comparison period, not new). Continuing: ${fmtN(counts.Continuing)} (active in both). Churned: ${fmtN(counts.Churned)} (active before, not now).`,
            churnRate != null ? `Churn rate = ${fmtN(counts.Churned)} \u00f7 ${fmtN(before.length)} = ${fmtPct(churnRate)}. Retention rate = ${fmtN(counts.Continuing)} \u00f7 ${fmtN(before.length)} = ${fmtPct((counts.Continuing / before.length) * 100)}.` : null,
            C.nameDedup,
          ],
        };
      },
    });

    const cg = g === 'Day' ? 'Week' : g;
    const cohort = card(T, {
      id: 'us-cohort', title: 'Cohort retention', sub: `Rows: people grouped by their first active ${cg.toLowerCase()} in the range \u00b7 columns: % still active N ${cg.toLowerCase()}s later`, span: 12, height: 300,
      load: async () => {
        const u = await Data.userSeries(r, cg, 'Active');
        const n = u.buckets.length;
        if (n < 2) return { empty: { title: 'Range too short', text: `Cohorts need at least two ${cg.toLowerCase()}s. Choose a longer range or a finer granularity.` } };
        const cohorts = u.buckets.map((b, i) => ({ b, i, members: u.users.filter((x) => x.first === i) })).filter((c) => c.members.length);
        const values = cohorts.map((c) => Array.from({ length: n }, (_, k) => (c.i + k < n ? (c.members.filter((x) => x.active[c.i + k]).length / c.members.length) * 100 : null)));
        const rows = cohorts.map((c, ci) => ({ cohort: c.b.label, start: c.b.startDate, size: c.members.length, ...Object.fromEntries(values[ci].map((v, k) => [`k${k}`, v == null ? null : Math.round(v * 10) / 10])) }));
        return {
          spec: {
            kind: 'heatmap', title: 'Cohort retention', rows: cohorts.map((c) => `${c.b.label} (${fmtN(c.members.length)})`), cols: Array.from({ length: n }, (_, k) => `+${k}`), values, cellH: 22,
            cellTip: (i, k, v) => `<div class="tt-title">${esc(cohorts[i].b.full)} cohort</div>${ttRow('', 'Size', fmtN(cohorts[i].members.length))}${ttRow('', `${cg} +${k}`, v == null ? '\u2013' : fmtPct(v))}${ttRow('', 'Active', v == null ? '\u2013' : fmtN(Math.round((v / 100) * cohorts[i].members.length)))}`,
          },
          dataset: { columns: [{ key: 'cohort', label: 'Cohort' }, { key: 'start', label: 'Start', type: 'date' }, { key: 'size', label: 'People', type: 'number' }, ...Array.from({ length: n }, (_, k) => ({ key: `k${k}`, label: `+${k} %`, type: 'pct' }))], rows },
          note: g === 'Day' ? 'Cohorts use weekly buckets when Day granularity is selected.' : null,
          calc: [
            `${plural(cohorts.length, 'cohort')} from ${fmtN(u.users.length)} active people. A person\u2019s cohort is their first active ${cg.toLowerCase()} within the selected range.`,
            `Cell (+k) = people in the cohort active k ${cg.toLowerCase()}s after their first ${cg.toLowerCase()} \u00f7 cohort size \u00d7 100. Column +0 is always 100%.`,
            'Approximation: people who were already users before the range start are placed in the cohort of their first activity inside the range, not their true first visit.',
            C.nameDedup,
          ],
        };
      },
    });

    const personas = card(T, {
      id: 'us-personas', title: 'Usage personas', sub: 'People grouped by what they visit', span: 6, height: 240,
      load: async () => {
        const users = await detail();
        const rows = users.map((u) => ({ name: u.name, license: u.license, persona: personaOf(u.visits, u.Dashboard), visits: u.visits, dash: u.Dashboard, share: u.visits ? (u.Dashboard / u.visits) * 100 : 0, sessions: u.sessions }));
        if (!rows.length) return { empty: { title: 'No active users', text: 'Nobody was active in this period.' } };
        const counts = Object.fromEntries(PERSONAS.map((p) => [p, rows.filter((x) => x.persona === p).length]));
        return {
          spec: { kind: 'donut', title: 'Usage personas', items: PERSONAS.map((p, i) => ({ label: p, value: counts[p], color: [colorFor('Dashboard'), Theme.palette[5], colorFor('Asset'), Theme.v('--text-3')][i] })), centerLabel: 'people', valueLabel: 'People' },
          dataset: { columns: [{ key: 'name', label: 'User' }, { key: 'license', label: 'License' }, { key: 'persona', label: 'Persona' }, { key: 'visits', label: 'Visits', type: 'number' }, { key: 'dash', label: 'Dashboard visits', type: 'number' }, { key: 'share', label: 'Dashboard share %', type: 'pct' }, { key: 'sessions', label: 'Sessions', type: 'number' }], rows },
          tableOpts: { sort: 'visits', dir: 'desc' },
          calc: [PERSONA_RULES, ...PERSONAS.map((p) => `${p}: ${plural(counts[p], 'person')} (${fmtPct((counts[p] / rows.length) * 100)}).`), C.nameDedup],
        };
      },
    });

    return { stickiness, seats, churn, cohort, personas };
  }

  function buildUsers(panel) {
    const T = 'users';
    const r = State.range(), cr = State.compareRange(), g = State.gran();
    const pop = State.s.utype;
    const ignored = FILTERS.filter((f) => !f.services.includes('users') && State.s.f[f.key].length).map((f) => f.label);

    panel.append(panelIntro('Users & adoption', `${fmtRange(r.startDate, r.endDate)}${ignored.length ? ` · ${ignored.join(' and ')} filters don\u2019t apply to user metrics` : ''}`,
      pickerButton('Track users', State.s.users.length, (btn) => openListPicker(btn, {
        title: 'Users to track',
        max: MAX_TRACKED_USERS,
        selected: State.s.users,
        footNote: `Up to ${MAX_TRACKED_USERS} people active in this period`,
        load: async () => (await useries()).users.map((u) => ({ id: u.name, label: u.name, meta: `${u.license || 'no license'} \u00b7 ${fmtN(u.tot.visits)} visits` })),
        onApply: (ids) => App.update({ users: ids }),
      })),
      segmented(UA.USER_TYPES, pop, (v) => App.update({ utype: v }), 'User population', (v) => `${v} users`)));

    const useries = memo(() => Data.userSeries(r, g, 'Active'));
    if (State.s.users.length) {
      panel.append(h('div', { class: 'section-head' }, h('h3', null, 'Tracked users'),
        h('div', { class: 'active-filters sel-chips' }, State.s.users.map((n) => selChip(n, () => App.update({ users: State.s.users.filter((x) => x !== n) }))),
          h('button', { class: 'chip-clear', type: 'button', onclick: () => App.update({ users: [] }) }, 'Stop tracking'))));
      panel.append(...trackedUserCards(T, r, g, useries));
      panel.append(h('div', { class: 'section-head' }, h('h3', null, 'All users')));
    }

    const detail = memo(() => Data.userDetail(r, 'Active'));
    const rateDetail = memo(() => Data.usageRateDetail(r, g).catch(soft));
    const retDetail = memo(() => Data.retentionDetail(r, g).catch(soft));

    const kpis = kpiStrip(T, {
      id: 'us-kpis', count: 6,
      load: async () => {
        const [u0, u1, users, rates] = await Promise.all([Data.userSummary(r), cr ? Data.userSummary(cr) : null, detail().catch(soft), rateDetail()]);
        const sessions = users ? sum(users, (u) => u.sessions) : null;
        const visits = users ? sum(users, (u) => u.visits) : null;
        const n = users ? users.length : 0;
        const power = rates ? [...rates.values()].filter((x) => x.rates.has('High')).length : null;
        const rateG = g === 'Day' ? 'Week' : g;
        return [
          { label: 'Active users', info: 'activeUsers', value: u0.Active, prev: u1?.Active, delta: u1 ? pctChange(u0.Active, u1.Active) : null, color: colorFor('Active'), meta: 'visited at least once',
            calc: [`${fmtN(u0.Active)} distinct ${u0.Active === 1 ? 'person' : 'people'} signed in at least once. Each person is counted once.`, cmpCalc(u0.Active, u1?.Active)] },
          { label: 'New users', info: 'newUsers', value: u0.New, prev: u1?.New, delta: u1 ? pctChange(u0.New, u1.New) : null, color: colorFor('New'), meta: 'first visit in period',
            calc: [`${fmtN(u0.New)} distinct ${u0.New === 1 ? 'person' : 'people'} signed in for the first time ever.`, cmpCalc(u0.New, u1?.New)] },
          { label: 'Inactive users', info: 'inactiveUsers', value: u0.Inactive, prev: u1?.Inactive, delta: u1 ? pctChange(u0.Inactive, u1.Inactive) : null, invert: true, color: colorFor('Inactive'), meta: 'no visits in period',
            calc: [`${fmtN(u0.Inactive)} distinct ${u0.Inactive === 1 ? 'user' : 'users'} didn\u2019t sign in during the period.`, cmpCalc(u0.Inactive, u1?.Inactive)] },
          { label: 'Sessions per user', info: 'sessionsPerUser', value: n ? sessions / n : null, display: n ? fmt1(sessions / n) : '–', color: Theme.palette[3], meta: sessions != null ? `${fmtN(sessions)} sessions total` : '',
            calc: n ? [`${fmtN(sessions)} sessions \u00f7 ${fmtN(n)} distinct active users = ${fmt1(sessions / n)}.`] : [] },
          { label: 'Visits per session', info: 'visitsPerSession', value: sessions ? visits / sessions : null, display: sessions ? fmt1(visits / sessions) : '–', color: Theme.palette[7], meta: visits != null ? `${fmtN(visits)} visits total` : '',
            calc: sessions ? [`${fmtN(visits)} visits \u00f7 ${fmtN(sessions)} sessions = ${fmt1(visits / sessions)}.`] : [] },
          { label: 'High-usage users', info: 'highUsage', value: power, color: colorFor('High'), meta: power != null && n ? `${fmtPct((power / n) * 100, 0)} of active users` : 'usage rate "High"',
            calc: power != null ? [`${fmtN(power)} of ${fmtN(rates.size)} distinct users had a High usage rate in at least one ${rateG.toLowerCase()}.`, n ? `${fmtN(power)} \u00f7 ${fmtN(n)} active users = ${fmtPct((power / n) * 100, 0)}.` : null] : [] },
        ];
      },
    });

    const trendCard = (id, kind, title, sub, extra = {}) => card(T, {
      id, title, sub, span: 6, height: 280, chartTypes: ['bar', 'area', 'line'], stackable: true,
      load: async () => {
        const t = await Data.userTrend(kind, r, g, pop);
        const series = t.categories.map((c, i) => ({ name: c, values: t.rows.map((x) => x[c]), color: colorFor(c, i) }));
        const gl = t.gran.toLowerCase();
        const peak = t.rows.reduce((a, x) => (x.total > (a ? a.total : -1) ? x : a), null);
        return {
          spec: { kind: 'series', mode: 'bar', stacked: true, title, height: 280, categories: catsOf(t.rows), series, emptyText: 'No users in this period', onClick: (i) => zoomTo(t.rows[i]), ...extra },
          note: t.adjusted ? `Usage rate isn\u2019t available per day, so weekly buckets are shown.` : null,
          calc: [
            kind === 'license' ? `Population: ${pop} users.` : null,
            `Totals per category across ${plural(t.rows.length, `${gl} bucket`)}: ${t.categories.map((c) => `${c} ${fmtN(sum(t.rows, (x) => x[c]))}`).join(', ') || 'none'}.`,
            `These are user-${gl}s, not people: ${fmtN(sum(t.rows, (x) => x.total))} in total across all buckets.`,
            peak && peak.total ? `Largest bucket: ${peak.full} with ${fmtN(peak.total)} distinct users.` : null,
          ],
        };
      },
    });

    const rate = trendCard('us-rate', 'usageRate', 'Usage rate', 'Users by how often they used Collibra (High / Medium / Low)');
    const retention = trendCard('us-retention', 'retention', 'Retention', 'Acquired = first visit · Retained = also active in the previous bucket · Returning = came back after a gap');
    const license = trendCard('us-license', 'license', `${pop} users by license type`, 'Required license of each user', { legend: 'always' });

    const funnel = card(T, {
      id: 'us-funnel', title: 'Adoption funnel', sub: 'From enabled accounts to engaged users', span: 6,
      load: async () => {
        const [u0, totals, users, rates] = await Promise.all([Data.userSummary(r), Data.catalogTotals().catch(soft), detail().catch(soft), rateDetail()]);
        const stages = [];
        if (totals && totals.users != null) stages.push({ label: 'Enabled users', value: totals.users, sub: 'All enabled Collibra accounts' });
        stages.push({ label: 'Active users', value: u0.Active, sub: 'At least one visit' });
        if (users) stages.push({ label: 'Repeat users', value: users.filter((u) => u.sessions >= 2).length, sub: '2 or more sessions' });
        if (rates) stages.push({ label: 'Engaged users', value: [...rates.values()].filter((x) => x.rates.has('High') || x.rates.has('Medium')).length, sub: 'Medium or High usage rate' });
        return {
          spec: { kind: 'funnel', title: 'Adoption funnel', stages },
          dataset: { columns: [{ key: 'label', label: 'Stage' }, { key: 'sub', label: 'Definition' }, { key: 'value', label: 'Users', type: 'number' }, { key: 'pct', label: '% of first stage', type: 'pct' }], rows: stages.map((x) => ({ ...x, pct: stages[0].value ? (x.value / stages[0].value) * 100 : null })) },
          calc: stages.map((x) => `${x.label} (${x.sub.toLowerCase()}): ${fmtN(x.value)} distinct ${x.value === 1 ? 'person' : 'people'}${stages[0].value ? ` = ${fmtPct((x.value / stages[0].value) * 100)} of ${stages[0].label.toLowerCase()}` : ''}.`),
        };
      },
    });

    const top = card(T, {
      id: 'us-top', title: 'Most active users', sub: 'Top 25 by visits', span: 6,
      load: async () => {
        const rows = await Data.userTop(25, r);
        if (!rows.length) return { empty: { title: 'No active users', text: 'Nobody visited Collibra in this period with the current filters.' } };
        return {
          spec: { kind: 'hbar', title: 'Most active users', valueLabel: 'Visits', color: colorFor('Active'), rowH: 24, items: rows.map((x) => ({ label: x.name, value: x.visits })) },
          dataset: { columns: [{ key: 'rank', label: '#', type: 'number' }, { key: 'name', label: 'User', link: (x) => (isUuid(x.id) ? Env.userUrl(x.id) : null) }, { key: 'visits', label: 'Visits', type: 'number', bar: true }], rows },
          calc: [`Showing ${plural(rows.length, 'person')} (each once); #1 is ${rows[0].name} with ${plural(rows[0].visits, 'visit')}.`, `Together they made ${fmtN(sum(rows, (x) => x.visits))} visits.`],
        };
      },
    });

    const scatter = card(T, {
      id: 'us-scatter', title: 'Sessions vs. visits', sub: 'Each dot is an active user', span: 12, height: 300,
      load: async () => {
        const users = await detail();
        if (!users.length) return { empty: { title: 'No active users', text: 'Nobody visited Collibra in this period.' } };
        return {
          spec: { kind: 'scatter', title: 'Sessions vs. visits', height: 300, xLabel: 'Sessions', yLabel: 'Visits', xName: 'Sessions', yName: 'Visits', points: users.map((u) => ({ x: u.sessions, y: u.visits, label: u.name, sub: u.license, color: colorFor('Active') })) },
          dataset: { columns: [{ key: 'name', label: 'User' }, { key: 'sessions', label: 'Sessions', type: 'number' }, { key: 'visits', label: 'Visits', type: 'number' }], rows: users },
          calc: [`${plural(users.length, 'dot')}, one per distinct person.`, `${fmtN(sum(users, (u) => u.sessions))} sessions and ${fmtN(sum(users, (u) => u.visits))} visits in total.`, `Most sessions: ${[...users].sort((a, b) => b.sessions - a.sessions)[0].name}.`],
        };
      },
    });

    const table = card(T, {
      id: 'us-table', title: `${pop} users`, info: 'us-table', sub: 'Per-user detail from Usage Analytics (sessions, visits by content type, usage rate, retention)', span: 12,
      load: async () => {
        const [users, rates, ret] = await Promise.all([Data.userDetail(r, pop), rateDetail(), retDetail()]);
        if (!users.length) return { empty: { title: `No ${pop.toLowerCase()} users`, text: 'No users match this population and filter combination.' } };
        const rows = users.map((u) => {
          const rd = rates && rates.get(u.name);
          const rt = ret && ret.get(u.name);
          return { ...u, roleCount: u.roles.length, rate: rd ? rd.latest : '', days: rd ? rd.days : null, retention: rt ? [...rt.cats].join(', ') : '', perSession: u.sessions ? u.visits / u.sessions : null };
        });
        return {
          dataset: {
            columns: [
              { key: 'name', label: 'User' },
              { key: 'license', label: 'License' },
              { key: 'roleCount', label: 'Roles', type: 'number', render: (x) => h('span', { title: x.roles.join('\n') }, fmtN(x.roleCount)) },
              { key: 'roles', label: 'Role names', hidden: true },
              { key: 'sessions', label: 'Sessions', type: 'number' },
              ...UA.TYPES.map((t) => ({ key: t, label: `${t} visits`, type: 'number', hidden: t === 'Diagram' })),
              { key: 'visits', label: 'Total visits', type: 'number', bar: true },
              { key: 'perSession', label: 'Visits / session', type: 'number', format: fmt1 },
              { key: 'rate', label: 'Usage rate (latest)' },
              { key: 'days', label: 'Usage days', type: 'number' },
              { key: 'retention', label: 'Retention' },
            ],
            rows,
          },
          tableOpts: { sort: 'visits', dir: 'desc', searchPlaceholder: 'Search users, licenses, roles…' },
          calc: [
            `${plural(rows.length, 'person')} in the ${pop.toLowerCase()} population, one row each (deduplicated by name).`,
            `${fmtN(sum(rows, (x) => x.sessions))} sessions and ${fmtN(sum(rows, (x) => x.visits))} visits in total.`,
            `Visits / session = each person\u2019s total visits \u00f7 their sessions.`,
          ],
        };
      },
    });

    const unique = uniqueActiveCard(T, 'us-unique', r, g);
    const pc = populationCards(T, r, cr, g, detail);

    panel.append(kpis.el, grid(unique, funnel), grid(pc.stickiness, pc.seats), grid(rate, retention), grid(pc.churn, pc.personas), grid(pc.cohort), grid(license, top), grid(scatter), grid(table));
    runAll(T);
  }

  /* ────────────────────────────────────────────────────────────────────────
     Tab: Asset Explorer
     ──────────────────────────────────────────────────────────────────────── */

  function assetSearchBox(current) {
    const input = h('input', { type: 'search', placeholder: 'Search any asset by name, or paste an asset ID…  ( / )', 'aria-label': 'Search assets', id: 'asset-search', autocomplete: 'off', role: 'combobox', 'aria-expanded': 'false', 'aria-controls': 'asset-suggest' });
    const list = h('div', { class: 'suggest', id: 'asset-suggest', role: 'listbox' });
    list.hidden = true;
    let items = [], active = -1, seq = 0;
    const pick = (it) => { list.hidden = true; input.value = it.name || ''; App.update({ asset: it.id }); };
    const draw = () => {
      list.replaceChildren(...items.map((it, i) => h('button', { type: 'button', role: 'option', class: i === active ? 'active' : null, 'aria-selected': String(i === active), onmousedown: (e) => { e.preventDefault(); pick(it); } },
        h('span', { class: 's-name' }, it.name), h('span', { class: 's-meta' }, [it.type, it.domain, it.community].filter(Boolean).join(' · ')))));
      if (!items.length) list.replaceChildren(h('div', { class: 'menu-empty' }, 'No matching assets'));
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
    };
    const search = debounce(async () => {
      const q = input.value.trim();
      if (isUuid(q)) { items = [{ id: q, name: q, type: 'Open asset by ID' }]; active = 0; draw(); return; }
      if (q.length < 2) { list.hidden = true; return; }
      const my = ++seq;
      try {
        const res = await Data.searchAssets(q);
        if (my !== seq) return;
        items = res; active = -1; draw();
      } catch (e) { if (!isAbort(e)) { items = []; draw(); } }
    }, 250);
    input.addEventListener('input', search);
    input.addEventListener('keydown', (e) => {
      if (list.hidden) return;
      if (e.key === 'ArrowDown') { active = Math.min(items.length - 1, active + 1); draw(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { active = Math.max(0, active - 1); draw(); e.preventDefault(); }
      else if (e.key === 'Enter' && items[Math.max(0, active)]) { pick(items[Math.max(0, active)]); e.preventDefault(); }
      else if (e.key === 'Escape') { list.hidden = true; }
    });
    input.addEventListener('blur', () => setTimeout(() => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); }, 150));
    const box = h('div', { class: 'search-box' }, input, list);
    if (current) input.placeholder = 'Search another asset…  ( / )';
    return box;
  }

  function buildAsset(panel) {
    const T = 'asset';
    const r = State.range(), cr = State.compareRange(), g = State.gran();
    const id = State.s.asset;
    panel.append(panelIntro('Asset explorer', 'Drill into the usage of a single asset', assetSearchBox(id),
      id ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => App.update({ asset: '' }) }, 'Clear') : null));

    if (!id) {
      const quick = (cid, title, sub, loader) => card(T, {
        id: cid, title, sub, span: 6,
        load: async () => {
          const rows = await loader();
          if (!rows.length) return { empty: { title: 'Nothing here yet', text: 'Search for an asset above.' } };
          return {
            render: (b) => b.append(h('div', { class: 'quick-list' }, rows.map((x) => h('button', { type: 'button', onclick: () => openAsset(x.id) }, x.name, x.badge ? h('span', { class: 'tag tag-brand' }, x.badge) : null)))),
            dataset: { columns: [{ key: 'name', label: 'Asset', link: (x) => Env.assetUrl(x.id) }, { key: 'badge', label: 'Info' }], rows },
            calc: [`${plural(rows.length, 'asset')} listed. Click one to explore it.`],
          };
        },
      });
      panel.append(grid(
        quick('as-quick-top', 'Most visited in this period', fmtRange(r.startDate, r.endDate), async () => (await Data.contentTop('Asset', 20, r)).map((x) => ({ id: x.id, name: x.name, badge: plural(x.visits, 'visit') }))),
        quick('as-quick-recent', 'Recently viewed by you', 'From your own navigation history', async () => ((await Data.recentlyViewed(20)).results || []).map((x) => ({ id: x.assetId || x.asset?.id, name: x.name || x.asset?.name, badge: x.lastViewedDate ? relTime(x.lastViewedDate) : '' })).filter((x) => isUuid(x.id))),
      ));
      runAll(T);
      return;
    }

    const details = memo(() => Data.assetDetails(id));

    const head = card(T, {
      id: 'as-head', title: 'Asset', span: 12,
      load: async () => {
        const a = await details();
        return {
          render: (b) => {
            head.el.querySelector('.card-head').hidden = true;
            b.append(h('div', { class: 'asset-head' },
              h('div', { class: 'grow' },
                h('h2', null, a.name || a.displayName || '(unnamed)'),
                h('div', { class: 'crumbs' },
                  a.type?.name ? h('span', { class: 'tag tag-brand' }, a.type.name) : null,
                  a.status?.name ? h('span', { class: 'tag' }, a.status.name) : null,
                  a.community ? h('a', { href: Env.communityUrl(a.community.id), target: '_blank', rel: 'noopener' }, a.community.name) : null,
                  a.community ? h('span', null, '›') : null,
                  a.domain ? h('a', { href: Env.domainUrl(a.domain.id), target: '_blank', rel: 'noopener' }, a.domain.name) : null),
                a.fullName && a.fullName !== a.name ? h('div', { class: 'note mono' }, a.fullName) : null),
              h('div', { class: 'panel-controls' },
                h('button', { class: 'btn btn-ghost btn-sm', type: 'button', title: 'Add this asset to the Compare tab', onclick: () => addToCompare('Asset', id) }, '+ Compare'),
                h('a', { class: 'btn btn-primary btn-sm', href: Env.assetUrl(id), target: '_blank', rel: 'noopener' }, 'Open in Collibra'))));
          },
          dataset: { columns: [{ key: 'k', label: 'Property' }, { key: 'v', label: 'Value' }], rows: [
            { k: 'Name', v: a.name }, { k: 'ID', v: id }, { k: 'Type', v: a.type?.name || '' }, { k: 'Status', v: a.status?.name || '' },
            { k: 'Domain', v: a.domain?.name || '' }, { k: 'Community', v: a.community?.name || '' }, { k: 'URL', v: Env.assetUrl(id) },
          ] },
        };
      },
    });

    const kpis = kpiStrip(T, {
      id: 'as-kpis', count: 6,
      load: async () => {
        const [sm, cur, prev, ratings] = await Promise.all([
          Data.assetSummary(id), Data.assetTrend(id, r, g), cr ? Data.assetTrend(id, cr, g) : null,
          Api.get('/rest/2.0/ratings', { assetId: id, limit: 1000 }).catch(soft),
        ]);
        const inPeriod = sum(cur.rows, (x) => x.count);
        const before = prev ? sum(prev.rows, (x) => x.count) : null;
        const rs = ratings ? ratings.results || [] : [];
        const avg = rs.length ? (sum(rs, (x) => x.rating) / rs.length) * 5 : null;
        const a = await details().catch(soft);
        const mod = a && (a.modifiedOn || a.lastModifiedOn);
        return [
          { label: 'Visits in period', info: 'assetVisitsPeriod', value: inPeriod, prev: before, delta: before != null ? pctChange(inPeriod, before) : null, spark: cur.rows.map((x) => x.count), color: Theme.palette[0],
            calc: [`${fmtN(inPeriod)} visits = sum of ${plural(cur.rows.length, `${g.toLowerCase()} bucket`)}.`, cmpCalc(inPeriod, before)] },
          { label: 'All-time visits', info: 'assetVisitsAll', value: sm.totalVisitCount || 0, color: Theme.palette[1], meta: 'since Usage Analytics started',
            calc: [`${fmtN(sm.totalVisitCount || 0)} visits recorded for this asset since tracking began.`, sm.uniqueVisitorCount ? `That is ${fmt1((sm.totalVisitCount || 0) / sm.uniqueVisitorCount)} visits per unique visitor.` : null] },
          { label: 'Unique visitors', info: 'assetVisitors', value: sm.uniqueVisitorCount || 0, color: Theme.palette[5], meta: 'all time',
            calc: [`${fmtN(sm.uniqueVisitorCount || 0)} distinct ${sm.uniqueVisitorCount === 1 ? 'person has' : 'people have'} visited this asset, each counted once.`] },
          { label: 'First visit', info: 'assetFirstVisit', value: null, display: sm.firstVisitDate ? fmtDateShort(sm.firstVisitDate) : '–', color: Theme.palette[3], meta: sm.firstVisitDate ? toD(sm.firstVisitDate).getUTCFullYear() : 'never visited', metaText: sm.firstVisitDate || '',
            calc: [sm.firstVisitDate ? `First recorded visit: ${fmtDate(sm.firstVisitDate)}.` : 'No visit has been recorded for this asset.'] },
          { label: 'Rating', info: 'assetRating', value: avg, display: avg != null ? fmt1(avg) : '–', unit: avg != null ? '/ 5' : '', color: Theme.v('--warn'), meta: `${fmtN(rs.length)} rating${rs.length === 1 ? '' : 's'}`,
            calc: [rs.length ? `${fmtN(rs.length)} ${rs.length === 1 ? 'rating' : 'ratings'}: (${rs.map((x) => fmt1((Number(x.rating) || 0) * 5)).slice(0, 12).join(' + ')}${rs.length > 12 ? ' + \u2026' : ''}) \u00f7 ${fmtN(rs.length)} = ${fmt1(avg)} stars.` : 'Nobody has rated this asset.'] },
          { label: 'Last modified', info: 'assetModified', value: null, display: mod ? relTime(typeof mod === 'number' ? mod : Date.parse(mod)) : '–', color: Theme.palette[7], meta: mod ? fmtDateTime(typeof mod === 'number' ? mod : Date.parse(mod)) : '', metaText: mod ? new Date(typeof mod === 'number' ? mod : Date.parse(mod)).toISOString() : '',
            calc: [mod ? `Last modified ${fmtDateTime(typeof mod === 'number' ? mod : Date.parse(mod))}.` : 'No modification date available.'] },
        ];
      },
    });

    const trend = card(T, {
      id: 'as-trend', title: 'Visits over time', sub: 'Click a period to zoom in', span: 8, height: 300, chartTypes: ['line', 'area', 'bar'],
      load: async () => {
        const [cur, prev] = await Promise.all([Data.assetTrend(id, r, g), cr ? Data.assetTrend(id, cr, g) : null]);
        const series = [{ name: 'Visits', values: cur.rows.map((x) => x.count), color: Theme.palette[0] }];
        const ov = compareOverlay(cur.rows, prev && prev.rows, 'count', `Visits, ${State.compareLabel()}`);
        if (ov) series.push(ov);
        if (Prefs.get('as-trend', 'ma', false)) series.push({ name: `${maWindow(g)}-${g.toLowerCase()} moving average`, values: movingAverage(cur.rows.map((x) => x.count), maWindow(g)), color: Theme.v('--warn'), overlay: true });
        const tr = trendOn('as-trend') ? trendInfo(cur.rows.map((x) => x.count), g, 'Visits') : null;
        if (tr && tr.series) series.push(tr.series);
        return {
          spec: { kind: 'series', mode: 'area', title: 'Visits over time', height: 300, categories: catsOf(cur.rows), series, emptyText: 'No visits to this asset in this period', onClick: (i) => zoomTo(cur.rows[i]) },
          extraOptions: () => [maToggle('as-trend'), trendToggle('as-trend')],
          calc: [
            `${fmtN(sum(cur.rows, (x) => x.count))} visits over ${plural(cur.rows.length, `${g.toLowerCase()} bucket`)}; ${fmtN(cur.rows.filter((x) => x.count > 0).length)} buckets had at least one visit.`,
            prev ? `Comparison period: ${fmtN(sum(prev.rows, (x) => x.count))} visits.` : null,
            ...(tr ? tr.calc : []),
          ],
        };
      },
    });

    const visitors = card(T, {
      id: 'as-visitors', title: 'Top visitors', sub: 'Who looked at this asset', span: 4,
      load: async () => {
        const rows = await Data.assetVisitors(id, r, 15);
        if (!rows.length) return { empty: { title: 'No visitors', text: 'Nobody visited this asset in this period.' } };
        return {
          spec: { kind: 'hbar', title: 'Top visitors', valueLabel: 'Visits', color: Theme.palette[1], items: rows.map((x) => ({ label: x.name, value: x.visits })) },
          dataset: { columns: [{ key: 'rank', label: '#', type: 'number' }, { key: 'name', label: 'User', link: (x) => Env.userUrl(x.id) }, { key: 'visits', label: 'Visits', type: 'number', bar: true }], rows },
          calc: [`${plural(rows.length, 'person')} shown (each once), with ${fmtN(sum(rows, (x) => x.visits))} visits between them.`, `#1: ${rows[0].name} with ${plural(rows[0].visits, 'visit')}.`],
        };
      },
    });

    const changes = card(T, {
      id: 'as-activity', title: 'Recent changes', sub: 'Latest audit-trail entries for this asset', span: 6,
      load: async () => {
        const res = await Api.get('/rest/2.0/activities', { contextId: id, limit: 100 });
        const rows = (res.results || []).map(normActivity);
        if (!rows.length) return { empty: { title: 'No recorded changes', text: 'The audit trail has no entries for this asset.' } };
        return {
          dataset: { columns: [{ key: 'ts', label: 'When', type: 'datetime' }, { key: 'user', label: 'User' }, { key: 'type', label: 'Action', format: titleCase }, { key: 'cause', label: 'Cause', format: titleCase }, { key: 'field', label: 'Field', clamp: true }, { key: 'resource', label: 'Resource', clamp: true, hidden: true }], rows },
          tableOpts: { sort: 'ts', dir: 'desc', pageSize: 10 },
          calc: [`${plural(rows.length, 'event')} loaded${rows.length >= 100 ? ' (limit 100)' : ''} from ${plural(uniq(rows.map((x) => x.user)).length, 'person')}.`, `Latest: ${fmtDateTime(Math.max(...rows.map((x) => x.ts)))}.`],
        };
      },
    });

    const reviews = card(T, {
      id: 'as-ratings', title: 'Ratings & reviews', span: 6,
      load: async () => {
        const res = await Api.get('/rest/2.0/ratings', { assetId: id, limit: 1000 });
        const list = (res.results || []).map((x) => ({ stars: Math.round(Number(x.rating || 0) * 50) / 10, review: stripHtml(x.review || '').trim(), userId: x.createdBy, ts: x.createdOn }));
        if (!list.length) return { empty: { title: 'No ratings yet', text: 'Nobody has rated this asset.' } };
        const names = await Data.userNames(list.map((x) => x.userId)).catch(soft) || new Map();
        list.forEach((x) => { x.user = names.get(x.userId)?.name || 'Unknown user'; });
        list.sort((a, b) => b.ts - a.ts);
        return {
          render: (b) => b.append(...list.slice(0, 25).map((x) => h('div', { class: 'review' },
            h('div', { class: 'review-head' }, starsEl(x.stars), h('strong', null, x.user), h('span', null, fmtDateTime(x.ts))),
            x.review ? h('div', { class: 'review-body' }, x.review) : null))),
          dataset: { columns: [{ key: 'ts', label: 'Date', type: 'datetime' }, { key: 'user', label: 'Reviewer' }, { key: 'stars', label: 'Rating', type: 'stars' }, { key: 'review', label: 'Review', clamp: true }], rows: list },
          calc: [`${plural(list.length, 'rating')}, ${fmtN(list.filter((x) => x.review).length)} with written text; average ${fmt1(sum(list, (x) => x.stars) / list.length)} stars.`, list.length > 25 ? 'The card shows the newest 25; the table and exports include all.' : null],
        };
      },
    });

    panel.append(grid(head), kpis.el, grid(trend, visitors), grid(changes, reviews));
    kpis.el.style.marginTop = 'var(--gap)';
    runAll(T);
  }

  /* ────────────────────────────────────────────────────────────────────────
     Tab: Compare (multiple items over time)
     ──────────────────────────────────────────────────────────────────────── */

  const orgKind = (meta) => (/domain/i.test(String(meta || '')) ? 'Domain' : 'Community');

  /** Search across assets (REST/GraphQL) and visited dashboards, diagrams, domains and communities. */
  function compareSearchBox(r, g) {
    const input = h('input', { type: 'search', placeholder: 'Add an asset, domain, community, dashboard or diagram\u2026', 'aria-label': 'Add an item to compare', id: 'compare-search', autocomplete: 'off', role: 'combobox', 'aria-expanded': 'false', 'aria-controls': 'compare-suggest' });
    const list = h('div', { class: 'suggest', id: 'compare-suggest', role: 'listbox' });
    list.hidden = true;
    let items = [], active = -1, seq = 0;
    const pick = (it) => { list.hidden = true; input.value = ''; addToCompare(it.kind, it.id, it.name, { go: false }); };
    const draw = () => {
      list.replaceChildren(...items.map((it, i) => h('button', { type: 'button', role: 'option', class: i === active ? 'active' : null, 'aria-selected': String(i === active), onmousedown: (e) => { e.preventDefault(); pick(it); } },
        h('span', { class: 's-name' }, h('span', { class: 'tag tag-brand' }, it.kind), ' ', it.name), h('span', { class: 's-meta' }, it.meta || ''))));
      if (!items.length) list.replaceChildren(h('div', { class: 'menu-empty' }, 'No matches'));
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
    };
    const local = async (q) => {
      const ql = q.toLowerCase();
      const out = [];
      const kinds = await Promise.all(['Dashboard', 'Diagram', 'Domain', 'Community'].map((k) => Data.itemSeries(k, r, g).catch(() => null)));
      kinds.forEach((s) => { if (s) s.items.filter((x) => x.name.toLowerCase().includes(ql)).slice(0, 8).forEach((x) => out.push({ kind: s.type, id: x.id, name: x.name, meta: `${fmtN(x.total)} visits in range` })); });
      for (const o of State.lists.orgs || []) {
        if (o.label.toLowerCase().includes(ql) && !out.some((x) => x.id === o.id)) out.push({ kind: orgKind(o.meta), id: o.id, name: o.label, meta: o.meta || '' });
      }
      return out;
    };
    const search = debounce(async () => {
      const q = input.value.trim();
      const m = q.match(/^(Asset|Domain|Community|Dashboard|Diagram)?:?\s*([0-9a-f-]{36})$/i);
      if (m && isUuid(m[2])) { const kind = m[1] ? titleCase(m[1]) : 'Asset'; items = [{ kind, id: m[2], name: m[2], meta: `Add ${kind.toLowerCase()} by ID` }]; active = 0; draw(); return; }
      if (q.length < 2) { list.hidden = true; return; }
      const my = ++seq;
      try {
        const [assets, others] = await Promise.all([Data.searchAssets(q).catch(() => []), local(q)]);
        if (my !== seq) return;
        items = [...others, ...assets.map((a) => ({ kind: 'Asset', id: a.id, name: a.name, meta: [a.type, a.domain, a.community].filter(Boolean).join(' \u00b7 ') }))].slice(0, 25);
        active = -1;
        draw();
      } catch (e) { if (!isAbort(e)) { items = []; draw(); } }
    }, 250);
    input.addEventListener('input', search);
    input.addEventListener('keydown', (e) => {
      if (list.hidden) return;
      if (e.key === 'ArrowDown') { active = Math.min(items.length - 1, active + 1); draw(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { active = Math.max(0, active - 1); draw(); e.preventDefault(); }
      else if (e.key === 'Enter' && items[Math.max(0, active)]) { pick(items[Math.max(0, active)]); e.preventDefault(); }
      else if (e.key === 'Escape') { list.hidden = true; }
    });
    input.addEventListener('blur', () => setTimeout(() => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); }, 150));
    return h('div', { class: 'search-box' }, input, list);
  }

  function buildCompare(panel) {
    const T = 'compare';
    const r = State.range(), cr = State.compareRange(), g = State.gran();
    const gl = g.toLowerCase();
    const { items: keys, cmetric, cnorm, cbench } = State.s;
    const sel = keys.map((k) => { const [kind, id] = k.split(':'); return { key: k, kind, id }; });
    const METRICS = { visits: 'Visits', cumulative: 'Cumulative visits', share: 'Share of selection %', edits: 'Edits (audit trail)' };
    const NORMS = { abs: 'Absolute', index: 'Indexed (first = 100)', pct: '% of item total' };

    const quickAdd = (kind, n) => h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: async () => {
      try {
        const top = await Data.contentTop(kind, n, r);
        const add = top.map((x) => { State.labels.set(`item:${x.id}`, x.name); return `${kind}:${x.id}`; }).filter((k) => !State.s.items.includes(k));
        const items = [...State.s.items, ...add].slice(0, MAX_COMPARE);
        if (!add.length) toast(`No ${pluralWord(kind.toLowerCase())} to add.`); else App.update({ items });
      } catch (e) { if (!isAbort(e)) toast(`Couldn\u2019t load top ${pluralWord(kind.toLowerCase())}: ${e.message}`, 'error'); }
    } }, `+ Top ${n} ${pluralWord(kind.toLowerCase())}`);

    const controls = [
      selectEl(Object.keys(METRICS), cmetric, (v) => App.update({ cmetric: v }), 'Metric', (v) => METRICS[v]),
      cmetric === 'share' ? null : segmented(Object.keys(NORMS), cnorm, (v) => App.update({ cnorm: v }), 'Normalize', (v) => NORMS[v]),
      (() => { const cb = h('input', { type: 'checkbox', checked: cbench }); cb.addEventListener('change', () => App.update({ cbench: cb.checked })); return h('label', { class: 'switch', title: 'Overlay the median of all items of the same kind (visits only)' }, cb, h('span', { class: 'track' }), 'Peer median'); })(),
    ];
    panel.append(panelIntro('Compare', `Pick up to ${MAX_COMPARE} items and compare them over time \u00b7 ${fmtRange(r.startDate, r.endDate)}`, ...controls));
    const nameOf = (it) => State.labels.get(`item:${it.id}`) || State.label('orgs', it.id).replace(/^\u2026$/, '') || `${it.kind} ${it.id.slice(0, 8)}`;
    const chipsEl = h('div', { class: 'active-filters sel-chips' }, sel.map((it) => selChip(nameOf(it), () => App.update({ items: keys.filter((k) => k !== it.key) }), `${it.kind}:`)),
      sel.length > 1 ? h('button', { class: 'chip-clear', type: 'button', onclick: () => App.update({ items: [] }) }, 'Clear all') : null);
    panel.append(h('div', { class: 'compare-bar' }, compareSearchBox(r, g), h('div', { class: 'quick-adds' }, quickAdd('Asset', 5), quickAdd('Dashboard', 5)), h('span', { class: 'muted' }, `${keys.length} / ${MAX_COMPARE}`)), chipsEl);

    if (!sel.length) {
      panel.append(h('div', { class: 'card span-12 compare-empty' }, stateEl('empty', 'Nothing to compare yet',
        'Search above, use the quick-add buttons, or click \u201c+ Compare\u201d in Asset Explorer or the Dashboards table. You can mix assets, domains, communities, dashboards and diagrams.')));
      return;
    }

    const seriesFor = {}, prevFor = {};
    const kindSeries = (kind) => (seriesFor[kind] ||= memo(() => Data.itemSeries(kind, r, g)))();
    const kindPrev = (kind) => (prevFor[kind] ||= memo(() => (cr ? Data.itemSeries(kind, cr, g) : Promise.resolve(null))))();
    const { buckets } = Data._buckets(r, g);

    const fallbackName = async (it) => {
      try {
        if (it.kind === 'Domain') return (await Api.get(`/rest/2.0/domains/${it.id}`)).name;
        if (it.kind === 'Community') return (await Api.get(`/rest/2.0/communities/${it.id}`)).name;
        if (it.kind === 'Diagram') return (await Data.assetDetails(it.id)).name;
      } catch (e) { if (isAbort(e)) throw e; }
      return null;
    };

    const resolveItem = async (it, i) => {
      const color = Theme.palette[i % Theme.palette.length];
      if (it.kind === 'Asset') {
        const [t, d, pt] = await Promise.all([Data.assetTrend(it.id, r, g), Data.assetDetails(it.id).catch(soft), cr ? Data.assetTrend(it.id, cr, g).catch(soft) : null]);
        const name = d?.name || nameOf(it);
        State.labels.set(`item:${it.id}`, name);
        return { ...it, color, name, context: [d?.type?.name, d?.domain?.name].filter(Boolean).join(' \u00b7 '), values: t.rows.map((x) => x.count), prevTotal: pt ? sum(pt.rows, (x) => x.count) : null, details: d };
      }
      const [s, ps] = await Promise.all([kindSeries(it.kind), kindPrev(it.kind).catch(soft)]);
      const x = s.byId.get(it.id);
      const name = x?.name || ps?.byId.get(it.id)?.name || (await fallbackName(it)) || nameOf(it);
      State.labels.set(`item:${it.id}`, name);
      return {
        ...it, color, name, context: x ? [x.assetType, x.kind === 'Domain' ? x.community : x.domain].filter(Boolean).join(' \u00b7 ') : '',
        values: x ? x.values : buckets.map(() => 0), prevTotal: ps ? ps.byId.get(it.id)?.total || 0 : null,
      };
    };
    const resolved = memo(async () => {
      const list = await Promise.all(sel.map(resolveItem));
      chipsEl.querySelectorAll('.chip').forEach((el, i) => { if (list[i]) el.childNodes[1].textContent = list[i].name; });
      return list;
    });
    const editable = (it) => it.kind !== 'Dashboard';
    const editsFor = memo(async () => {
      const list = await resolved();
      return Promise.all(list.map(async (it) => {
        if (!editable(it)) return null;
        try {
          const ev = await Data.activitiesFor({ contextId: it.id }, r, 2000);
          return { values: Data.countByBucket(ev.events, r, g), total: ev.events.length, capped: ev.capped };
        } catch (e) { if (isAbort(e)) throw e; return null; }
      }));
    });

    /** Per-item values for the selected metric (before normalization). */
    const metricValues = async () => {
      const list = await resolved();
      if (cmetric === 'edits') {
        const ed = await editsFor();
        return list.map((it, i) => (ed[i] ? ed[i].values : null));
      }
      if (cmetric === 'cumulative') return list.map((it) => cumulative(it.values));
      if (cmetric === 'share') {
        const tot = buckets.map((_, b) => sum(list, (it) => it.values[b]));
        return list.map((it) => it.values.map((v, b) => (tot[b] ? (v / tot[b]) * 100 : 0)));
      }
      return list.map((it) => it.values);
    };
    const normActive = cmetric !== 'share' && cnorm !== 'abs';
    const normLabel = cmetric === 'share' ? '' : cnorm === 'index' ? ' (index, first active = 100)' : cnorm === 'pct' ? ' (% of item total)' : '';

    const trend = card(T, {
      id: 'cp-trend', info: 'cp-trend', title: `${METRICS[cmetric]} over time${normLabel}`, sub: 'One line per item \u00b7 click a period to zoom in', span: 12, height: 340, chartTypes: ['line', 'area', 'bar'],
      load: async () => {
        const [list, vals] = await Promise.all([resolved(), metricValues()]);
        const series = [];
        const calc = [`Metric: ${METRICS[cmetric]}${normLabel}.`];
        list.forEach((it, i) => {
          if (!vals[i]) { calc.push(`${it.name}: not available for ${pluralWord(it.kind.toLowerCase())}.`); return; }
          const v = normActive ? normalize(vals[i], cnorm) : vals[i];
          series.push({ name: it.name, values: v, color: it.color });
          const raw = cmetric === 'edits' ? vals[i] : it.values;
          calc.push(`${it.name} (${it.kind}): ${fmtN(sum(raw))} ${cmetric === 'edits' ? 'edits' : 'visits'} in the period, ${fmtN(raw.filter((x) => x > 0).length)} of ${fmtN(buckets.length)} ${gl}s active.`);
          if (trendOn('cp-trend')) { const tr = trendInfo(v, g, it.name, it.color); if (tr.series) series.push(tr.series); calc.push(...tr.calc.map((x) => `${it.name}: ${x}`)); }
        });
        if (cbench && ['visits', 'cumulative'].includes(cmetric)) {
          for (const kind of uniq(list.map((it) => it.kind))) {
            const s = await kindSeries(kind).catch(soft);
            if (!s || !s.items.length) continue;
            let med = buckets.map((_, b) => median(s.items.map((x) => x.values[b])));
            if (cmetric === 'cumulative') med = cumulative(med);
            if (normActive) med = normalize(med, cnorm);
            series.push({ name: `Median ${kind.toLowerCase()} (${fmtN(s.items.length)} visited)`, values: med, color: Theme.v('--text-3'), overlay: true, dashed: true });
            calc.push(`Peer median for ${pluralWord(kind.toLowerCase())}: per ${gl}, the median visits of the ${fmtN(s.items.length)} ${pluralWord(kind.toLowerCase())} visited at least once in the range (zeros included).`);
          }
        } else if (cbench) calc.push('The peer median is only shown for the Visits and Cumulative visits metrics.');
        if (cnorm === 'index' && normActive) calc.push('Indexed: each value \u00f7 the item\u2019s first non-zero value \u00d7 100, so lines start at 100 and show relative growth.');
        if (cnorm === 'pct' && normActive) calc.push('% of item total: each value \u00f7 the item\u2019s total over the range \u00d7 100, so lines show when each item was used, regardless of size.');
        if (cmetric === 'share') calc.push(`Share of selection: an item\u2019s visits in a ${gl} \u00f7 visits to all ${list.length} selected items in that ${gl} \u00d7 100.`);
        const pct = cmetric === 'share' || cnorm === 'pct';
        return {
          spec: { kind: 'series', mode: 'line', title: `${METRICS[cmetric]} over time`, height: 340, legend: 'always', integer: !(pct || cnorm === 'index'), valueFormat: pct ? (v) => fmtPct(v) : fmtN, categories: catsOf(buckets), series, onClick: (i) => zoomTo(buckets[i]) },
          extraOptions: () => [trendToggle('cp-trend')],
          calc,
        };
      },
    });

    const multiples = card(T, {
      id: 'cp-multiples', title: 'Small multiples', sub: `${METRICS[cmetric] === 'Share of selection %' ? 'Visits' : METRICS[cmetric]} per ${gl}, one chart per item, each on its own scale`, span: 12,
      load: async () => {
        const [list, vals] = await Promise.all([resolved(), metricValues()]);
        const useVals = cmetric === 'share' ? list.map((it) => it.values) : vals;
        const rows = [];
        list.forEach((it, i) => { if (useVals[i]) buckets.forEach((b, j) => rows.push({ item: it.name, kind: it.kind, period: b.label, start: b.startDate, end: b.endDate, value: useVals[i][j] })); });
        return {
          render: (body) => {
            const gridEl = h('div', { class: 'multiples' });
            body.append(gridEl);
            list.forEach((it, i) => {
              const host = h('div', { class: 'chart-host' });
              gridEl.append(h('div', { class: 'multiple' }, h('div', { class: 'multiple-head' }, h('span', { class: 'tag' }, it.kind), h('strong', { title: it.name }, it.name), h('span', { class: 'muted' }, useVals[i] ? fmtN(sum(useVals[i])) : 'n/a')), host));
              if (useVals[i]) Charts.render(host, { kind: 'series', mode: 'area', title: it.name, height: 130, legend: false, categories: catsOf(buckets), series: [{ name: it.name, values: useVals[i], color: it.color }], emptyText: 'No activity' });
              else host.append(stateEl('empty', 'Not available', `Edits aren\u2019t tracked for ${pluralWord(it.kind.toLowerCase())}.`));
            });
          },
          dataset: { columns: [{ key: 'item', label: 'Item' }, { key: 'kind', label: 'Kind' }, { key: 'period', label: 'Period' }, { key: 'start', label: 'Start', type: 'date' }, { key: 'end', label: 'End', type: 'date' }, { key: 'value', label: cmetric === 'share' ? 'Visits' : METRICS[cmetric], type: 'number' }], rows },
          calc: [`${plural(list.length, 'item')}, each drawn on its own y-axis so the shape of usage is comparable even when volumes differ. Values are not normalized.`],
        };
      },
    });

    const share = card(T, {
      id: 'cp-share', title: 'Share of selection over time', sub: `Each item\u2019s % of the selected items\u2019 visits per ${gl}`, span: 6, height: 280, chartTypes: ['bar', 'area'], stackable: true,
      load: async () => {
        const list = await resolved();
        const tot = buckets.map((_, b) => sum(list, (it) => it.values[b]));
        const series = list.map((it) => ({ name: it.name, values: it.values.map((v, b) => (tot[b] ? (v / tot[b]) * 100 : 0)), color: it.color }));
        const grand = sum(tot);
        return {
          spec: { kind: 'series', mode: 'bar', stacked: true, title: 'Share of selection over time', height: 280, integer: false, yFormat: (v) => `${fmtN(v)}%`, valueFormat: (v) => fmtPct(v), categories: catsOf(buckets), series, emptyText: 'No visits to the selected items' },
          calc: [`Per ${gl}: item visits \u00f7 visits to all selected items \u00d7 100. ${gl}s with no visits are empty.`, ...list.map((it) => `${it.name}: ${fmtN(sum(it.values))} of ${fmtN(grand)} visits overall = ${fmtPct(grand ? (sum(it.values) / grand) * 100 : 0)}.`)],
        };
      },
    });

    const edits = card(T, {
      id: 'cp-edits', title: 'Edits vs visits', sub: `Bars: visits to the selected items \u00b7 line (right axis): audit-trail edits, per ${gl}`, span: 6, height: 280, chartTypes: ['bar', 'line'],
      load: async () => {
        const [list, ed] = await Promise.all([resolved(), editsFor()]);
        const withEdits = list.filter((it, i) => ed[i]);
        const visits = buckets.map((_, b) => sum(withEdits, (it) => it.values[b]));
        const editVals = buckets.map((_, b) => sum(ed.filter(Boolean), (x) => x.values[b]));
        const rows = list.map((it, i) => ({ name: it.name, kind: it.kind, visits: sum(it.values), edits: ed[i] ? ed[i].total : null, ratio: ed[i] && sum(it.values) ? ed[i].total / sum(it.values) : null, capped: ed[i]?.capped ? 'Yes' : '' }));
        if (!withEdits.length) return { empty: { title: 'Not available', text: 'Edits are tracked for assets, domains, communities and diagrams, not dashboards.' } };
        return {
          spec: {
            kind: 'series', mode: 'bar', title: 'Edits vs visits', height: 280, legend: 'always', categories: catsOf(buckets), onClick: (i) => zoomTo(buckets[i]),
            series: [{ name: 'Visits', values: visits, color: Theme.palette[0] }, { name: 'Edits', values: editVals, color: Theme.v('--warn'), y2: true }],
          },
          dataset: { columns: [{ key: 'name', label: 'Item' }, { key: 'kind', label: 'Kind' }, { key: 'visits', label: 'Visits', type: 'number' }, { key: 'edits', label: 'Edits', type: 'number' }, { key: 'ratio', label: 'Edits per visit', type: 'number', format: (v) => v.toFixed(2) }, { key: 'capped', label: 'Edit list capped' }], rows },
          calc: [
            ...rows.filter((x) => x.edits != null).map((x) => `${x.name}: ${fmtN(x.edits)} edits \u00f7 ${fmtN(x.visits)} visits = ${x.ratio == null ? (x.edits ? 'edited but never visited' : 'n/a') : x.ratio.toFixed(2)} edits per visit.`),
            'Edits are audit-trail events in the period whose context is the item (for domains and communities this includes changes to assets inside them).',
            rows.some((x) => x.capped) ? 'At least one item hit the 2,000-event cap, so its edit count is a minimum.' : null,
          ],
        };
      },
    });

    const visitors = card(T, {
      id: 'cp-visitors', title: 'Top visitors per asset', sub: 'The 5 people who visited each selected asset most', span: 6,
      load: async () => {
        const list = (await resolved()).filter((it) => it.kind === 'Asset');
        if (!list.length) return { empty: { title: 'No assets selected', text: 'Visitor lists are available for assets only.' } };
        const per = await Promise.all(list.map((it) => Data.assetVisitors(it.id, r, 5).catch(soft)));
        const rows = list.flatMap((it, i) => (per[i] || []).map((v) => ({ item: it.name, rank: v.rank, id: v.id, name: v.name, visits: v.visits })));
        if (!rows.length) return { empty: { title: 'No visitors', text: 'Nobody visited the selected assets in this period.' } };
        return {
          dataset: { columns: [{ key: 'item', label: 'Asset' }, { key: 'rank', label: '#', type: 'number' }, { key: 'name', label: 'User', link: (x) => (isUuid(x.id) ? Env.userUrl(x.id) : null) }, { key: 'visits', label: 'Visits', type: 'number', bar: true }], rows },
          tableOpts: { pageSize: 10 },
          calc: list.map((it, i) => `${it.name}: ${per[i] ? `${plural(per[i].length, 'visitor')} shown, ${fmtN(sum(per[i], (x) => x.visits))} visits between them` : 'visitor list unavailable'}.`),
        };
      },
    });

    const table = card(T, {
      id: 'cp-table', title: 'Side-by-side comparison', sub: 'Usage, rank among peers, curation and freshness per item', span: 12,
      load: async () => {
        const [list, ed] = await Promise.all([resolved(), editsFor()]);
        const kinds = uniq(list.map((it) => it.kind));
        const details = Object.fromEntries(await Promise.all(kinds.map(async (k) => [k, await Data.contentDetail(k, r).catch(soft)])));
        const selTotal = sum(list, (it) => sum(it.values));
        const rows = await Promise.all(list.map(async (it, i) => {
          const visits = sum(it.values);
          const peers = details[it.kind];
          const pos = peers ? peers.findIndex((x) => x.id === it.id) : -1;
          const pct = peers && peers.length ? percentileRank(peers.map((x) => x.visits), visits) : null;
          const act = it.values.filter((v) => v > 0).length;
          const fi = it.values.findIndex((v) => v > 0), li = it.values.length - 1 - [...it.values].reverse().findIndex((v) => v > 0);
          const row = {
            id: it.id, kind: it.kind, name: it.name, context: it.context, visits, prev: it.prevTotal, delta: it.prevTotal ? pctChange(visits, it.prevTotal) : null,
            share: selTotal ? (visits / selTotal) * 100 : 0, rank: pos >= 0 ? pos + 1 : null, peers: peers ? peers.length : null, pctl: pct,
            activePct: (act / buckets.length) * 100, first: fi >= 0 ? buckets[fi].startDate : '', last: fi >= 0 ? buckets[li].startDate : '',
            edits: ed[i] ? ed[i].total : null, ratio: ed[i] && visits ? ed[i].total / visits : null,
            allTime: null, visitors: null, perVisitor: null, rating: null, ratings: null, modified: null, days: null, stale: '',
          };
          if (it.kind === 'Asset') {
            const [sm, rt] = await Promise.all([Data.assetSummary(it.id).catch(soft), Api.get('/rest/2.0/ratings', { assetId: it.id, limit: 1000 }).catch(soft)]);
            if (sm) { row.allTime = sm.totalVisitCount || 0; row.visitors = sm.uniqueVisitorCount || 0; row.perVisitor = row.visitors ? row.allTime / row.visitors : null; }
            const rs = rt ? rt.results || [] : [];
            row.ratings = rs.length;
            row.rating = rs.length ? (sum(rs, (x) => x.rating) / rs.length) * 5 : null;
            const mod = it.details && (it.details.modifiedOn || it.details.lastModifiedOn);
            if (mod) {
              row.modified = typeof mod === 'number' ? mod : Date.parse(mod);
              row.days = Math.floor((Date.now() - row.modified) / DAY);
              row.stale = row.days >= State.s.stale && pct != null && pct >= 80 ? 'Yes' : 'No';
            }
          }
          return row;
        }));
        return {
          dataset: {
            columns: [
              { key: 'name', label: 'Item', link: (x) => Env.urlFor(x.kind, x.id) },
              { key: 'kind', label: 'Kind' },
              { key: 'context', label: 'Type / location', hidden: true },
              { key: 'visits', label: 'Visits', type: 'number', bar: true },
              { key: 'prev', label: `Visits, ${State.compareLabel()}`, type: 'number', hidden: !cr },
              { key: 'delta', label: 'Change %', type: 'delta', hidden: !cr, isNew: (x) => !x.prev && x.visits > 0 },
              { key: 'share', label: 'Share of selection %', type: 'pct' },
              { key: 'rank', label: 'Rank in kind', type: 'number', format: (v) => `#${fmtN(v)}`, sortValue: (x) => (x.rank == null ? null : -x.rank) },
              { key: 'peers', label: 'Items of kind visited', type: 'number', hidden: true },
              { key: 'pctl', label: 'Percentile', type: 'number', format: (v) => `${Math.round(v)}th` },
              { key: 'activePct', label: `Active ${gl}s %`, type: 'pct' },
              { key: 'first', label: `First active ${gl}`, type: 'date', hidden: true },
              { key: 'last', label: `Last active ${gl}`, type: 'date' },
              { key: 'allTime', label: 'All-time visits', type: 'number' },
              { key: 'visitors', label: 'Unique visitors (all time)', type: 'number' },
              { key: 'perVisitor', label: 'Visits per visitor', type: 'number', format: fmt1 },
              { key: 'edits', label: 'Edits', type: 'number' },
              { key: 'ratio', label: 'Edits per visit', type: 'number', format: (v) => v.toFixed(2) },
              { key: 'rating', label: 'Rating', type: 'stars' },
              { key: 'ratings', label: 'Ratings', type: 'number', hidden: true },
              { key: 'modified', label: 'Last modified', type: 'datetime', hidden: true },
              { key: 'days', label: 'Days since modified', type: 'number' },
              { key: 'stale', label: `Stale but popular (\u2265${State.s.stale} d)` },
            ],
            rows,
          },
          tableOpts: { sort: 'visits', dir: 'desc', search: false },
          calc: [
            `${plural(rows.length, 'item')}; ${fmtN(selTotal)} visits between them.`,
            'Rank in kind and percentile compare each item with every item of the same kind visited in the period (percentile = % of those items with fewer visits, counting ties as half).',
            'All-time visits, unique visitors, rating and freshness are only available for assets.',
            `Stale but popular = not modified for at least ${State.s.stale} days and in the top 20% of its kind by visits (percentile \u2265 80).`,
            'Edits per visit = audit-trail edits in the period \u00f7 visits in the period.',
          ],
        };
      },
    });

    panel.append(grid(trend), grid(table), grid(share, edits), grid(multiples), grid(visitors));
    runAll(T);
  }

  /* ────────────────────────────────────────────────────────────────────────
     Tab: All-time popularity (navigation statistics)
     ──────────────────────────────────────────────────────────────────────── */

  function buildPopularity(panel) {
    const T = 'popularity';
    const r = State.range();
    const N = State.s.popN;
    panel.append(panelIntro('All-time popularity', `Collibra navigation statistics across all time · "Visits in period" uses ${fmtRange(r.startDate, r.endDate)}`,
      selectEl([100, 250, 500, 1000, 2500], N, (v) => App.update({ popN: Number(v) }), 'Assets to load')));

    const data = memo(async () => {
      const nav = await Data.mostViewed(N);
      const items = nav.results.map((x, i) => ({ rank: i + 1, id: x.assetId || x.asset?.id, name: decodeEntities(x.name || x.asset?.name || ''), views: Number(x.numberOfViews) || 0, last: x.lastViewedDate || null }));
      const [ctx, period] = await Promise.all([Data.assetContext(items.map((x) => x.id)).catch(soft), Data.contentDetail('Asset', r).catch(soft)]);
      const pmap = new Map((period || []).map((p) => [p.id, p.visits]));
      for (const it of items) {
        const c = (ctx && ctx.get(it.id)) || {};
        Object.assign(it, {
          type: c.type || '', domain: c.domain || '', community: c.community || '', status: c.status || '',
          periodVisits: period ? pmap.get(it.id) || 0 : null,
          daysSince: it.last ? Math.max(0, Math.floor((Date.now() - it.last) / DAY)) : null,
          lastDate: it.last ? isoOf(new Date(it.last)) : null,
        });
        it.flag = it.periodVisits == null ? '' : it.periodVisits > 0 ? 'Active in period' : 'Cold in period';
      }
      return { items, total: nav.total, hasPeriod: !!period };
    });

    const kpis = kpiStrip(T, {
      id: 'pop-kpis', count: 5,
      load: async () => {
        const { items, total, hasPeriod } = await data();
        const views = items.map((x) => x.views).sort((a, b) => a - b);
        const totalViews = sum(views);
        const top10 = sum(items.slice(0, 10), (x) => x.views);
        const median = views.length ? views[Math.floor(views.length / 2)] : 0;
        const cold = hasPeriod ? items.filter((x) => x.periodVisits === 0).length : null;
        return [
          { label: 'Assets with views', info: 'popAssets', value: total ?? items.length, color: Theme.palette[0], meta: 'all time',
            calc: [`${fmtN(total ?? items.length)} assets have at least one recorded view (navigation statistics total).`, `${fmtN(items.length)} of them are loaded here ("Assets to load": ${fmtN(N)}).`] },
          { label: `Views, top ${fmtN(items.length)}`, info: 'popViews', value: totalViews, color: Theme.palette[1],
            calc: [`${fmtN(totalViews)} views = sum of all-time views of the ${fmtN(items.length)} loaded assets.`] },
          { label: 'Top 10 share', info: 'popTop10', value: totalViews ? (top10 / totalViews) * 100 : null, display: totalViews ? fmtPct((top10 / totalViews) * 100, 0) : '–', color: Theme.palette[3], meta: 'of views in the loaded set',
            calc: totalViews ? [`${fmtN(top10)} views (top 10) \u00f7 ${fmtN(totalViews)} views (loaded set) \u00d7 100 = ${fmtPct((top10 / totalViews) * 100)}.`] : [] },
          { label: 'Median views', info: 'popMedian', value: median, color: Theme.palette[7],
            calc: views.length ? [`The middle of ${fmtN(views.length)} sorted view counts (position ${fmtN(Math.floor(views.length / 2) + 1)}) is ${fmtN(median)}.`, `Range: ${fmtN(views[0])} to ${fmtN(views[views.length - 1])} views.`] : [] },
          { label: 'Cold in period', info: 'popCold', value: cold, invert: true, color: Theme.v('--warn'), meta: hasPeriod ? `popular, but 0 visits ${fmtRange(r.startDate, r.endDate)}` : 'needs Usage Analytics',
            calc: hasPeriod ? [`${fmtN(cold)} of ${fmtN(items.length)} loaded assets had 0 visits between ${fmtRange(r.startDate, r.endDate)}.`, `${fmtN(items.length - cold)} had at least one visit.`] : ['Usage Analytics data for the period isn\u2019t available, so this can\u2019t be calculated.'] },
        ];
      },
    });

    const top = card(T, {
      id: 'pop-top', title: 'Most viewed assets of all time', sub: 'Top 20 · click to explore', span: 6,
      load: async () => {
        const { items } = await data();
        if (!items.length) return { empty: { title: 'No view statistics', text: 'This environment has no navigation statistics yet.' } };
        return { spec: { kind: 'hbar', title: 'Most viewed assets', valueLabel: 'All-time views', rowH: 24, items: items.slice(0, 20).map((x) => ({ label: x.name, value: x.views, sub: [x.type, x.domain].filter(Boolean).join(' · '), onClick: () => openAsset(x.id) })) },
          dataset: { columns: [{ key: 'rank', label: '#', type: 'number' }, { key: 'name', label: 'Asset', link: (x) => Env.assetUrl(x.id) }, { key: 'views', label: 'All-time views', type: 'number' }], rows: items.slice(0, 20) },
          calc: [`#1: ${items[0].name} with ${fmtN(items[0].views)} all-time views.`, `The top ${fmtN(Math.min(20, items.length))} account for ${fmtN(sum(items.slice(0, 20), (x) => x.views))} views.`] };
      },
    });

    const scatter = card(T, {
      id: 'pop-scatter', title: 'Popularity vs. recency', sub: 'All-time views (log scale) against days since last viewed', span: 6, height: 360,
      load: async () => {
        const { items } = await data();
        const pts = items.filter((x) => x.daysSince != null).map((x) => ({
          x: x.views, y: x.daysSince, label: x.name, sub: [x.type, x.flag].filter(Boolean).join(' · '),
          color: x.periodVisits === 0 ? Theme.v('--warn') : Theme.palette[0], r: 4,
        }));
        return {
          spec: { kind: 'scatter', title: 'Popularity vs. recency', height: 360, xLog: true, xLabel: 'All-time views (log)', yLabel: 'Days since last viewed', xName: 'Views', yName: 'Days since viewed', points: pts, onClick: (p) => { const it = items.find((x) => x.name === p.label); if (it) openAsset(it.id); } },
          dataset: { columns: [{ key: 'name', label: 'Asset' }, { key: 'views', label: 'All-time views', type: 'number' }, { key: 'daysSince', label: 'Days since last viewed', type: 'number' }], rows: items },
          note: 'Orange dots are popular assets with no visits in the selected period.',
          calc: [`${plural(pts.length, 'dot')}; ${fmtN(pts.filter((p) => p.color === Theme.v('--warn')).length)} orange (no visits in the selected period).`, pts.length ? `Median days since last viewed: ${fmtN([...pts].sort((a, b) => a.y - b.y)[Math.floor(pts.length / 2)].y)}.` : null],
        };
      },
    });

    const byGroup = (cid, title, keyFn, kind) => card(T, {
      id: cid, title, sub: 'All-time views in the loaded set', span: 6, height: 260,
      load: async () => {
        const { items } = await data();
        const m = new Map();
        for (const x of items) { const k = keyFn(x) || '(unknown)'; const e = m.get(k) || { label: k, value: 0, assets: 0 }; e.value += x.views; e.assets++; m.set(k, e); }
        let rows = [...m.values()].sort((a, b) => b.value - a.value);
        const ds = { columns: [{ key: 'label', label: title.replace('Views by ', '').replace(/^\w/, (c) => c.toUpperCase()) }, { key: 'assets', label: 'Assets', type: 'number' }, { key: 'value', label: 'All-time views', type: 'number', bar: true }], rows };
        const total = sum(rows, (x) => x.value);
        const calc = rows.length ? [`${fmtN(total)} views of ${plural(items.length, 'loaded asset')} in ${plural(rows.length, 'group')}.`, `Largest: ${rows[0].label} with ${fmtN(rows[0].value)} views (${fmtPct(total ? (rows[0].value / total) * 100 : 0)}) across ${plural(rows[0].assets, 'asset')}.`] : [];
        if (kind === 'donut') {
          if (rows.length > 8) rows = [...rows.slice(0, 7), { label: 'Other', value: sum(rows.slice(7), (x) => x.value), assets: sum(rows.slice(7), (x) => x.assets) }];
          return { spec: { kind: 'donut', title, items: rows.map((x, i) => ({ ...x, color: x.label === 'Other' ? Theme.v('--text-3') : Theme.palette[i % 10] })), centerLabel: 'views', valueLabel: 'Views' }, dataset: ds, calc };
        }
        return { spec: { kind: 'hbar', title, valueLabel: 'Views', rowH: 24, items: rows.slice(0, 12).map((x, i) => ({ label: x.label, value: x.value, color: Theme.palette[i % 10], sub: `${fmtN(x.assets)} assets` })) }, dataset: ds, calc };
      },
    });

    const table = card(T, {
      id: 'pop-table', title: 'Popularity ranking', sub: 'All-time views compared with visits in the selected period', span: 12,
      load: async () => {
        const { items, hasPeriod } = await data();
        if (!items.length) return { empty: { title: 'No view statistics' } };
        return {
          dataset: {
            columns: [
              { key: 'rank', label: '#', type: 'number' },
              { key: 'name', label: 'Asset', link: (x) => Env.assetUrl(x.id) },
              { key: 'type', label: 'Asset type' },
              { key: 'domain', label: 'Domain' },
              { key: 'community', label: 'Community' },
              { key: 'status', label: 'Status', hidden: true },
              { key: 'views', label: 'All-time views', type: 'number', bar: true },
              { key: 'lastDate', label: 'Last viewed', type: 'date' },
              hasPeriod ? { key: 'periodVisits', label: 'Visits in period', type: 'number' } : null,
              hasPeriod ? { key: 'flag', label: 'Signal', render: (x) => h('span', { class: `tag ${x.periodVisits > 0 ? 'tag-good' : 'tag-warn'}` }, x.flag) } : null,
              { key: 'id', label: 'ID', hidden: true },
            ].filter(Boolean),
            rows: items,
          },
          tableOpts: { sort: 'views', dir: 'desc', onRowClick: (x) => openAsset(x.id), searchPlaceholder: 'Search assets, types, domains…' },
          calc: [`${plural(items.length, 'loaded asset')} with ${fmtN(sum(items, (x) => x.views))} all-time views.`, hasPeriod ? `${fmtN(items.filter((x) => x.periodVisits > 0).length)} active and ${fmtN(items.filter((x) => x.periodVisits === 0).length)} cold in ${fmtRange(r.startDate, r.endDate)}.` : null],
        };
      },
    });

    panel.append(kpis.el, grid(top, scatter), grid(byGroup('pop-types', 'Views by asset type', (x) => x.type, 'donut'), byGroup('pop-communities', 'Views by community', (x) => x.community, 'hbar')), grid(table));
    runAll(T);
  }

  /* ────────────────────────────────────────────────────────────────────────
     Tab: Edit activity (audit trail)
     ──────────────────────────────────────────────────────────────────────── */

  function buildActivity(panel) {
    const T = 'activity';
    const r = State.range(), g = State.gran();
    const cap = State.s.actCap, cause = State.s.cause;
    const bar = h('div', { style: { width: '0%' } });
    const progLabel = h('span', { class: 'note' }, '');
    const prog = h('div', { style: { minWidth: '180px' } }, h('div', { class: 'progress', role: 'progressbar', 'aria-label': 'Loading activity' }, bar), progLabel);

    panel.append(panelIntro('Edit activity', `Collibra audit trail for ${fmtRange(r.startDate, r.endDate)} · audience filters don\u2019t apply`,
      prog,
      segmented(['All', 'MANUAL', 'IMPORT', 'WORKFLOW'], cause, (v) => App.update({ cause: v }), 'Cause', (v) => (v === 'All' ? 'All causes' : titleCase(v))),
      selectEl([1000, 5000, 10000, 25000, 50000], cap, (v) => App.update({ actCap: Number(v) }), 'Max events', fmtN)));

    const data = memo(async () => {
      const res = await Data.activities(r, cap, (n, max) => {
        bar.style.width = `${Math.min(100, (n / max) * 100)}%`;
        progLabel.textContent = `${fmtN(n)} events loaded`;
      });
      prog.hidden = true;
      const events = cause === 'All' ? res.events : res.events.filter((e) => e.cause === cause);
      return { events, capped: res.capped };
    });
    const cappedNote = (capped) => (capped ? `Showing the ${fmtN(cap)} most recent events in the range. Increase "Max events" for complete totals.` : null);

    const kpis = kpiStrip(T, {
      id: 'act-kpis', count: 5,
      load: async () => {
        const { events } = await data();
        const users = uniq(events.map((e) => e.user));
        const byDay = groupBy(events, (e) => e.date);
        const busiest = [...byDay.entries()].sort((a, b) => b[1].length - a[1].length)[0];
        const manual = events.filter((e) => e.cause === 'MANUAL').length;
        const assetsChanged = uniq(events.filter((e) => e.kind === 'Asset').map((e) => e.resourceId || e.resource)).length;
        const scope = `Cause: ${cause === 'All' ? 'all causes' : titleCase(cause)}.`;
        return [
          { label: 'Events', info: 'actEvents', value: events.length, color: Theme.palette[0], meta: `${fmt1(events.length / State.days())} per day`,
            calc: [`${fmtN(events.length)} events. Per day = ${fmtN(events.length)} \u00f7 ${fmtN(State.days())} days = ${fmt1(events.length / State.days())}.`, scope] },
          { label: 'Contributors', info: 'actContributors', value: users.length, color: Theme.palette[1], meta: 'distinct users',
            calc: [`${fmtN(users.length)} distinct ${users.length === 1 ? 'person' : 'people'} made the ${fmtN(events.length)} changes, each counted once.`, users.length ? `That is ${fmt1(events.length / users.length)} changes per contributor.` : null, scope] },
          { label: 'Manual share', info: 'actManual', value: events.length ? (manual / events.length) * 100 : null, display: events.length ? fmtPct((manual / events.length) * 100, (manual / events.length) * 100 < 10 ? 1 : 0) : '–', color: colorFor('MANUAL'), meta: plural(manual, 'manual edit'),
            calc: events.length ? [`${fmtN(manual)} manual events \u00f7 ${fmtN(events.length)} events \u00d7 100 = ${fmtPct((manual / events.length) * 100)}.`, scope] : [] },
          { label: 'Busiest day', info: 'actBusiest', value: busiest ? busiest[1].length : null, display: busiest ? fmtDateShort(busiest[0]) : '–', color: Theme.palette[3], meta: busiest ? `${fmtN(busiest[1].length)} events` : '', metaText: busiest ? busiest[0] : '',
            calc: busiest ? [`${fmtDate(busiest[0])} had ${fmtN(busiest[1].length)} events, the most of ${plural(byDay.size, 'day')} with any activity.`, scope] : [] },
          { label: 'Assets changed', info: 'actAssets', value: assetsChanged, color: colorFor('Asset'), meta: 'distinct assets',
            calc: [`${fmtN(assetsChanged)} distinct assets across ${fmtN(events.filter((e) => e.kind === 'Asset').length)} asset events.`, scope] },
        ];
      },
    });

    const overTime = card(T, {
      id: 'act-trend', title: 'Changes over time', sub: 'By action', span: 8, height: 300, chartTypes: ['bar', 'area', 'line'], stackable: true,
      load: async () => {
        const { events, capped } = await data();
        const buckets = makeBuckets(r.startDate, r.endDate, g);
        const idx = new Map(buckets.map((b, i) => [b.bucketStartDate, i]));
        const types = uniq(events.map((e) => e.type)).sort();
        const m = Object.fromEntries(types.map((t) => [t, new Array(buckets.length).fill(0)]));
        for (const e of events) { const i = idx.get(bucketStart(e.date, g)); if (i != null) m[e.type][i]++; }
        const rows = buckets.map((b) => ({ ...b, label: bucketLabel(b, g), full: bucketFull(b, g) }));
        return {
          spec: { kind: 'series', mode: 'bar', stacked: true, title: 'Changes over time', height: 300, categories: catsOf(rows), series: types.map((t, i) => ({ name: titleCase(t), values: m[t], color: colorFor(t, i) })), emptyText: 'No changes in this period', onClick: (i) => zoomTo(rows[i]) },
          note: cappedNote(capped),
          calc: [`${fmtN(events.length)} events in ${plural(rows.length, `${g.toLowerCase()} bucket`)}.`, types.length ? `By action: ${types.map((t) => `${titleCase(t)} ${fmtN(sum(m[t]))}`).join(', ')}.` : null, capped ? `Capped at ${fmtN(cap)} events.` : null],
        };
      },
    });

    const byCause = card(T, {
      id: 'act-cause', title: 'By cause', sub: 'Manual edits vs. imports vs. workflows', span: 4, height: 260,
      load: async () => {
        const { events } = await data();
        const m = groupBy(events, (e) => e.cause);
        const items = [...m.entries()].map(([k, v], i) => ({ label: titleCase(k), key: k, value: v.length, color: colorFor(k, i) })).sort((a, b) => b.value - a.value);
        return {
          spec: { kind: 'donut', title: 'By cause', items, centerLabel: 'events', valueLabel: 'Events', onClick: (it) => App.update({ cause: it.key }) },
          dataset: { columns: [{ key: 'label', label: 'Cause' }, { key: 'value', label: 'Events', type: 'number' }], rows: items },
          calc: items.map((x) => `${x.label}: ${fmtN(x.value)} \u00f7 ${fmtN(events.length)} = ${fmtPct(events.length ? (x.value / events.length) * 100 : 0)}`),
        };
      },
    });

    const byKind = card(T, {
      id: 'act-kind', title: 'What changed', sub: 'Events by resource kind', span: 6,
      load: async () => {
        const { events } = await data();
        const rows = [...groupBy(events, (e) => e.kind).entries()].map(([k, v]) => ({ label: k, value: v.length })).sort((a, b) => b.value - a.value);
        if (!rows.length) return { empty: { title: 'No changes', text: 'Nothing changed in this period.' } };
        return { spec: { kind: 'hbar', title: 'What changed', valueLabel: 'Events', items: rows.map((x, i) => ({ ...x, color: Theme.palette[i % 10] })) }, dataset: { columns: [{ key: 'label', label: 'Resource kind' }, { key: 'value', label: 'Events', type: 'number', bar: true }], rows },
          calc: rows.map((x) => `${x.label}: ${fmtN(x.value)} events`) };
      },
    });

    const contributors = card(T, {
      id: 'act-users', title: 'Top contributors', sub: 'Users with the most changes', span: 6,
      load: async () => {
        const { events } = await data();
        const rows = [...groupBy(events, (e) => e.user).entries()].map(([k, v]) => ({
          label: k, value: v.length, manual: v.filter((e) => e.cause === 'MANUAL').length, last: Math.max(...v.map((e) => e.ts)),
        })).sort((a, b) => b.value - a.value);
        if (!rows.length) return { empty: { title: 'No contributors', text: 'Nothing changed in this period.' } };
        return {
          spec: { kind: 'hbar', title: 'Top contributors', valueLabel: 'Events', rowH: 24, color: Theme.palette[3], items: rows.slice(0, 15).map((x) => ({ label: x.label, value: x.value, sub: `${fmtN(x.manual)} manual · last ${fmtDateTime(x.last)}` })) },
          dataset: { columns: [{ key: 'label', label: 'User' }, { key: 'value', label: 'Events', type: 'number', bar: true }, { key: 'manual', label: 'Manual', type: 'number' }, { key: 'last', label: 'Last change', type: 'datetime' }], rows },
          calc: [`${plural(rows.length, 'distinct contributor')}${rows.length > 15 ? ' (chart shows the top 15)' : ''}.`, `#1: ${rows[0].label} with ${fmtN(rows[0].value)} events (${fmtN(rows[0].manual)} manual) = ${fmtPct((rows[0].value / (events.length || 1)) * 100)} of all events.`],
        };
      },
    });

    const heat = card(T, {
      id: 'act-heat', title: 'When changes happen', sub: 'Events by weekday and hour (your local time)', span: 12, height: 240,
      load: async () => {
        const { events } = await data();
        const vals = WEEKDAYS.map(() => new Array(24).fill(0));
        for (const e of events) { const d = new Date(e.ts); vals[(d.getDay() + 6) % 7][d.getHours()]++; }
        const hours = Array.from({ length: 24 }, (_, i) => pad2(i));
        return {
          spec: { kind: 'heatmap', title: 'When changes happen', rows: WEEKDAYS, cols: hours, values: vals, cellH: 24, emptyText: 'No changes in this period', cellTip: (i, j, v) => `<div class="tt-title">${WEEKDAYS[i]} ${pad2(j)}:00–${pad2(j)}:59</div>${ttRow('', 'Events', fmtN(v))}` },
          dataset: { columns: [{ key: 'day', label: 'Weekday' }, ...hours.map((x, j) => ({ key: `h${j}`, label: `${x}:00`, type: 'number' }))], rows: WEEKDAYS.map((d, i) => Object.fromEntries([['day', d], ...vals[i].map((v, j) => [`h${j}`, v])])) },
          calc: (() => {
            let bi = 0, bj = 0;
            vals.forEach((row, i) => row.forEach((v, j) => { if (v > vals[bi][bj]) { bi = i; bj = j; } }));
            return [`${fmtN(events.length)} events placed by local weekday and hour (${Intl.DateTimeFormat().resolvedOptions().timeZone}).`, vals[bi][bj] ? `Busiest slot: ${WEEKDAYS[bi]} ${pad2(bj)}:00\u2013${pad2(bj)}:59 with ${fmtN(vals[bi][bj])} events.` : null];
          })(),
        };
      },
    });

    const table = card(T, {
      id: 'act-table', title: 'Event log', sub: 'Most recent first', span: 12,
      load: async () => {
        const { events, capped } = await data();
        if (!events.length) return { empty: { title: 'No changes', text: 'The audit trail has no events for this period and cause.' } };
        return {
          dataset: { columns: [
            { key: 'ts', label: 'When', type: 'datetime' },
            { key: 'user', label: 'User' },
            { key: 'type', label: 'Action', format: titleCase },
            { key: 'cause', label: 'Cause', format: titleCase },
            { key: 'kind', label: 'Kind' },
            { key: 'resource', label: 'Resource', clamp: true, link: (x) => (x.resourceId ? Env.assetUrl(x.resourceId) : null) },
            { key: 'field', label: 'Field / relation', clamp: true },
          ], rows: events },
          tableOpts: { sort: 'ts', dir: 'desc', searchPlaceholder: 'Search users, resources, fields…', onRowClick: (x) => { if (x.resourceId) openAsset(x.resourceId); } },
          note: cappedNote(capped),
          calc: [`${plural(events.length, 'event')} loaded for ${fmtRange(r.startDate, r.endDate)} (cause: ${cause === 'All' ? 'all' : titleCase(cause)}).`, capped ? `Capped at ${fmtN(cap)} events; older events in the range are not shown.` : 'All events in the range are included.'],
        };
      },
    });

    panel.append(kpis.el, grid(overTime, byCause), grid(byKind, contributors), grid(heat), grid(table));
    runAll(T);
  }

  /* ────────────────────────────────────────────────────────────────────────
     Tab: Ratings
     ──────────────────────────────────────────────────────────────────────── */

  function buildRatings(panel) {
    const T = 'ratings';
    const r = State.range();
    const scope = State.s.rscope;
    panel.append(panelIntro('Ratings & reviews', scope === 'all' ? 'All ratings ever given' : `Ratings given ${fmtRange(r.startDate, r.endDate)}`,
      segmented(['all', 'range'], scope, (v) => App.update({ rscope: v }), 'Scope', (v) => (v === 'all' ? 'All time' : 'Selected date range'))));

    const data = memo(async () => {
      let list = await Data.ratings();
      if (scope === 'range') list = list.filter((x) => x.date >= r.startDate && x.date <= r.endDate);
      const [names, ctx] = await Promise.all([
        Data.userNames(uniq(list.map((x) => x.userId)).slice(0, 300)).catch(soft),
        Data.assetContext(list.map((x) => x.assetId)).catch(soft),
      ]);
      for (const x of list) {
        x.user = names?.get(x.userId)?.name || 'Unknown user';
        const c = ctx?.get(x.assetId);
        x.type = c?.type || '';
        x.domain = c?.domain || '';
      }
      return list.sort((a, b) => b.createdOn - a.createdOn);
    });
    const span = (list) => {
      if (scope === 'range') return { range: r, g: State.gran() };
      const first = list.length ? list[list.length - 1].date : r.startDate;
      const range = { startDate: first < r.startDate ? first : r.startDate, endDate: yesterday() > first ? yesterday() : first };
      return { range, g: autoGranularity(daysInclusive(range.startDate, range.endDate)) };
    };

    const kpis = kpiStrip(T, {
      id: 'rt-kpis', count: 5,
      load: async () => {
        const list = await data();
        const avg = list.length ? sum(list, (x) => x.stars) / list.length : null;
        const withReview = list.filter((x) => x.review).length;
        const nAssets = uniq(list.map((x) => x.assetId)).length;
        const nUsers = uniq(list.map((x) => x.userId)).length;
        const scopeLine = scope === 'all' ? 'Scope: all ratings ever given.' : `Scope: ratings given ${fmtRange(r.startDate, r.endDate)}.`;
        return [
          { label: 'Ratings', info: 'rtCount', value: list.length, color: Theme.palette[0], calc: [`${fmtN(list.length)} rating records.`, scopeLine] },
          { label: 'Average rating', info: 'rtAvg', value: avg, display: avg != null ? fmt1(avg) : '–', unit: avg != null ? '/ 5' : '', color: Theme.v('--warn'),
            calc: list.length ? [`${fmt1(sum(list, (x) => x.stars))} total stars \u00f7 ${fmtN(list.length)} ratings = ${fmt1(avg)} / 5.`, scopeLine] : [] },
          { label: 'Rated assets', info: 'rtAssets', value: nAssets, color: Theme.palette[1],
            calc: [`${fmtN(nAssets)} distinct assets received the ${fmtN(list.length)} ratings${nAssets ? ` (${fmt1(list.length / nAssets)} per asset)` : ''}.`, scopeLine] },
          { label: 'Reviewers', info: 'rtReviewers', value: nUsers, color: Theme.palette[3],
            calc: [`${fmtN(nUsers)} distinct ${nUsers === 1 ? 'person' : 'people'} gave the ${fmtN(list.length)} ratings, each counted once.`, scopeLine] },
          { label: 'With written review', info: 'rtWithReview', value: list.length ? (withReview / list.length) * 100 : null, display: list.length ? fmtPct((withReview / list.length) * 100, 0) : '–', color: Theme.palette[5], meta: `${fmtN(withReview)} reviews`,
            calc: list.length ? [`${fmtN(withReview)} ratings with text \u00f7 ${fmtN(list.length)} ratings \u00d7 100 = ${fmtPct((withReview / list.length) * 100)}.`, scopeLine] : [] },
        ];
      },
    });

    const dist = card(T, {
      id: 'rt-dist', title: 'Rating distribution', span: 4, height: 260,
      load: async () => {
        const list = await data();
        const counts = [1, 2, 3, 4, 5].map((n) => list.filter((x) => Math.round(x.stars) === n).length);
        return {
          spec: { kind: 'series', mode: 'bar', title: 'Rating distribution', height: 260, emptyText: 'No ratings', categories: [1, 2, 3, 4, 5].map((n) => ({ label: `${n} ★`, full: `${n} star${n > 1 ? 's' : ''}` })), series: [{ name: 'Ratings', values: counts, color: Theme.v('--warn') }] },
          dataset: { columns: [{ key: 'stars', label: 'Stars', type: 'number' }, { key: 'count', label: 'Ratings', type: 'number' }], rows: counts.map((c, i) => ({ stars: i + 1, count: c })) },
          calc: counts.map((c, i) => `${i + 1} \u2605: ${fmtN(c)} (${fmtPct(list.length ? (c / list.length) * 100 : 0, 0)})`),
        };
      },
    });

    const overTime = card(T, {
      id: 'rt-trend', title: 'Ratings over time', sub: 'Number of ratings and average stars', span: 8, height: 260, chartTypes: ['bar', 'line', 'area'],
      load: async () => {
        const list = await data();
        const { range, g } = span(list);
        const buckets = makeBuckets(range.startDate, range.endDate, g);
        const idx = new Map(buckets.map((b, i) => [b.bucketStartDate, i]));
        const cnt = new Array(buckets.length).fill(0), tot = new Array(buckets.length).fill(0);
        for (const x of list) { const i = idx.get(bucketStart(x.date, g)); if (i != null) { cnt[i]++; tot[i] += x.stars; } }
        const rows = buckets.map((b, i) => ({ ...b, label: bucketLabel(b, g), full: bucketFull(b, g), count: cnt[i], avg: cnt[i] ? Math.round((tot[i] / cnt[i]) * 100) / 100 : null }));
        return {
          spec: { kind: 'series', mode: 'bar', title: 'Ratings over time', height: 260, emptyText: 'No ratings', categories: catsOf(rows), series: [{ name: 'Ratings', values: cnt, color: Theme.palette[0] }], tipExtra: (i) => (rows[i].avg != null ? ttRow(Theme.v('--warn'), 'Average stars', fmt1(rows[i].avg)) : '') },
          dataset: { columns: [{ key: 'label', label: 'Period' }, { key: 'startDate', label: 'Start', type: 'date' }, { key: 'endDate', label: 'End', type: 'date' }, { key: 'count', label: 'Ratings', type: 'number' }, { key: 'avg', label: 'Average stars', type: 'number' }], rows },
          calc: [`${fmtN(sum(cnt))} ratings in ${plural(rows.length, `${g.toLowerCase()} bucket`)} from ${fmtRange(range.startDate, range.endDate)}.`, scope === 'all' ? 'With "All time", the range starts at the earliest rating and granularity is chosen automatically.' : null],
        };
      },
    });

    const mostRated = card(T, {
      id: 'rt-assets', title: 'Most rated assets', sub: 'Click to explore', span: 6,
      load: async () => {
        const list = await data();
        const rows = [...groupBy(list, (x) => x.assetId).entries()].map(([id, v]) => ({ id, name: v[0].asset, type: v[0].type, domain: v[0].domain, count: v.length, avg: sum(v, (x) => x.stars) / v.length })).sort((a, b) => b.count - a.count || b.avg - a.avg);
        if (!rows.length) return { empty: { title: 'No ratings', text: scope === 'range' ? 'No ratings were given in this period. Try "All time".' : 'No assets have been rated yet.' } };
        return {
          spec: { kind: 'hbar', title: 'Most rated assets', valueLabel: 'Ratings', rowH: 24, color: Theme.palette[1], items: rows.slice(0, 15).map((x) => ({ label: x.name, value: x.count, sub: `Average ${fmt1(x.avg)} / 5 · ${[x.type, x.domain].filter(Boolean).join(' · ')}`, onClick: () => openAsset(x.id) })) },
          dataset: { columns: [{ key: 'name', label: 'Asset', link: (x) => Env.assetUrl(x.id) }, { key: 'type', label: 'Asset type' }, { key: 'domain', label: 'Domain' }, { key: 'count', label: 'Ratings', type: 'number', bar: true }, { key: 'avg', label: 'Average', type: 'stars' }], rows },
          tableOpts: { onRowClick: (x) => openAsset(x.id) },
          calc: [`${plural(rows.length, 'rated asset')}.`, `#1: ${rows[0].name} with ${plural(rows[0].count, 'rating')}, average ${fmt1(rows[0].avg)} stars.`],
        };
      },
    });

    const avgCard = card(T, {
      id: 'rt-avg', title: 'Average rating by asset type', span: 6,
      load: async () => {
        const list = await data();
        const rows = [...groupBy(list, (x) => x.type || '(unknown)').entries()].map(([k, v]) => ({ label: k, value: Math.round((sum(v, (x) => x.stars) / v.length) * 100) / 100, count: v.length })).sort((a, b) => b.value - a.value);
        if (!rows.length) return { empty: { title: 'No ratings' } };
        return {
          spec: { kind: 'hbar', title: 'Average rating by asset type', valueLabel: 'Average stars', valueFormat: fmt1, color: Theme.v('--warn'), items: rows.map((x) => ({ label: x.label, value: x.value, sub: `${fmtN(x.count)} ratings` })) },
          dataset: { columns: [{ key: 'label', label: 'Asset type' }, { key: 'count', label: 'Ratings', type: 'number' }, { key: 'value', label: 'Average', type: 'stars' }], rows },
          calc: rows.map((x) => `${x.label}: average ${fmt1(x.value)} stars over ${plural(x.count, 'rating')}`),
        };
      },
    });

    const table = card(T, {
      id: 'rt-table', title: 'All ratings', sub: 'Newest first', span: 12,
      load: async () => {
        const list = await data();
        if (!list.length) return { empty: { title: 'No ratings', text: scope === 'range' ? 'No ratings were given in this period. Try "All time".' : 'No assets have been rated yet.' } };
        return {
          dataset: { columns: [
            { key: 'createdOn', label: 'Date', type: 'datetime' },
            { key: 'asset', label: 'Asset', link: (x) => Env.assetUrl(x.assetId) },
            { key: 'type', label: 'Asset type' },
            { key: 'stars', label: 'Rating', type: 'stars' },
            { key: 'user', label: 'Reviewer' },
            { key: 'review', label: 'Review', clamp: true },
          ], rows: list },
          tableOpts: { sort: 'createdOn', dir: 'desc', onRowClick: (x) => openAsset(x.assetId), searchPlaceholder: 'Search assets, reviewers, reviews…' },
          calc: [`${plural(list.length, 'rating')}; ${fmtN(list.filter((x) => x.review).length)} include written text.`, scope === 'all' ? 'Scope: all time.' : `Scope: ${fmtRange(r.startDate, r.endDate)}.`],
        };
      },
    });

    const coverage = card(T, {
      id: 'rt-coverage', title: 'Rating coverage of popular assets', sub: 'Do the 100 most-visited assets in the date range have ratings?', span: 12, height: 220,
      load: async () => {
        if (!Env.caps.ua || Env.caps.uaForbidden) return { empty: { title: 'Needs Usage Analytics', text: 'Popularity in the date range comes from Usage Analytics, which isn\u2019t available.' } };
        const [top, all] = await Promise.all([Data.contentDetail('Asset', r), data()]);
        const list = top.slice(0, 100);
        if (!list.length) return { empty: { title: 'No asset visits', text: 'No assets were visited in the selected date range.' } };
        const by = groupBy(all, (x) => x.assetId);
        const rows = list.map((x, i) => {
          const rs = by.get(x.id) || [];
          return { id: x.id, rank: i + 1, name: x.name, type: x.assetType, visits: x.visits, ratings: rs.length, avg: rs.length ? sum(rs, (y) => y.stars) / rs.length : null, rated: rs.length ? 'Yes' : 'No' };
        });
        const rated = rows.filter((x) => x.ratings).length;
        return {
          stats: [{ label: 'Coverage', value: (rated / rows.length) * 100, display: fmtPct((rated / rows.length) * 100, 0), primary: true }, { label: 'Rated', value: rated }, { label: 'Unrated', value: rows.length - rated }, { label: 'Unrated visits', value: sum(rows.filter((x) => !x.ratings), (x) => x.visits), hint: 'Visits to popular assets that nobody has rated' }],
          spec: { kind: 'donut', title: 'Rating coverage', items: [{ label: 'Rated', value: rated, color: Theme.v('--good') }, { label: 'Not rated', value: rows.length - rated, color: Theme.v('--text-3') }], centerLabel: 'top assets', valueLabel: 'Assets' },
          dataset: {
            columns: [{ key: 'rank', label: 'Visit rank', type: 'number' }, { key: 'name', label: 'Asset', link: (x) => Env.assetUrl(x.id) }, { key: 'type', label: 'Asset type' }, { key: 'visits', label: 'Visits', type: 'number', bar: true },
              { key: 'rated', label: 'Rated' }, { key: 'ratings', label: 'Ratings', type: 'number' }, { key: 'avg', label: 'Average', type: 'stars' }],
            rows,
          },
          tableOpts: { sort: 'rank', dir: 'asc', onRowClick: (x) => openAsset(x.id) },
          calc: [
            `${fmtN(rated)} of the ${fmtN(rows.length)} most-visited assets (${fmtRange(r.startDate, r.endDate)}) have at least one rating = ${fmtPct((rated / rows.length) * 100)}.`,
            `Ratings counted: ${scope === 'all' ? 'all time' : 'given in the date range'} (follows the Scope switch).`,
            `The ${fmtN(rows.length - rated)} unrated assets got ${fmtN(sum(rows.filter((x) => !x.ratings), (x) => x.visits))} visits: good candidates to ask for ratings.`,
          ],
        };
      },
    });

    panel.append(kpis.el, grid(dist, overTime), grid(mostRated, avgCard), grid(coverage), grid(table));
    runAll(T);
  }

  const TABS = { overview: buildOverview, content: buildContent, dashboards: buildDashboards, users: buildUsers, asset: buildAsset, compare: buildCompare, popularity: buildPopularity, activity: buildActivity, ratings: buildRatings };
  const UA_TABS = ['overview', 'content', 'dashboards', 'users', 'compare'];

  /* ────────────────────────────────────────────────────────────────────────
     Global controls
     ──────────────────────────────────────────────────────────────────────── */

  const Controls = {
    init() {
      $('#ctl-preset').addEventListener('change', (e) => {
        const v = e.target.value;
        if (v === 'custom') { const cur = State.range(); App.update({ range: 'custom', from: cur.startDate, to: cur.endDate }); } else App.update({ range: v });
      });
      const onDate = () => {
        const a = $('#ctl-start').value, b = $('#ctl-end').value;
        if (!isIsoDate(a) || !isIsoDate(b)) return;
        App.update({ range: 'custom', from: a <= b ? a : b, to: a <= b ? b : a });
      };
      $('#ctl-start').addEventListener('change', onDate);
      $('#ctl-end').addEventListener('change', onDate);
      $$('#ctl-gran button').forEach((b) => b.addEventListener('click', () => App.update({ g: b.dataset.value })));
      $('#ctl-compare').addEventListener('change', (e) => App.update({ cmp: e.target.value }));
      $('#ctl-xadmin').addEventListener('change', (e) => App.update({ xa: e.target.checked }));
      $('#ctl-xdisabled').addEventListener('change', (e) => App.update({ xd: e.target.checked }));

      const fb = $('#filter-buttons');
      for (const f of FILTERS) {
        const btn = h('button', { class: 'btn btn-sm filter-btn', type: 'button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', dataset: { filter: f.key } },
          h('span', null, f.label), h('span', { class: 'count' }), s('svg', { class: 'caret', viewBox: '0 0 24 24', 'aria-hidden': 'true' }, s('path', { d: 'M7 10l5 5 5-5z', fill: 'currentColor' })));
        btn.addEventListener('click', () => this.openPicker(f, btn));
        fb.append(h('div', { class: 'menu-wrap' }, btn));
      }

      $('#btn-reset').addEventListener('click', () => {
        const d = JSON.parse(JSON.stringify(DEFAULTS));
        App.update({ ...d, tab: State.s.tab, asset: State.s.asset, items: State.s.items, users: State.s.users });
        toast('Filters reset');
      });
      $('#btn-share').addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(location.href); toast('Link copied — it opens this exact view', 'good'); } catch { Modal.show('Shareable link', h('input', { class: 'input', style: { width: '100%' }, value: location.href, readonly: true, onfocus: (e) => e.target.select() })); }
      });
      $('#btn-views').addEventListener('click', () => Menus.toggle($('#btn-views'), $('#menu-views'), (m) => this.viewsMenu(m)));
      $('#btn-export-all').addEventListener('click', () => Menus.toggle($('#btn-export-all'), $('#menu-export-all')));
      $$('#menu-export-all [data-export-all]').forEach((b) => b.addEventListener('click', () => { Menus.close(); exportAll(b.dataset.exportAll); }));
      $('#btn-refresh').addEventListener('click', () => App.refresh());
      $('#btn-theme').addEventListener('click', () => App.toggleTheme());
      $('#btn-help').addEventListener('click', () => App.help());
      $('#modal [data-close]').addEventListener('click', () => Modal.hide());
      $('#modal').addEventListener('mousedown', (e) => { if (e.target.id === 'modal') Modal.hide(); });

      const tabs = $$('#tabs [role="tab"]');
      tabs.forEach((t, i) => {
        t.addEventListener('click', () => App.update({ tab: t.dataset.tab }));
        t.addEventListener('keydown', (e) => {
          const visible = tabs.filter((x) => !x.hidden);
          const k = visible.indexOf(t);
          let next = null;
          if (e.key === 'ArrowRight') next = visible[(k + 1) % visible.length];
          if (e.key === 'ArrowLeft') next = visible[(k - 1 + visible.length) % visible.length];
          if (next) { e.preventDefault(); next.focus(); App.update({ tab: next.dataset.tab }); }
        });
        t.setAttribute('aria-controls', `panel-${t.dataset.tab}`);
        t.title = `${t.textContent} (${i + 1})`;
      });
    },

    sync() {
      const st = State.s;
      const r = State.range();
      $('#ctl-preset').value = st.range;
      const max = yesterday();
      for (const [sel, v] of [['#ctl-start', r.startDate], ['#ctl-end', r.endDate]]) { $(sel).value = v; $(sel).max = max; }
      $$('#ctl-gran button').forEach((b) => {
        const on = b.dataset.value === st.g;
        b.setAttribute('aria-checked', String(on));
        b.title = b.dataset.value === 'Auto' ? `Automatic (${State.gran()})` : '';
        b.textContent = b.dataset.value === 'Auto' && on ? `Auto · ${State.gran()}` : b.dataset.value;
      });
      $('#ctl-compare').value = st.cmp;
      $('#ctl-xadmin').checked = st.xa;
      $('#ctl-xdisabled').checked = st.xd;
      $$('#filter-buttons .filter-btn').forEach((b) => {
        const n = st.f[b.dataset.filter].length;
        const c = b.querySelector('.count');
        c.textContent = n;
        c.hidden = !n;
        b.classList.toggle('active', n > 0);
      });
      const link = $('#open-ua-link');
      if (Env.base) {
        link.href = `${Env.base}/apps/usage-analytics/${State.s.tab === 'users' ? 'users' : 'usage'}?start-date=${r.startDate}&end-date=${r.endDate}`;
        link.hidden = !Env.caps.ua;
      }
      this.chips();
      $$('#tabs [role="tab"]').forEach((t) => {
        const on = t.dataset.tab === st.tab;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
      });
      document.title = `Usage Analytics · ${$(`#tab-${st.tab}`).textContent} · ${Env.host() || 'Collibra'}`;
    },

    chips() {
      const box = $('#active-filters');
      const chips = [];
      for (const f of FILTERS) {
        for (const id of State.s.f[f.key]) {
          chips.push(h('span', { class: 'chip' }, h('b', null, `${f.label}:`), State.label(f.key, id),
            h('button', { type: 'button', 'aria-label': `Remove ${State.label(f.key, id)}`, onclick: () => App.update({ f: { ...State.s.f, [f.key]: State.s.f[f.key].filter((x) => x !== id) } }) }, '✕')));
        }
      }
      if (State.s.xa) chips.push(h('span', { class: 'chip' }, 'Admins excluded', h('button', { type: 'button', 'aria-label': 'Include admins', onclick: () => App.update({ xa: false }) }, '✕')));
      if (State.s.xd) chips.push(h('span', { class: 'chip' }, 'Disabled users excluded', h('button', { type: 'button', 'aria-label': 'Include disabled users', onclick: () => App.update({ xd: false }) }, '✕')));
      if (chips.length > 1) chips.push(h('button', { class: 'chip-clear', type: 'button', onclick: () => App.update({ f: JSON.parse(JSON.stringify(DEFAULTS.f)), xa: false, xd: false }) }, 'Clear all'));
      box.replaceChildren(...chips);
    },

    async loadLists() {
      const r = State.range();
      await Promise.all(FILTERS.map(async (f) => {
        try {
          const list = await Data.filterList(f.list, r);
          State.lists[f.key] = list;
          list.forEach((x) => State.labels.set(`${f.key}:${x.id}`, x.label));
        } catch (e) {
          if (!isAbort(e)) { State.lists[f.key] = State.lists[f.key] || []; console.warn(`[usage-dashboard] filter list ${f.key}:`, e); }
        }
      }));
      this.chips();
    },

    openPicker(f, btn) {
      if (Menus.open && Menus.open.btn === btn) { Menus.close(); return; }
      const selected = new Set(State.s.f[f.key]);
      const search = h('input', { type: 'search', placeholder: `Search ${f.label.toLowerCase()}…`, 'aria-label': `Search ${f.label}` });
      const listEl = h('div', { class: 'picker-list' });
      const countEl = h('span', null, `${selected.size} selected`);
      const shown = () => {
        const q = search.value.trim().toLowerCase();
        return (State.lists[f.key] || []).filter((x) => !q || x.label.toLowerCase().includes(q));
      };
      const draw = () => {
        const list = State.lists[f.key];
        const items = shown();
        if (!list) { listEl.replaceChildren(h('div', { class: 'menu-empty' }, h('span', { class: 'spinner sm' }), ' Loading…')); return; }
        if (!items.length) { listEl.replaceChildren(h('div', { class: 'menu-empty' }, list.length ? 'No matches' : 'No values in this date range')); return; }
        listEl.replaceChildren(...items.slice(0, 600).map((x) => {
          const cb = h('input', { type: 'checkbox', checked: selected.has(x.id) });
          cb.addEventListener('change', () => { if (cb.checked) selected.add(x.id); else selected.delete(x.id); countEl.textContent = `${selected.size} selected`; });
          return h('label', { class: 'picker-item' }, cb, h('span', null, x.label), x.meta ? h('span', { class: 'tag' }, x.meta) : null);
        }));
      };
      search.addEventListener('input', debounce(draw, 120));
      const apply = () => { Menus.close(); App.update({ f: { ...State.s.f, [f.key]: [...selected] } }); };
      search.addEventListener('keydown', (e) => { if (e.key === 'Enter') apply(); });
      const menu = h('div', { class: 'menu picker', role: 'dialog', 'aria-label': f.label, dataset: { temp: '1' } },
        h('div', { class: 'picker-head' }, search, h('div', { class: 'picker-tools' }, countEl,
          h('span', null,
            h('button', { type: 'button', onclick: () => { shown().forEach((x) => selected.add(x.id)); countEl.textContent = `${selected.size} selected`; draw(); } }, 'Select shown'),
            ' · ',
            h('button', { type: 'button', onclick: () => { selected.clear(); countEl.textContent = '0 selected'; draw(); } }, 'Clear')))),
        listEl,
        h('div', { class: 'picker-foot' },
          f.services.length < 2 ? h('span', { class: 'note', style: { marginRight: 'auto', padding: 0 } }, 'Content metrics only') : null,
          h('button', { class: 'btn btn-sm', type: 'button', onclick: () => Menus.close() }, 'Cancel'),
          h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: apply }, 'Apply')));
      Menus.close();
      btn.parentElement.append(menu);
      btn.setAttribute('aria-expanded', 'true');
      Menus.open = { btn, menu };
      draw();
      if (!State.lists[f.key]) this.loadLists().then(draw);
      setTimeout(() => search.focus(), 0);
    },

    views() { try { return JSON.parse(localStorage.getItem(`${STORE}views`) || '[]'); } catch { return []; } },
    saveViews(v) { try { localStorage.setItem(`${STORE}views`, JSON.stringify(v)); } catch { toast('Couldn\u2019t save (browser storage is blocked).', 'error'); } },

    viewsMenu(menu) {
      const views = this.views();
      menu.replaceChildren(
        h('div', { class: 'menu-label' }, 'Saved views'),
        ...(views.length ? views.map((v, i) => h('div', { class: 'menu-row' },
          h('button', { type: 'button', role: 'menuitem', title: v.desc || '', onclick: () => { Menus.close(); App.update(State.fromHash(v.hash)); toast(`Loaded view "${v.name}"`); } }, v.name),
          h('button', { type: 'button', class: 'del', 'aria-label': `Delete ${v.name}`, onclick: (e) => { e.stopPropagation(); const all = this.views(); all.splice(i, 1); this.saveViews(all); this.viewsMenu(menu); } }, '✕')))
          : [h('div', { class: 'menu-empty' }, 'No saved views yet')]),
        h('div', { class: 'menu-sep' }),
        h('button', { type: 'button', role: 'menuitem', onclick: () => { Menus.close(); this.saveViewDialog(); } }, 'Save current view…'),
      );
    },

    saveViewDialog() {
      const input = h('input', { type: 'text', id: 'view-name', maxlength: 60, placeholder: 'e.g. Stewards, last quarter' });
      const save = () => {
        const name = input.value.trim();
        if (!name) { input.focus(); return; }
        const all = this.views().filter((v) => v.name !== name);
        all.unshift({ name, hash: State.toHash(), desc: State.describe(), savedAt: Date.now() });
        this.saveViews(all.slice(0, 30));
        Modal.hide();
        toast(`Saved view "${name}"`, 'good');
      };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
      Modal.show('Save view', h('div', null,
        h('p', { class: 'muted' }, 'Saves the date range, filters, tab and options in this browser.'),
        h('label', { for: 'view-name' }, 'Name'), input,
        h('p', { class: 'hint' }, State.describe()),
        h('div', { class: 'dialog-actions' }, h('button', { class: 'btn', type: 'button', onclick: () => Modal.hide() }, 'Cancel'), h('button', { class: 'btn btn-primary', type: 'button', onclick: save }, 'Save'))));
      setTimeout(() => input.focus(), 0);
    },
  };

  /* ────────────────────────────────────────────────────────────────────────
     App controller
     ──────────────────────────────────────────────────────────────────────── */

  const LOCAL_KEYS = {
    ctype: 'content', stale: 'content', utype: 'users', users: 'users', asset: 'asset', popN: 'popularity', actCap: 'activity', cause: 'activity', rscope: 'ratings',
    dsel: 'dashboards', dmin: 'dashboards', dtop: 'dashboards', items: 'compare', cmetric: 'compare', cnorm: 'compare', cbench: 'compare',
  };
  /** View-only keys that just re-run specific widgets instead of rebuilding their tab. */
  const RERUN_KEYS = { mixOff: ['ov-mix', 'ov-trend'] };

  const App = {
    dirty: new Set(TAB_IDS),
    forbiddenShown: false,

    update(patch) {
      const prev = State.s;
      const next = { ...prev, ...patch, f: patch.f ? { ...prev.f, ...patch.f } : prev.f };
      if (next.range !== 'custom') { next.from = ''; next.to = ''; }
      if (!Env.caps.ua && UA_TABS.includes(next.tab)) next.tab = 'asset';
      const changed = Object.keys(next).filter((k) => JSON.stringify(prev[k]) !== JSON.stringify(next[k]));
      State.s = next;
      const hash = State.toHash();
      if (location.hash.replace(/^#/, '') !== hash) history.replaceState(null, '', hash ? `#${hash}` : location.pathname + location.search);
      if (!changed.length) return;
      if (changed.some((k) => DATA_KEYS.includes(k))) {
        Api.resetScope();
        TAB_IDS.forEach((t) => this.dirty.add(t));
        if (['range', 'from', 'to'].some((k) => changed.includes(k))) Controls.loadLists();
      } else {
        changed.forEach((k) => { if (LOCAL_KEYS[k]) this.dirty.add(LOCAL_KEYS[k]); });
        changed.forEach((k) => (RERUN_KEYS[k] || []).forEach((id) => TAB_IDS.forEach((t) => Widgets.all(t).filter((w) => w.opts && w.opts.id === id).forEach((w) => w.run()))));
      }
      Controls.sync();
      exitFullscreen();
      this.showTab();
    },

    showTab() {
      const t = State.s.tab;
      TAB_IDS.forEach((id) => { $(`#panel-${id}`).hidden = id !== t; });
      if (this.dirty.has(t)) {
        const panel = $(`#panel-${t}`);
        Widgets.clear(t);
        panel.replaceChildren();
        this.dirty.delete(t);
        try { TABS[t](panel); } catch (e) { console.error(e); panel.replaceChildren(errorEl(e)); }
      }
    },

    rerun(id) {
      const w = Widgets.all(State.s.tab).find((x) => x.opts && x.opts.id === id);
      if (w) w.run();
    },

    refresh() {
      Api.clearCache();
      Data.activityCache.clear();
      TAB_IDS.forEach((t) => this.dirty.add(t));
      loadHeader();
      Controls.loadLists();
      this.showTab();
      toast('Reloading data…');
    },

    toggleTheme() {
      Theme.set(Theme.current() === 'dark' ? 'light' : 'dark');
      TAB_IDS.forEach((t) => Widgets.all(t).forEach((w) => { if (w.result) w.render(); }));
    },

    uaForbidden() {
      if (this.forbiddenShown) return;
      this.forbiddenShown = true;
      Env.caps.uaForbidden = true;
      Banner.show('<strong>No access to Usage Analytics.</strong> Your account needs the Usage Analytics (Insights) permission. All-time popularity, edit activity and ratings still work.', 'error',
        [h('button', { class: 'btn btn-sm', type: 'button', onclick: () => App.update({ tab: 'popularity' }) }, 'Go to Popularity')]);
    },

    help() {
      const rows = [['1 – 9', 'Switch tabs'], ['R', 'Refresh all data'], ['T', 'Toggle dark mode'], ['/', 'Search assets (Asset Explorer)'], ['I', 'How the focused chart or metric is calculated'], ['?', 'This help'], ['Esc', 'Close menus, dialogs and fullscreen']];
      Modal.show('Help', h('div', null,
        h('table', { class: 'shortcuts' }, h('tbody', null, rows.map(([k, v]) => h('tr', null, h('td', null, h('span', { class: 'kbd' }, k)), h('td', null, v))))),
        h('h3', { style: { fontSize: '14px', margin: '18px 0 6px' } }, 'Connection'),
        h('p', { class: 'muted', style: { margin: 0 } }, `Collibra: ${Env.base} (found via ${Env.source})`),
        h('p', { class: 'muted', style: { margin: 0 } }, `Version: ${Env.info?.version?.displayVersion || 'unknown'} · GraphQL: ${Env.caps.graphql ? 'available' : 'unavailable (REST fallback)'} · Usage Analytics: ${!Env.caps.ua ? 'not available' : Env.caps.uaForbidden ? 'no permission' : 'available'}`),
        h('h3', { style: { fontSize: '14px', margin: '18px 0 6px' } }, 'Data sources'),
        h('ul', { class: 'muted', style: { margin: 0, paddingLeft: '18px' } },
          h('li', null, 'Usage Analytics (internal): visits, users, per-asset usage and row-level detail downloads'),
          h('li', null, 'REST 2.0: navigation statistics, activities (audit trail), ratings, users, assets'),
          h('li', null, 'GraphQL Knowledge Graph: asset type, status, domain and community enrichment')),
        h('p', { class: 'hint' }, 'Tip: click \u24d8 on any metric or chart to see exactly how it\u2019s calculated, with the current numbers. Every chart has its own export menu (PNG, JPEG, SVG, PDF, print, CSV, Excel, JSON); Excel, JSON and print exports include the calculation notes. Click legend items to hide series; click bars and periods to drill down.')));
    },
  };

  window.addEventListener('hashchange', () => {
    const want = location.hash.replace(/^#/, '');
    if (want !== State.toHash()) App.update(State.fromHash(want));
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { Menus.close(); Modal.hide(); exitFullscreen(); Tip.hide(); return; }
    if (e.target.closest('input, select, textarea, [contenteditable]') || e.ctrlKey || e.metaKey || e.altKey) return;
    if (!$('#modal').hidden || !$('#connect').hidden || !Env.base) return;
    if (/^[1-9]$/.test(e.key)) {
      const t = TAB_IDS[Number(e.key) - 1];
      if (t && !$(`#tab-${t}`).hidden) App.update({ tab: t });
    } else if (e.key === 'r' || e.key === 'R') App.refresh();
    else if (e.key === 't' || e.key === 'T') App.toggleTheme();
    else if (e.key === 'i' || e.key === 'I') {
      const host = document.activeElement && document.activeElement.closest('.kpi, [data-widget]');
      const btn = host && host.querySelector('.kpi-info, .info-btn');
      if (btn) btn.click();
      else toast('Focus a chart or metric first (Tab), then press I \u2014 or click its \u24d8 button.');
    }
    else if (e.key === '?') App.help();
    else if (e.key === '/') {
      e.preventDefault();
      App.update({ tab: 'asset' });
      setTimeout(() => { const i = $('#asset-search'); if (i) i.focus(); }, 0);
    }
  });

  /* ────────────────────────────────────────────────────────────────────────
     Header, connect panel, boot
     ──────────────────────────────────────────────────────────────────────── */

  async function loadHeader() {
    const chip = $('#instance-label');
    chip.textContent = Env.host();
    chip.className = 'instance-chip ok';
    chip.title = `Connected to ${Env.base} (found via ${Env.source})`;
    const [info, user, refreshed] = await Promise.all([
      Api.get('/rest/2.0/application/info').catch(() => null),
      Api.get('/rest/2.0/users/current').catch(() => null),
      Env.caps.ua ? Data.lastRefreshed().catch((e) => e) : Promise.resolve(null),
    ]);
    Env.info = info;
    if (user) {
      Env.user = user;
      const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.userName;
      const u = $('#user-label');
      u.replaceChildren(h('span', { class: 'avatar', 'aria-hidden': 'true' }, initials(name)), h('span', null, name));
      u.hidden = false;
    }
    const rl = $('#refresh-label');
    if (typeof refreshed === 'string') {
      const ms = Date.parse(refreshed);
      rl.textContent = `· Usage data refreshed ${relTime(ms)}`;
      rl.title = new Date(ms).toLocaleString();
    } else rl.textContent = '';
    $('#footer-meta').textContent = `${Env.host()}${info?.version?.displayVersion ? ` · Collibra ${info.version.displayVersion}` : ''}`;
    return refreshed;
  }

  /** Detect whether Usage Analytics exists / is permitted, and hide UA-only tabs when absent. */
  async function detectCapabilities() {
    try {
      await Data.lastRefreshed();
      Env.caps.ua = true;
    } catch (e) {
      if (e.status === 404) {
        Env.caps.ua = false;
        UA_TABS.forEach((t) => { $(`#tab-${t}`).hidden = true; });
        Banner.show('<strong>Usage Analytics isn\u2019t available on this Collibra environment.</strong> Showing popularity, edit activity and ratings.', 'info');
        if (UA_TABS.includes(State.s.tab)) State.s.tab = 'popularity';
      } else if (e.status === 403) {
        App.uaForbidden();
      }
    }
  }

  function showConnect(res) {
    const box = $('#connect');
    const reason = $('#connect-reason');
    const input = $('#connect-url');
    if (res.unauthBase) {
      reason.replaceChildren('Collibra was found at ', h('strong', null, res.unauthBase), ', but you aren\u2019t signed in. ',
        h('a', { href: `${res.unauthBase}/`, target: '_blank', rel: 'noopener' }, 'Sign in'), ' in another tab, then press Connect.');
      input.value = res.unauthBase;
    } else if (location.protocol === 'file:') {
      reason.textContent = 'This page was opened from a file, so it can\u2019t tell which Collibra environment to use. Host the three files in Collibra for automatic detection, or enter the URL below.';
    } else {
      reason.textContent = 'The Collibra REST API wasn\u2019t found relative to this page. Enter your Collibra URL below.';
    }
    try { input.value = input.value || localStorage.getItem(`${STORE}base`) || ''; } catch { /* ignore */ }
    box.hidden = false;
    $('#boot').hidden = true;
    setTimeout(() => input.focus(), 0);
    $('#connect-form').onsubmit = async (e) => {
      e.preventDefault();
      const err = $('#connect-error');
      err.textContent = '';
      const b = normBase(input.value);
      if (!b) { err.textContent = 'Enter a valid http(s) URL.'; return; }
      const btn = e.submitter || $('#connect-form button');
      btn.disabled = true;
      const p = await probeBase(b);
      btn.disabled = false;
      if (p.ok) {
        try { localStorage.setItem(`${STORE}base`, b); } catch { /* ignore */ }
        box.hidden = true;
        start({ base: b, csrf: p.csrf, source: 'Connect panel' });
      } else if (p.unauth) {
        err.replaceChildren('You aren\u2019t signed in to that Collibra. ', h('a', { href: `${b}/`, target: '_blank', rel: 'noopener' }, 'Sign in'), ', then try again.');
      } else {
        err.textContent = p.error
          ? 'Couldn\u2019t reach that URL from this page. It may be down, or blocking cross-origin requests (CORS).'
          : `No Collibra REST API found at that URL (HTTP ${p.status || '?'}).`;
      }
    };
  }

  async function start(res) {
    Env.base = res.base;
    Env.csrf = res.csrf;
    Env.source = res.source;
    rememberBase(res.base);
    Api.onSessionLost = () => Banner.show(`<strong>Your Collibra session has expired.</strong> <a href="${esc(Env.base)}/" target="_blank" rel="noopener">Sign in</a> in another tab, then press Refresh.`, 'error');
    $('#boot-text').textContent = `Connecting to ${Env.host()}…`;
    await detectCapabilities();
    loadHeader();
    Controls.init();
    Controls.sync();
    Controls.loadLists();
    $('#boot').hidden = true;
    App.showTab();
  }

  async function boot() {
    let theme = 'light';
    try { theme = localStorage.getItem(`${STORE}theme`) || 'light'; } catch { /* ignore */ }
    Theme.set(theme === 'dark' ? 'dark' : 'light');
    State.init();
    const res = await resolveBase();
    if (!res.base) { showConnect(res); return; }
    await start(res);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
