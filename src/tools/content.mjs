// Competitor content gaps, and a local folder of drafts for you to review. Nothing here publishes anywhere.

import { z } from "zod";
import { guard, READ_ONLY } from "../util.mjs";
import { competitorGaps } from "../analysis/competitor.mjs";
import { saveDraft, listDrafts, draftsDir } from "../analysis/drafts.mjs";

// Writes one file in the drafts folder; never deletes or overwrites approved work.
const LOCAL_WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

export function registerContentTools(server, getCtx, { drafts = true } = {}) {
  server.registerTool(
    "seo_competitor_gaps",
    {
      title: "Competitor content gaps",
      description:
        "Reads a competitor's public sitemap and their newest article pages, then compares their topics with your own site's pages and any Search Console queries you pass in. Returns the topics they cover that you do not (gaps), partly covered ones, and what you already cover. It cannot see their traffic or search volume, so judge demand separately. Tip: any site's /sitemap.xml lists every page and when it last changed.",
      inputSchema: {
        competitorUrl: z.string().describe("The competitor's site, e.g. https://competitor.com"),
        ownSiteUrl: z.string().optional().describe("Your site, e.g. https://example.com. Used to see what you already cover. Pass it so topics you already cover are not reported as gaps."),
        ownQueries: z.array(z.string()).default([]).describe("Queries you already appear for in Search Console (from gsc_search_analytics), so topics you rank for count as covered."),
        maxPages: z.number().int().min(5).max(100).default(40).describe("How many of the competitor's newest article pages to read."),
      },
      annotations: READ_ONLY,
    },
    guard(({ competitorUrl, ownSiteUrl, ownQueries, maxPages }) =>
      competitorGaps({ competitor: competitorUrl, ownSite: ownSiteUrl || getCtx().defaults.bingSite || "", ownQueries: ownQueries ?? [], maxPages: maxPages ?? 40 }),
    ),
  );

  if (!drafts) return;

  server.registerTool(
    "content_save_draft",
    {
      title: "Save an article draft",
      description:
        "Saves a draft article as a Markdown file in your local drafts folder (SEO_DRAFTS_DIR, default ~/seo-advisor-drafts) with status: draft. It does NOT publish anything. Include publishOn to place it on the content calendar. It will not overwrite a file you have changed to another status.",
      inputSchema: {
        title: z.string().describe("The article title."),
        body: z.string().describe("The article in Markdown. Mark places the author must add real experience, photos or numbers with [ADD ...]."),
        slug: z.string().optional().describe("File name; defaults to the title."),
        targetQuery: z.string().optional().describe("The search this article aims to answer."),
        publishOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Suggested publish date, YYYY-MM-DD."),
        sourceUrl: z.string().optional().describe("The competitor page that inspired the topic, for reference only."),
        notes: z.string().optional().describe("Notes for the reviewer."),
      },
      annotations: LOCAL_WRITE,
    },
    guard((args) => saveDraft(args)),
  );

  server.registerTool(
    "content_list_drafts",
    {
      title: "Content calendar (drafts)",
      description: "Lists the drafts in your local drafts folder as a calendar: soonest publishOn first, with status, target query and word count.",
      annotations: { ...LOCAL_WRITE, readOnlyHint: true, idempotentHint: true },
    },
    guard(() => ({ folder: draftsDir(), drafts: listDrafts() })),
  );
}
