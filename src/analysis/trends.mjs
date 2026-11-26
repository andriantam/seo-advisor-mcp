// Google Trends "Trending Now": the public daily-trends RSS feed. No credentials needed.
// This is the feed Google itself publishes (trends.google.com/trending/rss). It lists what is
// spiking right now in a country, not historical interest for a keyword.

import * as cheerio from "cheerio";

const FEED = "https://trends.google.com/trending/rss";

/** Parse the RSS XML into plain objects. Exported for tests. */
export function parseTrendingRss(xml) {
  const $ = cheerio.load(xml, { xmlMode: true });
  return $("item")
    .map((_, el) => {
      const item = $(el);
      return {
        topic: item.children("title").first().text().trim(),
        approxSearches: item.find("ht\\:approx_traffic").first().text().trim() || null,
        startedAt: item.children("pubDate").first().text().trim() || null,
        news: item
          .find("ht\\:news_item")
          .map((__, n) => ({
            title: $(n).find("ht\\:news_item_title").text().trim(),
            source: $(n).find("ht\\:news_item_source").text().trim(),
            url: $(n).find("ht\\:news_item_url").text().trim(),
          }))
          .get()
          .slice(0, 3),
      };
    })
    .get()
    .filter((t) => t.topic);
}

/** Keep trends whose topic or headlines contain any of the given words (case-insensitive). */
export function filterTrends(trends, matching = []) {
  const words = matching.map((w) => w.toLowerCase()).filter(Boolean);
  if (!words.length) return trends;
  return trends.filter((t) => {
    const hay = [t.topic, ...t.news.map((n) => n.title)].join(" ").toLowerCase();
    return words.some((w) => hay.includes(w));
  });
}

async function trendingOne({ geo, matching, limit }) {
  if (!/^[A-Za-z]{2}(-[A-Za-z0-9]{1,3})?$/.test(geo)) throw new Error("geo must be a country code such as US, SG, MY or GB.");
  const res = await fetch(`${FEED}?geo=${encodeURIComponent(geo.toUpperCase())}`, {
    signal: AbortSignal.timeout(20000),
    headers: { "user-agent": "seo-advisor-mcp/0.1 (trends)" },
  });
  if (!res.ok) throw new Error(`Google Trends feed returned HTTP ${res.status}.`);
  const all = parseTrendingRss(await res.text());
  const trends = filterTrends(all, matching).slice(0, limit);
  return {
    geo: geo.toUpperCase(),
    source: "Google Trends 'Trending Now' public RSS feed",
    totalInFeed: all.length,
    returned: trends.length,
    trends,
    note: "These are short-lived spikes across all topics. Use them to time content, not as proof of lasting demand. approxSearches is a bucket such as '200+', not an exact count.",
  };
}

/** Split "MY, SG" / "MY SG" / "my;sg" into unique upper-case codes. */
export function parseGeos(value) {
  const codes = String(value ?? "").split(/[\s,;]+/).filter(Boolean).map((c) => c.toUpperCase());
  return [...new Set(codes)];
}

/** One country, or several (comma-separated). Several return { geos, results: [one per country] }. */
export async function trendingNow({ geo = "US", matching = [], limit = 25 } = {}) {
  const geos = parseGeos(geo);
  if (!geos.length) throw new Error("geo must be a country code such as US, SG, MY or GB.");
  if (geos.length > 5) throw new Error("Please give at most 5 country codes.");
  if (geos.length === 1) return trendingOne({ geo: geos[0], matching, limit });
  const results = await Promise.all(
    geos.map((g) => trendingOne({ geo: g, matching, limit }).catch((err) => ({ geo: g, error: err.message }))),
  );
  return { geos, results };
}
