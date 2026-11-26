// Tools that need no Google credentials: Lighthouse (via PageSpeed Insights) and page/site audits.

import { z } from "zod";
import { guard, READ_ONLY } from "../util.mjs";
import { runPsi } from "../analysis/psi.mjs";
import { auditPage, auditSite } from "../analysis/audit.mjs";

import { trendingNow } from "../analysis/trends.mjs";

export function registerWebTools(server, getCtx) {
  server.registerTool(
    "trends_trending_now",
    {
      title: "Google Trends: trending now",
      description:
        "What is spiking in Google Search right now in a country (Google Trends 'Trending Now' public feed), with approximate search volume bucket and top news headlines. Use 'matching' to keep only topics related to your niche. Short-lived spikes only: it does not give historical interest for a keyword.",
      inputSchema: {
        geo: z.string().optional().describe("Country code, or several separated by commas (max 5), e.g. US or MY,SG. Defaults to TRENDS_GEO or US."),
        matching: z.array(z.string()).default([]).describe("Keep only trends whose topic or headlines contain any of these words."),
        limit: z.number().int().min(1).max(100).default(25),
      },
      annotations: READ_ONLY,
    },
    guard(({ geo, matching, limit }) => trendingNow({ geo: geo ?? (getCtx().defaults.trendsGeo || "US"), matching: matching ?? [], limit: limit ?? 25 })),
  );

  server.registerTool(
    "psi_report",
    {
      title: "Lighthouse / PageSpeed report",
      description:
        "Runs Lighthouse through the PageSpeed Insights API (no local Chrome needed). Returns performance, accessibility, best-practices and SEO scores, lab metrics (LCP, TBT, CLS), real-user field data from the Chrome UX Report when available, and the top failing audits. Takes up to a minute. Heavy pages can score very differently on mobile and desktop, so check both.",
      inputSchema: {
        url: z.string().url().describe("The full page URL to test."),
        strategy: z.enum(["mobile", "desktop"]).default("mobile"),
      },
      annotations: READ_ONLY,
    },
    guard(({ url, strategy }) => runPsi({ url, strategy: strategy ?? "mobile", apiKey: getCtx().psiKey() })),
  );

  server.registerTool(
    "seo_audit_page",
    {
      title: "Audit one page (SEO + AEO)",
      description:
        "Fetches a page and checks titles, meta descriptions, canonical, robots, headings, image alt text, internal links, Open Graph, and structured data (JSON-LD), plus answer-engine signals such as Article dates and authors and question-style headings. Returns facts and a list of findings with severity and a suggested fix.",
      inputSchema: { url: z.string().url() },
      annotations: READ_ONLY,
    },
    guard(({ url }) => auditPage(url)),
  );

  server.registerTool(
    "seo_audit_site",
    {
      title: "Audit site-level SEO + AEO",
      description:
        "Checks robots.txt (including whether AI crawlers such as GPTBot, ClaudeBot, PerplexityBot and Google-Extended are blocked), whether declared sitemaps load, and whether /llms.txt exists.",
      inputSchema: { siteUrl: z.string().url().describe("Any URL on the site; only the origin is used.") },
      annotations: READ_ONLY,
    },
    guard(({ siteUrl }) => auditSite(siteUrl)),
  );
}
