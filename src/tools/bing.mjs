// Bing Webmaster Tools. Read-only. Needs BING_WEBMASTER_API_KEY (or BING_WEBMASTER_API_KEY_FILE).

import { z } from "zod";
import { guard, READ_ONLY } from "../util.mjs";
import { bingCall, aggregateQueryStats, aggregatePageStats, normaliseTrafficStats, normaliseCrawlStats, weeklyBuckets } from "../analysis/bing.mjs";

const siteArg = z.string().optional().describe("Verified site URL, e.g. https://example.com/. Ask the user if you do not know it.");
const site = (s, ctx) => {
  const v = s || ctx.defaults.bingSite;
  if (!v) throw new Error("Missing siteUrl. Ask the user which site to analyse (e.g. https://example.com/). It must already be verified in Bing Webmaster Tools under the account that owns the API key; bing_list_sites shows which sites are available.");
  return v;
};
const call = (getCtx, method, siteUrl, extra = {}) => {
  const ctx = getCtx();
  return bingCall(method, { siteUrl: site(siteUrl, ctx), ...extra }, { key: ctx.bingKey() });
};
const limitArg = z.number().int().min(1).max(500).default(50);

export function registerBingTools(server, getCtx) {
  server.registerTool(
    "bing_list_sites",
    { title: "List Bing Webmaster sites", description: "Sites verified in the Bing Webmaster Tools account that owns the API key. Use it to confirm the key works.", annotations: READ_ONLY },
    guard(() => bingCall("GetUserSites", {}, { key: getCtx().bingKey() })),
  );

  server.registerTool(
    "bing_query_stats",
    {
      title: "Bing search queries",
      description: "Queries that showed your site on Bing (also feeds Copilot and others), summed across the dates Bing returns: clicks, impressions, CTR and average position. Bing returns all data it holds, with no date filter.",
      inputSchema: { siteUrl: siteArg, limit: limitArg },
      annotations: READ_ONLY,
    },
    guard(async ({ siteUrl, limit }) => {
      const rows = await call(getCtx, "GetQueryStats", siteUrl);
      return { rowsFromBing: Array.isArray(rows) ? rows.length : 0, queries: aggregateQueryStats(Array.isArray(rows) ? rows : [], { limit: limit ?? 50 }) };
    }),
  );

  server.registerTool(
    "bing_page_stats",
    {
      title: "Bing top pages",
      description: "Pages that appeared in Bing results, with clicks, impressions and average position.",
      inputSchema: { siteUrl: siteArg, limit: limitArg },
      annotations: READ_ONLY,
    },
    guard(async ({ siteUrl, limit }) => {
      const rows = await call(getCtx, "GetPageStats", siteUrl);
      return { pages: aggregatePageStats(Array.isArray(rows) ? rows : [], { limit: limit ?? 50 }) };
    }),
  );

  server.registerTool(
    "bing_traffic_stats",
    {
      title: "Bing traffic over time",
      description:
        "Clicks and impressions from Bing search over time. Returns weekly totals for the last N weeks by default (daily rows are mostly zeros on small sites). Use it to spot drops, such as after a migration.",
      inputSchema: {
        siteUrl: siteArg,
        weeks: z.number().int().min(1).max(104).default(26).describe("How many recent weeks to return."),
        daily: z.boolean().default(false).describe("Also return the daily rows for those weeks."),
      },
      annotations: READ_ONLY,
    },
    guard(async ({ siteUrl, weeks, daily }) => {
      const all = normaliseTrafficStats(await call(getCtx, "GetRankAndTrafficStats", siteUrl));
      const recentWeeks = weeklyBuckets(all).slice(-(weeks ?? 26));
      const first = recentWeeks[0]?.weekStarting;
      const out = {
        totals: all.reduce((t, d) => ({ clicks: t.clicks + d.clicks, impressions: t.impressions + d.impressions }), { clicks: 0, impressions: 0 }),
        dataFrom: all[0]?.date,
        dataTo: all.at(-1)?.date,
        weeks: recentWeeks,
      };
      if (daily) out.days = all.filter((d) => first && d.date >= first);
      return out;
    }),
  );

  server.registerTool(
    "bing_crawl_stats",
    {
      title: "Bing crawl statistics",
      description: "How Bingbot crawled the site over time: pages crawled, crawl errors, blocked by robots.txt, and indexed counts.",
      inputSchema: { siteUrl: siteArg },
      annotations: READ_ONLY,
    },
    guard(async ({ siteUrl }) => ({ days: normaliseCrawlStats(await call(getCtx, "GetCrawlStats", siteUrl)) })),
  );

  server.registerTool(
    "bing_crawl_issues",
    {
      title: "Bing crawl issues",
      description: "Crawl problems Bing found on the site, such as 4xx and 5xx errors, redirects and blocked pages.",
      inputSchema: { siteUrl: siteArg },
      annotations: READ_ONLY,
    },
    guard(async ({ siteUrl }) => ({ issues: await call(getCtx, "GetCrawlIssues", siteUrl) })),
  );

  server.registerTool(
    "bing_link_counts",
    {
      title: "Bing inbound links",
      description: "Pages on your site that have inbound links according to Bing, with link counts.",
      inputSchema: { siteUrl: siteArg, page: z.number().int().min(0).default(0).describe("Result page, starting at 0.") },
      annotations: READ_ONLY,
    },
    guard(async ({ siteUrl, page }) => ({ links: await call(getCtx, "GetLinkCounts", siteUrl, { page: String(page ?? 0) }) })),
  );
}
