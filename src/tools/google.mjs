// Search Console and GA4 tools. These need a service-account key.

import { z } from "zod";
import { guard, READ_ONLY, defaultRange } from "../util.mjs";
import { findOpportunities } from "../analysis/opportunities.mjs";

const siteArg = z
  .string()
  .optional()
  .describe("Search Console property: 'sc-domain:example.com' (Domain) or 'https://example.com/' (URL prefix). Pass it on every call; ask the user if you do not know it.");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");

/** A bare domain ("example.com") means a Domain property: "sc-domain:example.com". */
export function normalizeSite(v) {
  const t = String(v ?? "").trim();
  if (!t || /^(sc-domain:|https?:\/\/)/i.test(t)) return t;
  return `sc-domain:${t.replace(/\/.*$/, "")}`;
}
const site = (s, ctx) => {
  const v = normalizeSite(s || ctx.defaults.gscSite);
  if (!v)
    throw new Error(
      "Missing siteUrl. Ask the user which site to analyse (their domain, e.g. example.com) and pass it. The site must already be a verified Search Console property that the connected Google service account has been added to. If unsure which properties are available, call gsc_list_sites, or use the onboarding prompt.",
    );
  return v;
};
const gaId = (p, ctx) => {
  const v = String(p || ctx.defaults.gaProperty || "").replace(/^properties\//, "");
  if (!v)
    throw new Error(
      "Missing propertyId. The GA4 property is specific to each site: ask the user for the GA4 property ID of the site being analysed (numeric; Google Analytics > Admin > Property details), or call ga_list_properties to see the properties this connection can read and let the user pick. Do not guess. Remember the answer for later calls in this conversation.",
    );
  return v;
};

const hostOf = (v) => {
  const t = String(v || "");
  if (/^sc-domain:/i.test(t)) return t.slice(10).toLowerCase();
  try {
    return new URL(t).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
};

/**
 * The property this connection can actually use for what the user asked about. Users say "https://example.com/"
 * while the service account was added to the Domain property "sc-domain:example.com" (or the reverse), and
 * Search Console answers 403. Prefers an exact match, then the same host as a Domain property, then URL-prefix
 * properties on that host (www or not, https or http), then a parent domain.
 */
export function pickAccessibleSite(asked, accessible) {
  const host = hostOf(asked);
  if (!host) return null;
  const labels = host.split(".");
  const parents = labels.slice(1, -1).map((_, i) => labels.slice(i + 1).join("."));
  const candidates = [
    asked,
    `sc-domain:${host}`,
    `https://${host}/`,
    `https://www.${host}/`,
    `http://${host}/`,
    `http://www.${host}/`,
    ...parents.map((d) => `sc-domain:${d}`),
  ];
  const set = new Set(accessible);
  return candidates.find((c) => set.has(c)) ?? null;
}

const isPermissionError = (err) => /\b403\b/.test(err?.message || "") && /permission for site|not a verified|do not have|sufficient permission/i.test(err?.message || "");

/** Run a Search Console call for a site; if Google refuses that exact property, retry once on one the connection can use. */
export async function onSite(ctx, siteUrl, run) {
  const first = site(siteUrl, ctx);
  try {
    return await run(first);
  } catch (err) {
    if (!isPermissionError(err)) throw err;
    const list = await ctx.google().call("https://www.googleapis.com/webmasters/v3/sites");
    const accessible = (list.siteEntry || []).map((e) => e.siteUrl);
    const alt = pickAccessibleSite(first, accessible);
    if (!alt || alt === first) {
      throw new Error(
        `${err.message} This connection can see: ${accessible.length ? accessible.join(", ") : "no Search Console properties"}. Pass one of those as siteUrl, or add the service account's email (${ctx.google().email}) to this property under Search Console > Settings > Users and permissions.`,
      );
    }
    const out = await run(alt);
    return out && typeof out === "object" && !Array.isArray(out) ? { siteUrlUsed: alt, ...out } : out;
  }
}

const gscQuery = (ctx, siteUrl, body) =>
  onSite(ctx, siteUrl, (s) =>
    ctx.google().call(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(s)}/searchAnalytics/query`, { method: "POST", body }),
  );

export function registerGoogleTools(server, getCtx) {
  server.registerTool(
    "gsc_list_sites",
    { title: "List Search Console properties", description: "List the Search Console properties the service account can read, with permission level.", annotations: READ_ONLY },
    guard(() => getCtx().google().call("https://www.googleapis.com/webmasters/v3/sites")),
  );

  server.registerTool(
    "gsc_search_analytics",
    {
      title: "Search Console performance",
      description:
        "Search Console performance data: clicks, impressions, CTR and average position. Group by query, page, country, device, date or searchAppearance. Data lags about 2-3 days.",
      inputSchema: {
        siteUrl: siteArg,
        startDate: date,
        endDate: date,
        dimensions: z.array(z.enum(["query", "page", "country", "device", "date", "searchAppearance"])).default(["query"]),
        rowLimit: z.number().int().min(1).max(25000).default(50),
        searchType: z.enum(["web", "image", "video", "news", "discover", "googleNews"]).default("web"),
        pageContains: z.string().optional().describe("Only rows whose page URL contains this text."),
        queryContains: z.string().optional().describe("Only rows whose query contains this text."),
      },
      annotations: READ_ONLY,
    },
    guard(({ siteUrl, startDate, endDate, dimensions, rowLimit, searchType, pageContains, queryContains }) => {
      const filters = [];
      if (pageContains) filters.push({ dimension: "page", operator: "contains", expression: pageContains });
      if (queryContains) filters.push({ dimension: "query", operator: "contains", expression: queryContains });
      const body = { startDate, endDate, dimensions: dimensions ?? ["query"], rowLimit: rowLimit ?? 50, type: searchType ?? "web" };
      if (filters.length) body.dimensionFilterGroups = [{ groupType: "and", filters }];
      return gscQuery(getCtx(), siteUrl, body);
    }),
  );

  server.registerTool(
    "seo_find_opportunities",
    {
      title: "Find SEO opportunities",
      description:
        "Analyses Search Console query+page data and returns prioritised gaps: striking-distance queries (rank 4-20), low-CTR results, zero-click queries and keyword cannibalisation, each with an estimate of clicks to gain. Defaults to the last 28 days.",
      inputSchema: {
        siteUrl: siteArg,
        startDate: date.optional(),
        endDate: date.optional(),
        minImpressions: z.number().int().min(1).default(50).describe("Ignore rows with fewer impressions than this."),
        top: z.number().int().min(1).max(50).default(15).describe("Max items per list."),
        searchType: z.enum(["web", "image", "video", "news", "discover", "googleNews"]).default("web"),
      },
      annotations: READ_ONLY,
    },
    guard(async ({ siteUrl, startDate, endDate, minImpressions, top, searchType }) => {
      const range = defaultRange();
      const body = {
        startDate: startDate || range.startDate,
        endDate: endDate || range.endDate,
        dimensions: ["query", "page"],
        rowLimit: 5000,
        type: searchType ?? "web",
      };
      const data = await gscQuery(getCtx(), siteUrl, body);
      const result = findOpportunities(data.rows || [], { minImpressions: minImpressions ?? 50, top: top ?? 15 });
      return { period: { startDate: body.startDate, endDate: body.endDate }, ...result };
    }),
  );

  server.registerTool(
    "gsc_list_sitemaps",
    { title: "List sitemaps", description: "Sitemaps submitted for a Search Console property, with last download time, errors and warnings.", inputSchema: { siteUrl: siteArg }, annotations: READ_ONLY },
    guard(({ siteUrl }) => onSite(getCtx(), siteUrl, (s) => getCtx().google().call(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(s)}/sitemaps`))),
  );

  server.registerTool(
    "gsc_inspect_url",
    {
      title: "Inspect URL index status",
      description: "URL Inspection: is a URL indexed, which canonical Google chose, last crawl time, mobile usability and rich results. About 2,000 per day per property.",
      inputSchema: { siteUrl: siteArg, inspectionUrl: z.string().url().describe("Full page URL. Must belong to the property.") },
      annotations: READ_ONLY,
    },
    guard(({ siteUrl, inspectionUrl }) =>
      onSite(getCtx(), siteUrl || getCtx().defaults.gscSite || inspectionUrl, (s) =>
        getCtx().google().call("https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", { method: "POST", body: { inspectionUrl, siteUrl: s } }),
      ),
    ),
  );

  server.registerTool(
    "ga_run_report",
    {
      title: "GA4 report",
      description:
        "Google Analytics 4 report. Example: metrics ['sessions','engagementRate','averageSessionDuration'] with dimensions ['deviceCategory'] to compare mobile and desktop, or ['landingPage'] for per-page engagement. Names are GA4 Data API names.",
      inputSchema: {
        propertyId: z.string().optional().describe("GA4 property id (digits) of the site being analysed. Ask the user if you do not know it, or use ga_list_properties."),
        startDate: z.string().default("28daysAgo").describe("YYYY-MM-DD, or 'NdaysAgo', 'yesterday', 'today'."),
        endDate: z.string().default("yesterday"),
        metrics: z.array(z.string()).min(1).default(["sessions", "engagementRate"]),
        dimensions: z.array(z.string()).default([]),
        limit: z.number().int().min(1).max(10000).default(50),
        orderByMetric: z.string().optional().describe("Metric to sort by, descending."),
      },
      annotations: READ_ONLY,
    },
    guard(({ propertyId, startDate, endDate, metrics, dimensions, limit, orderByMetric }) => {
      const body = {
        dateRanges: [{ startDate: startDate ?? "28daysAgo", endDate: endDate ?? "yesterday" }],
        metrics: (metrics ?? ["sessions", "engagementRate"]).map((name) => ({ name })),
        dimensions: (dimensions ?? []).map((name) => ({ name })),
        limit: String(limit ?? 50),
      };
      if (orderByMetric) body.orderBys = [{ metric: { metricName: orderByMetric }, desc: true }];
      return getCtx().google().call(`https://analyticsdata.googleapis.com/v1beta/properties/${gaId(propertyId, getCtx())}:runReport`, { method: "POST", body });
    }),
  );

  server.registerTool(
    "ga_realtime",
    {
      title: "GA4 realtime",
      description: "GA4 realtime report (last 30 minutes). Useful to confirm the tracking tag is firing.",
      inputSchema: { propertyId: z.string().optional(), metrics: z.array(z.string()).default(["activeUsers"]), dimensions: z.array(z.string()).default(["unifiedScreenName"]) },
      annotations: READ_ONLY,
    },
    guard(({ propertyId, metrics, dimensions }) =>
      getCtx().google().call(`https://analyticsdata.googleapis.com/v1beta/properties/${gaId(propertyId, getCtx())}:runRealtimeReport`, {
        method: "POST",
        body: {
          metrics: (metrics ?? ["activeUsers"]).map((name) => ({ name })),
          dimensions: (dimensions ?? ["unifiedScreenName"]).map((name) => ({ name })),
        },
      }),
    ),
  );

  server.registerTool(
    "ga_list_properties",
    {
      title: "List GA4 properties",
      description:
        "Lists the Google Analytics 4 accounts and properties (name and numeric ID) that the connected Google service account can read. Use it to help the user find the GA4 property ID for a site. Needs the Google Analytics Admin API enabled in the same Google Cloud project.",
      annotations: READ_ONLY,
    },
    guard(async () => {
      const data = await getCtx().google().call("https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200");
      return {
        accounts: (data.accountSummaries || []).map((a) => ({
          account: a.displayName,
          properties: (a.propertySummaries || []).map((p) => ({ propertyId: String(p.property || "").replace(/^properties\//, ""), name: p.displayName })),
        })),
      };
    }),
  );
}
