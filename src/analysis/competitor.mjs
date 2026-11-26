// Competitor content gap analysis. No credentials needed: it reads a competitor's public sitemap and pages,
// then compares their topics with your own site's pages (and, optionally, your Search Console queries).
//
// It cannot see their traffic or search volume (that needs a paid keyword database). It finds topics they
// have published that you have not covered, newest first, so you can judge which are worth writing.

import * as cheerio from "cheerio";
import { safeFetch, assertPublicUrl } from "../safe-fetch.mjs";
import { robotsAllows } from "../robots.mjs";

const UA = "seo-advisor-mcp/0.1 (content gap analysis)";
const TIMEOUT_MS = 15000;

const STOP = new Set(
  "a an and are as at be by for from how i in is it of on or that the this to vs was what when which who why with you your my our we can do does did should will not no yes all any more most best top new guide tips review reviews about into than then there their them they these those via per vs versus".split(" "),
);

/** Lower-case word tokens without stop words or pure numbers shorter than 2 chars. */
export function tokens(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter((w) => w.length > 1 && !STOP.has(w));
}

/** Words from a URL's last path segment, e.g. /blog/how-to-change-fog-lamp -> [change, fog, lamp]. */
export function slugTokens(url) {
  try {
    const seg = new URL(url).pathname.split("/").filter(Boolean).pop() || "";
    return tokens(seg.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]/g, " "));
  } catch {
    return [];
  }
}

/** Parse a sitemap or sitemap index. Returns child sitemaps and page URLs with optional lastmod. */
export function parseSitemapXml(xml) {
  const $ = cheerio.load(String(xml || ""), { xmlMode: true });
  const sitemaps = $("sitemapindex > sitemap > loc")
    .map((_, el) => $(el).text().trim())
    .get();
  const urls = $("urlset > url")
    .map((_, el) => ({ loc: $(el).children("loc").text().trim(), lastmod: $(el).children("lastmod").text().trim() || null }))
    .get()
    .filter((u) => u.loc);
  return { sitemaps, urls };
}

async function get(url) {
  const res = await safeFetch(url, { timeoutMs: TIMEOUT_MS, maxBytes: 3_000_000, headers: { "user-agent": UA, accept: "text/html,application/xml,text/xml,text/plain,*/*" } });
  return { ok: res.ok, status: res.status, text: res.text };
}

function httpOrigin(input) {
  return assertPublicUrl(/^[a-z]+:\/\//i.test(input) ? input : `https://${input}`).origin;
}

/** Collect page URLs from a site's sitemap(s): robots.txt Sitemap lines first, then /sitemap.xml. */
export async function fetchSitemapUrls(site, { maxSitemaps = 12, maxUrls = 3000, fetchText = get } = {}) {
  const origin = httpOrigin(site);
  const queue = [];
  try {
    const robots = await fetchText(`${origin}/robots.txt`);
    if (robots.ok) for (const m of robots.text.matchAll(/^\s*sitemap:\s*(\S+)/gim)) queue.push(m[1]);
  } catch {
    /* no robots.txt is fine */
  }
  queue.push(`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`);

  const seen = new Set();
  const urls = new Map();
  let fetched = 0;
  while (queue.length && fetched < maxSitemaps && urls.size < maxUrls) {
    const sm = queue.shift();
    if (seen.has(sm)) continue;
    seen.add(sm);
    let r;
    try {
      r = await fetchText(sm);
    } catch {
      continue;
    }
    if (!r.ok) continue;
    fetched++;
    const parsed = parseSitemapXml(r.text);
    queue.push(...parsed.sitemaps);
    for (const u of parsed.urls) if (!urls.has(u.loc)) urls.set(u.loc, u);
  }
  if (!urls.size) throw new Error(`No sitemap found for ${origin}. Tried robots.txt, /sitemap.xml and /sitemap_index.xml.`);
  return { origin, sitemapsRead: fetched, urls: [...urls.values()].slice(0, maxUrls) };
}

/** Looks like an article rather than a home, tag, category, author or pagination page. */
export function looksLikeContent(url, origin) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const path = u.pathname.replace(/\/$/, "");
  if (!path || path === "") return false;
  if (/\/(tag|tags|category|categories|author|authors|page|search|cart|checkout|account|login|wp-json|feed)(\/|$)/i.test(path)) return false;
  if (/\.(jpg|jpeg|png|gif|webp|svg|pdf|xml|zip)$/i.test(path)) return false;
  return slugTokens(url).length >= 2 && u.origin === origin;
}

/** Title, H1, H2s and rough length of one page. */
export function summarisePage(html) {
  const $ = cheerio.load(html);
  const text = $("main, article").first().text() || $("body").text();
  return {
    title: $("head > title").first().text().trim(),
    h1: $("h1").first().text().replace(/\s+/g, " ").trim(),
    description: $('meta[name="description"]').attr("content")?.trim() || "",
    headings: $("h2")
      .map((_, el) => $(el).text().replace(/\s+/g, " ").trim())
      .get()
      .filter(Boolean)
      .slice(0, 12),
    words: text.split(/\s+/).filter(Boolean).length,
  };
}

/** How much of a competitor page's topic words appear in one of your corpus items (0 to 1). */
export function overlap(topic, corpusTokens) {
  if (!topic.length) return 0;
  const set = new Set(corpusTokens);
  return topic.filter((t) => set.has(t)).length / topic.length;
}

/**
 * Compare competitor pages with what you already cover.
 * @param competitorPages [{ url, lastmod, title, h1, headings, words }]
 * @param ownItems [{ label, tokens }] your pages (from slugs/titles) and, optionally, your Search Console queries
 * @param threshold a competitor topic counts as covered when at least this share of its words appear in one of your items
 */
export function findGaps(competitorPages, ownItems, { threshold = 0.6 } = {}) {
  return competitorPages
    .map((p) => {
      const topic = [...new Set(tokens(p.h1 || p.title).concat(slugTokens(p.url)))];
      let best = { score: 0, label: null };
      for (const item of ownItems) {
        const score = overlap(topic, item.tokens);
        if (score > best.score) best = { score, label: item.label };
      }
      return { ...p, topic, coverage: Number(best.score.toFixed(2)), closestOwn: best.score > 0 ? best.label : null };
    })
    .map((p) => ({ ...p, status: p.coverage >= threshold ? "covered" : p.coverage >= 0.3 ? "partly covered" : "gap" }));
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]).catch((err) => ({ error: err?.name === "TimeoutError" ? "timed out" : "fetch failed" }));
      }
    }),
  );
  return out;
}

const byRecent = (a, b) => String(b.lastmod || "").localeCompare(String(a.lastmod || ""));

/** The whole report. `ownQueries` are optional search queries you already appear for (from Search Console). */
export async function competitorGaps({ competitor, ownSite, ownQueries = [], maxPages = 40, fetchText = get }) {
  const maxN = Math.max(5, Math.min(100, maxPages));
  const them = await fetchSitemapUrls(competitor, { fetchText });
  const ownOrigin = ownSite ? httpOrigin(ownSite) : null;
  const mine = ownOrigin ? await fetchSitemapUrls(ownOrigin, { fetchText }).catch(() => null) : null;

  // Be a polite guest: only read pages the competitor's own robots.txt allows.
  let robotsText = "";
  try {
    const r = await fetchText(`${them.origin}/robots.txt`);
    if (r.ok) robotsText = r.text;
  } catch {
    /* no robots.txt: nothing is disallowed */
  }
  const allowed = (u) => {
    try {
      const x = new URL(u.loc);
      return robotsAllows(robotsText, x.pathname + x.search);
    } catch {
      return false;
    }
  };
  const content = them.urls.filter((u) => looksLikeContent(u.loc, them.origin) && allowed(u)).sort(byRecent);
  const picked = content.slice(0, maxN);

  const pages = await mapLimit(picked, 3, async (u) => {
    const r = await fetchText(u.loc);
    if (!r.ok) return { url: u.loc, lastmod: u.lastmod, error: `HTTP ${r.status}` };
    return { url: u.loc, lastmod: u.lastmod, ...summarisePage(r.text) };
  });
  const good = pages.filter((p) => !p.error);

  const ownItems = [
    ...(mine?.urls ?? []).map((u) => ({ label: u.loc, tokens: slugTokens(u.loc) })),
    ...ownQueries.map((q) => ({ label: `query: ${q}`, tokens: tokens(q) })),
  ];
  const compared = findGaps(good, ownItems);
  const gaps = compared.filter((p) => p.status === "gap");
  const partly = compared.filter((p) => p.status === "partly covered");

  return {
    competitor: them.origin,
    sitemapPagesTotal: them.urls.length,
    articleLikePages: content.length,
    pagesRead: good.length,
    pagesFailed: pages.length - good.length,
    yourPagesKnown: mine?.urls.length ?? 0,
    yourQueriesUsed: ownQueries.length,
    newestFirst: true,
    gaps: gaps.map(({ url, lastmod, title, h1, headings, words }) => ({ url, lastmod, title, h1, headings, words })),
    partlyCovered: partly.map(({ url, lastmod, title, closestOwn, coverage }) => ({ url, lastmod, title, closestOwn, coverage })),
    alreadyCovered: compared.filter((p) => p.status === "covered").map((p) => ({ url: p.url, title: p.title, closestOwn: p.closestOwn })),
    notes: [
      "Search volume and the competitor's real traffic are not available here. Treat 'gap' as 'they wrote it and you have not', then judge demand with Search Console, Trends or Bing data.",
      "A recent lastmod means the page was added or updated recently, not that it performs well.",
      ownOrigin && !mine ? "Your own sitemap could not be read, so coverage is based on the queries you passed only." : null,
      !ownItems.length ? "No own pages or queries were available, so every competitor page shows as a gap." : null,
    ].filter(Boolean),
  };
}
