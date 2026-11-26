// Pure functions for Cloudflare data: domain normalising, Radar rank parsing, zone traffic query and daily rollup.
// The Radar response shape and the zone GraphQL field names were taken from Cloudflare's docs; check them
// against a live token before relying on them (see docs/cloudflare-setup.md).

const MAX_DAYS = 30; // the adaptive datasets keep at least 31 days on every plan

/** "https://www.Example.com/page" -> "example.com". Radar ranks registrable domains, so www is dropped. */
export function normaliseDomain(input) {
  let s = String(input ?? "").trim().toLowerCase();
  if (!s) throw new Error("Missing domain. Pass a domain such as example.com.");
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, "").split(/[/?#]/)[0].replace(/:\d+$/, "").replace(/^www\./, "");
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s)) throw new Error(`"${input}" does not look like a domain name. Pass something like example.com.`);
  return s;
}

/** Parse a Radar domain ranking result. Ranks are exact only for the top 100; otherwise Radar gives a bucket. */
export function parseRadarRank(result = {}, domain) {
  const d = result.details_0 ?? result;
  const rank = typeof d.rank === "number" ? d.rank : null;
  return {
    domain: d.domain ?? domain,
    rank,
    bucket: d.bucket ?? null,
    topLocations: (Array.isArray(d.top_locations) ? d.top_locations : []).slice(0, 10),
    meaning:
      rank !== null
        ? `Ranked #${rank} by Cloudflare Radar traffic (popularity across Cloudflare's network). This is not a search ranking.`
        : `Not in Radar's exact top 100. Bucket: ${d.bucket ?? "unknown"}. Radar measures popularity across Cloudflare's network, not search rankings.`,
  };
}

/** Clamp a day count to 1..MAX_DAYS. */
export function clampDays(days) {
  const n = days == null ? NaN : Math.floor(Number(days));
  if (!Number.isFinite(n)) return 7;
  return Math.min(MAX_DAYS, Math.max(1, n));
}

/** Build the GraphQL query and variables for hourly zone totals over the last `days` days. */
export function zoneTrafficRequest({ zoneTag, days = 7, now = new Date() }) {
  const end = now;
  const start = new Date(end.getTime() - clampDays(days) * 86400000);
  const query = `query ZoneTraffic($zoneTag: string, $filter: filter) {
  viewer {
    zones(filter: { zoneTag: $zoneTag }) {
      httpRequestsAdaptiveGroups(limit: 1000, filter: $filter) {
        count
        sum { visits edgeResponseBytes }
        dimensions { datetimeHour }
      }
    }
  }
}`;
  const variables = {
    zoneTag,
    filter: { datetime_geq: start.toISOString(), datetime_lt: end.toISOString() },
  };
  return { query, variables, start, end };
}

/** Sum hourly zone rows into daily totals, oldest first, plus period totals. */
export function dailyZoneTraffic(rows = []) {
  const days = new Map();
  for (const row of rows) {
    const hour = row?.dimensions?.datetimeHour;
    if (!hour) continue;
    const date = String(hour).slice(0, 10);
    const d = days.get(date) ?? { date, requests: 0, visits: 0, bytes: 0 };
    d.requests += Number(row.count) || 0;
    d.visits += Number(row.sum?.visits) || 0;
    d.bytes += Number(row.sum?.edgeResponseBytes) || 0;
    days.set(date, d);
  }
  const daily = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
  const totals = daily.reduce((t, d) => ({ requests: t.requests + d.requests, visits: t.visits + d.visits, bytes: t.bytes + d.bytes }), { requests: 0, visits: 0, bytes: 0 });
  return { daily, totals };
}
