// Cloudflare tools. Optional: registered only when a Cloudflare API token is configured.
//   cf_radar_domain_rank  Radar popularity rank for any domain (works even if the site is not on Cloudflare)
//   cf_zone_traffic       Daily traffic for a site that is on Cloudflare (needs its zone ID)

import { z } from "zod";
import { guard, READ_ONLY } from "../util.mjs";
import { cfRadar, cfGraphql } from "../cloudflare.mjs";
import { normaliseDomain, parseRadarRank, zoneTrafficRequest, dailyZoneTraffic, clampDays } from "../analysis/cloudflare.mjs";

export function registerCloudflareTools(server, getCtx) {
  // Hide the tools entirely when no token is set, so users without Cloudflare never see them.
  if (!getCtx().hasCloudflare()) return;

  server.registerTool(
    "cf_radar_domain_rank",
    {
      title: "Cloudflare Radar: domain rank",
      description:
        "Cloudflare Radar's popularity rank for a domain, from traffic across Cloudflare's network. Works for any domain, including sites not on Cloudflare. Exact rank only for the top 100 domains; other domains get a bucket such as 'top 200k'. This is popularity, not a search ranking, so use it for context (is this brand or competitor large?), not as an SEO signal.",
      inputSchema: { domain: z.string().describe("Domain to look up, e.g. example.com. A full URL also works; the host is used.") },
      annotations: READ_ONLY,
    },
    guard(async ({ domain }) => {
      const d = normaliseDomain(domain);
      const token = getCtx().cloudflareToken();
      const result = await cfRadar(`/radar/ranking/domain/${encodeURIComponent(d)}`, { token });
      return parseRadarRank(result, d);
    }),
  );

  server.registerTool(
    "cf_zone_traffic",
    {
      title: "Cloudflare: your site's traffic",
      description:
        "Daily requests, visits and bytes served for a site on Cloudflare, from the Cloudflare Analytics API. Use it to check traffic and bandwidth trends alongside Search Console and GA4. Only works for sites on your Cloudflare account. Cloudflare keeps about 31 days of this data, so the window is capped at 30 days. The newest day is partial.",
      inputSchema: {
        zoneId: z.string().optional().describe("Cloudflare zone ID of the site. Defaults to CLOUDFLARE_ZONE_ID. Ask the user if you do not know it."),
        days: z.number().int().min(1).max(30).default(7).describe("How many days back to include (1-30)."),
      },
      annotations: READ_ONLY,
    },
    guard(async ({ zoneId, days }) => {
      const ctx = getCtx();
      const zone = ctx.cloudflareZone(zoneId);
      const window = clampDays(days ?? 7);
      const { query, variables, start, end } = zoneTrafficRequest({ zoneTag: zone, days: window });
      const data = await cfGraphql(query, variables, { token: ctx.cloudflareToken() });
      const rows = data?.viewer?.zones?.[0]?.httpRequestsAdaptiveGroups ?? [];
      const { daily, totals } = dailyZoneTraffic(rows);
      return {
        period: { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10), days: window },
        totals,
        daily,
        note: "Source: Cloudflare Analytics API (adaptive HTTP groups). Hourly rows summed by day. The newest day is partial.",
      };
    }),
  );
}
