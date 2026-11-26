// The "advisor" layer: server-level instructions plus ready-made workflows (MCP prompts).
// Tools return data; this is what tells the model how to think about it.

import { z } from "zod";

const BASE = `You are an SEO, AEO (answer-engine optimisation) and site-performance advisor for the user's website.

Principles:
- Ground every claim in data from the tools. Say which tool a number came from. If a tool is not configured or a source lacks data, say so instead of guessing.
- Separate what the data shows from what you infer. Never promise rankings or traffic; give likely direction and rough effort.
- Prioritise. Rank recommendations by (impact x confidence) / effort, and show the top 5 before the long tail.
- Be specific: name the exact page, query, tag or setting, and write the replacement text (title, meta description, heading) where useful.
- Prefer niche, winnable queries over broad head terms a small site cannot win. Say so when a goal is unrealistic.
- Performance: a fast page helps Core Web Vitals (a ranking signal) and keeps visitors. Compare mobile and desktop, and lab (Lighthouse) with field data.
- AEO: answer engines cite pages that answer a question directly, show clear authorship and dates, have structured data, and are not blocked from AI search crawlers. Treat AEO advice as emerging and less proven than classic SEO.
- Recommend only changes that help real users. Do not suggest keyword stuffing, hidden text, purchased links or other spam.

Tools: gsc_* (Search Console), ga_* (Google Analytics 4), psi_report (Lighthouse), seo_find_opportunities (gap analysis), seo_audit_page and seo_audit_site (on-page, AEO, robots, AI crawlers), trends_trending_now (what is spiking in Google Search now), bing_* (Bing Webmaster Tools: queries, pages, traffic, crawl stats and issues, links), seo_competitor_gaps (what a competitor covers that you do not), @@DRAFT_TOOLS@@. Compare Bing with Google when both are available.

Content rules: nothing is published automatically. @@DRAFT_RULE@@ Never copy a competitor's wording; take the topic, not the text. Write from the owner's real experience: leave clearly marked [ADD ...] placeholders for photos, first-hand details and numbers you cannot know, and never invent them. Do not mass-produce thin articles; fewer, better pages win.`;

const SITE_RULES = `

Sites and IDs: every tool that reads site data takes the site as an argument. Ask the user which site (domain) to analyse if you do not know, and remember it for the conversation. The GA4 property ID belongs to a specific site: ask the user for it (or call ga_list_properties and let them pick) the first time you analyse that site, and reuse it afterwards. Never guess an ID. Search Console and Bing only return data for sites that are already added and verified in the account the connection uses; if a call says a site is not found or access is denied, walk the user through the onboarding prompt instead of retrying.`;

export function instructions({ remote = false } = {}) {
  const base = BASE.replace(
    "@@DRAFT_TOOLS@@",
    remote ? "article drafts are written in the chat (there is no saving tool)" : "content_save_draft and content_list_drafts (a local folder of drafts and a content calendar)",
  ).replace(
    "@@DRAFT_RULE@@",
    remote ? "Write drafts in the chat for the owner to review and copy; nothing is stored by this server." : "Drafts are saved for the owner to review.",
  );
  return base + (remote ? SITE_RULES : "");
}

const text = (t) => ({ messages: [{ role: "user", content: { type: "text", text: t } }] });

export function registerPrompts(server) {
  server.registerPrompt(
    "onboarding",
    {
      title: "Set up a site: verify it and connect it",
      description: "Walks through adding and verifying a domain in Search Console, GA4 and Bing so the tools can read its data.",
      argsSchema: { siteUrl: z.string().optional().describe("The site's domain, e.g. example.com") },
    },
    ({ siteUrl }) =>
      text(`Help me get ${siteUrl || "my site"} ready for the SEO tools. First call gsc_list_sites, ga_list_properties and bing_list_sites (skip any that report they are not set up) to see what is already connected, and tell me what is working and what is missing for this site. Then guide me through only the missing steps, one at a time, in plain language:

1. Search Console: the domain must be added as a property and verified (Domain property, verified with a DNS TXT record at the domain registrar; or a URL-prefix property verified with an HTML file or tag). Then the Google service-account email (shown in the tool error or in the key file as client_email) must be added under Settings > Users and permissions.
2. GA4: add the same service-account email under Admin > Property access management with the Viewer role, then give me the numeric property ID (Admin > Property details) or find it with ga_list_properties.
3. Google Cloud: the Search Console API, Google Analytics Data API and Google Analytics Admin API must be enabled in the project that owns the service account.
4. Bing: add the site in Bing Webmaster Tools (importing from Search Console is the quickest way), verify it, and generate an API key under Settings > API access.
5. PageSpeed: an optional free API key from Google Cloud avoids rate limits.

After each step, re-run the matching list tool to confirm it worked. Never ask me to paste secrets into this chat; keys are entered on the connection setup page only. When everything is connected, summarise which property or site ID belongs to ${siteUrl || "this site"} so we can reuse them.`),
  );

  server.registerPrompt(
    "seo_health_check",
    {
      title: "Full SEO, AEO and performance health check",
      description: "Runs every available tool and returns a prioritised list of gaps and fixes.",
      argsSchema: { siteUrl: z.string().describe("Home page URL, e.g. https://example.com") },
    },
    ({ siteUrl }) =>
      text(`Run a full health check on ${siteUrl}.

1. seo_audit_site on the site, then seo_audit_page on the home page and 2-3 other important pages.
2. psi_report for the home page on mobile and on desktop.
3. If Search Console is configured: seo_find_opportunities, and gsc_list_sitemaps. If GA4 is configured: ga_run_report for engagementRate and sessions by deviceCategory, and by landingPage.
4. Tell me which sources were unavailable.

Then write a report: (a) a one-paragraph verdict, (b) the top 5 fixes ranked by impact over effort with the exact change to make, (c) quick wins under 30 minutes, (d) bigger projects, (e) what to measure next time to confirm each fix worked.`),
  );

  server.registerPrompt(
    "find_traffic_opportunities",
    {
      title: "Find organic traffic opportunities",
      description: "Uses Search Console data to find queries and pages where small changes could win clicks.",
      argsSchema: { siteUrl: z.string().optional().describe("Search Console property; defaults to GSC_SITE_URL") },
    },
    ({ siteUrl }) =>
      text(`Run seo_find_opportunities${siteUrl ? ` for ${siteUrl}` : ""}. For the top items in each list, explain the likely cause and the concrete fix: rewritten title and meta description for low-CTR results, content or internal-link changes for striking-distance queries, and which page should win for each cannibalised query (and how to consolidate). Estimate the click gain using the tool's numbers and flag where data is thin.`),
  );

  server.registerPrompt(
    "content_ideas_from_trends",
    {
      title: "Timely content ideas from trends",
      description: "Combines what is trending now with your own Search Console data to suggest content worth writing.",
      argsSchema: {
        niche: z.string().describe("Your topics, comma separated, e.g. 'cars, photography'"),
        geo: z.string().optional().describe("Country code, e.g. SG"),
      },
    },
    ({ niche, geo }) =>
      text(`Suggest timely content for a site about: ${niche}.

1. Run trends_trending_now${geo ? ` for ${geo}` : ""} with matching set to the niche words, and once more without a filter to catch adjacent topics.
2. If Search Console is configured, run seo_find_opportunities and note which of my existing pages already relate to a trend.
3. Recommend up to 5 ideas. For each: the angle that fits my site, the target query, whether it updates an existing page or needs a new one, and how soon it should publish. Be honest that Trending Now shows short spikes, so separate quick news-style posts from evergreen pieces worth building. If nothing in the feed fits my niche, say so instead of forcing a link.`),
  );

  server.registerPrompt(
    "competitor_content_plan",
    {
      title: "Competitor content plan with drafts",
      description: "Finds topics a competitor covers that you do not, builds a content calendar, and saves reviewable drafts. Publishes nothing.",
      argsSchema: {
        competitorUrl: z.string().describe("The competitor's site, e.g. https://competitor.com"),
        ownSiteUrl: z.string().optional().describe("Your site, e.g. https://example.com"),
        count: z.string().optional().describe("How many articles to plan, default 5"),
      },
    },
    ({ competitorUrl, ownSiteUrl, count }) =>
      text(`Build a content plan from ${competitorUrl}${ownSiteUrl ? ` for ${ownSiteUrl}` : ""}.

1. If Search Console is configured, run gsc_search_analytics (dimension query, 90 days, a few hundred rows) and keep the query strings.
2. Run seo_competitor_gaps with those queries as ownQueries.
3. From the gaps, pick the ${count || "5"} best fits for this site: topics the owner can write about from real experience, with a clear question to answer. Skip topics that would need expertise or products the owner does not have. Where useful, check trends_trending_now or bing_query_stats for signs of demand, and say plainly that you could not measure search volume.
4. Make a calendar: one article per week starting next Monday, each with the target query, the angle that makes it different from the competitor's page, the headings, and what first-hand detail only the owner can add.
5. For each, run content_save_draft with publishOn set. Write the draft in the owner's voice with direct answers near the top, question-style headings where natural, and [ADD ...] placeholders for photos, prices and personal experience. Never copy the competitor's text and never invent facts.
6. Finish with content_list_drafts and tell me the folder. Say clearly that nothing has been published and that each draft needs my review.`),
  );

  server.registerPrompt(
    "aeo_check",
    {
      title: "Answer-engine (AEO) readiness check",
      description: "Checks whether AI search and answer engines can find, trust and cite the site.",
      argsSchema: { url: z.string().describe("A page URL, ideally an article") },
    },
    ({ url }) =>
      text(`Assess AEO readiness for ${url}. Run seo_audit_site and seo_audit_page. Report on: AI crawler access in robots.txt (distinguish search bots from training bots), structured data and entity clarity (author, organisation, dates), whether the page answers a clear question directly near the top, headings phrased as questions, and llms.txt. Be honest that AEO is newer and less measurable than SEO. Give the 5 most valuable changes, with sample wording where it helps.`),
  );

  server.registerPrompt(
    "performance_vs_engagement",
    {
      title: "Does page speed hurt engagement?",
      description: "Compares Lighthouse results with GA4 engagement by device to see if heavy pages drive visitors away.",
      argsSchema: { url: z.string().describe("The page to test"), propertyId: z.string().optional() },
    },
    ({ url, propertyId }) =>
      text(`Find out whether performance is hurting engagement on ${url}. Run psi_report for mobile and desktop. Then ga_run_report${propertyId ? ` (property ${propertyId})` : ""} for engagementRate, averageSessionDuration and sessions by deviceCategory, and for the landing page ${url} specifically. Say whether mobile engagement lags desktop, whether that lines up with the Lighthouse findings, and how confident you are given the sample size. If GA4 data is too recent or sparse to conclude, say so and give the earliest date a conclusion is reasonable. Recommend the highest-impact performance fixes.`),
  );
}
