// Bing Webmaster Tools API client (read-only methods) and result normalisers.
//
// Pattern (from Microsoft's docs): GET https://ssl.bing.com/webmaster/api.svc/json/<Method>?siteUrl=...&apikey=...
// and the useful payload is wrapped in a "d" node. Dates arrive in .NET style: "/Date(1700000000000)/".
// The API key is sent in the query string by design of the API, so it must never appear in output or errors.

import fs from "node:fs";

const BASE = "https://ssl.bing.com/webmaster/api.svc/json";

export function getBingKey(env = process.env) {
  if (env.BING_WEBMASTER_API_KEY) return env.BING_WEBMASTER_API_KEY.trim();
  if (env.BING_WEBMASTER_API_KEY_FILE) {
    try {
      return fs.readFileSync(env.BING_WEBMASTER_API_KEY_FILE, "utf8").trim();
    } catch (err) {
      throw new Error(`Could not read the Bing key file (${err?.code ?? "error"}). The setting must be a path to a text file, not the key itself.`);
    }
  }
  throw new Error("Bing is not configured: set BING_WEBMASTER_API_KEY or BING_WEBMASTER_API_KEY_FILE.");
}

/** Convert "/Date(1700000000000)/" (optionally with an offset) to YYYY-MM-DD. */
export function parseBingDate(value) {
  const m = /\/Date\((-?\d+)(?:[+-]\d{4})?\)\//.exec(String(value ?? ""));
  return m ? new Date(Number(m[1])).toISOString().slice(0, 10) : value ?? null;
}

const THROTTLE = /throttle/i;
const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Call one Bing Webmaster method and return the unwrapped "d" payload.
 * Bing rate-limits by caller IP address ("ThrottleIP"). On a shared host (such as a hosted Worker) other
 * people's traffic from the same address counts too, so a throttled call is retried a couple of times
 * with a short wait; if it is still throttled the error is flagged `throttled` and says it is not the key.
 */
export async function bingCall(method, params = {}, { key = getBingKey(), fetchImpl = fetch, sleep = defaultSleep, retryDelaysMs = [1500, 4000] } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await bingCallOnce(method, params, key, fetchImpl);
    } catch (err) {
      if (!err.throttled) throw err;
      if (attempt >= retryDelaysMs.length) {
        const e = new Error(`Bing is rate-limiting requests from this server's IP address (${err.bingMessage}). This is Bing throttling a shared address, not a problem with your key. Try again in a few minutes.`);
        e.throttled = true;
        throw e;
      }
      await sleep(retryDelaysMs[attempt]);
    }
  }
}

async function bingCallOnce(method, params, key, fetchImpl) {
  const qs = new URLSearchParams({ ...params, apikey: key });
  let res;
  try {
    res = await fetchImpl(`${BASE}/${method}?${qs}`, { signal: AbortSignal.timeout(30000), headers: { accept: "application/json" } });
  } catch (err) {
    // Never include the URL: it contains the key.
    throw new Error(`Bing Webmaster ${method} request failed: ${err?.name === "TimeoutError" ? "timed out" : "network error"}.`);
  }
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  if (!res.ok) {
    const msg = body?.Message || body?.message || `HTTP ${res.status}`;
    const hint = res.status === 401 || res.status === 403 ? " (check the API key, and that the site is verified in your Bing account)" : "";
    const e = new Error(`Bing Webmaster ${method} error: ${msg}${hint}`);
    if (THROTTLE.test(msg) || res.status === 429) {
      e.throttled = true;
      e.bingMessage = String(msg).replace(/[^\w ]/g, "").trim() || "throttled";
    }
    throw e;
  }
  return body && "d" in body ? body.d : body;
}

const round = (n, d = 1) => (typeof n === "number" ? Number(n.toFixed(d)) : n);

/** Query stats come back per query per date. Collapse to one row per query. */
export function aggregateQueryStats(rows = [], { limit = 50 } = {}) {
  const map = new Map();
  for (const r of rows) {
    const q = r.Query;
    if (!q) continue;
    const e = map.get(q) ?? { query: q, clicks: 0, impressions: 0, posWeighted: 0 };
    const imp = r.Impressions ?? 0;
    e.clicks += r.Clicks ?? 0;
    e.impressions += imp;
    e.posWeighted += (r.AvgImpressionPosition ?? 0) * imp;
    map.set(q, e);
  }
  return [...map.values()]
    .map((e) => ({
      query: e.query,
      clicks: e.clicks,
      impressions: e.impressions,
      ctr: e.impressions ? round((e.clicks / e.impressions) * 100, 2) : 0,
      avgPosition: e.impressions ? round(e.posWeighted / e.impressions) : null,
    }))
    .sort((a, b) => b.impressions - a.impressions || b.clicks - a.clicks)
    .slice(0, limit);
}

/** Page stats also come back per date. Collapse to one row per page. */
export function aggregatePageStats(rows = [], { limit = 50 } = {}) {
  const map = new Map();
  for (const r of rows) {
    const page = r.Query ?? r.Page ?? r.Url;
    if (!page) continue;
    const e = map.get(page) ?? { page, clicks: 0, impressions: 0, posWeighted: 0 };
    const imp = r.Impressions ?? 0;
    e.clicks += r.Clicks ?? 0;
    e.impressions += imp;
    e.posWeighted += (r.AvgImpressionPosition ?? 0) * imp;
    map.set(page, e);
  }
  return [...map.values()]
    .map((e) => ({
      page: e.page,
      clicks: e.clicks,
      impressions: e.impressions,
      avgPosition: e.impressions ? round(e.posWeighted / e.impressions) : null,
    }))
    .sort((a, b) => b.impressions - a.impressions || b.clicks - a.clicks)
    .slice(0, limit);
}

/** Group daily rows into weeks starting Monday. Input rows: { date: 'YYYY-MM-DD', clicks, impressions }. */
export function weeklyBuckets(days = []) {
  const weeks = new Map();
  for (const d of days) {
    const t = new Date(`${d.date}T00:00:00Z`);
    if (Number.isNaN(t.getTime())) continue;
    const monday = new Date(t.getTime() - ((t.getUTCDay() + 6) % 7) * 86400000).toISOString().slice(0, 10);
    const w = weeks.get(monday) ?? { weekStarting: monday, clicks: 0, impressions: 0 };
    w.clicks += d.clicks;
    w.impressions += d.impressions;
    weeks.set(monday, w);
  }
  return [...weeks.values()].sort((a, b) => a.weekStarting.localeCompare(b.weekStarting));
}

export function normaliseTrafficStats(rows = []) {
  return rows
    .map((r) => ({ date: parseBingDate(r.Date), clicks: r.Clicks ?? 0, impressions: r.Impressions ?? 0 }))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

export function normaliseCrawlStats(rows = []) {
  return rows
    .map((r) => {
      const { Date: date, ...rest } = r;
      return { date: parseBingDate(date), ...rest };
    })
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}
