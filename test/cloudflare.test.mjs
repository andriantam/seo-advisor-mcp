import { test } from "node:test";
import assert from "node:assert/strict";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { normaliseDomain, parseRadarRank, clampDays, zoneTrafficRequest, dailyZoneTraffic } from "../src/analysis/cloudflare.mjs";
import { cfRadar, cfGraphql } from "../src/cloudflare.mjs";
import { makeContext } from "../src/ctx.mjs";
import { registerCloudflareTools } from "../src/tools/cloudflare.mjs";

const fakeFetch = (status, body) => async (url, opts) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body), _url: url, _opts: opts });

test("normalises domains and rejects non-domains", () => {
  assert.equal(normaliseDomain("https://www.Example.com/blog?x=1"), "example.com");
  assert.equal(normaliseDomain("example.com:8080"), "example.com");
  assert.throws(() => normaliseDomain("not a domain"), /does not look like a domain/);
  assert.throws(() => normaliseDomain(""), /Missing domain/);
});

test("parses an exact Radar rank and a bucket-only result", () => {
  const top = parseRadarRank({ details_0: { domain: "cloudflare.com", rank: 42, bucket: "top 100", top_locations: [{ name: "US", rank: 3 }] } }, "cloudflare.com");
  assert.equal(top.rank, 42);
  assert.match(top.meaning, /not a search ranking/);
  const bucket = parseRadarRank({ details_0: { domain: "small.example", bucket: "top 200K" } }, "small.example");
  assert.equal(bucket.rank, null);
  assert.match(bucket.meaning, /top 200K/);
});

test("clamps the window to 1-30 days", () => {
  assert.equal(clampDays(0), 1);
  assert.equal(clampDays(90), 30);
  assert.equal(clampDays(undefined), 7);
});

test("builds an ISO window and sums hourly rows into days", () => {
  const now = new Date("2026-11-26T12:00:00Z");
  const { variables } = zoneTrafficRequest({ zoneTag: "abc", days: 2, now });
  assert.equal(variables.zoneTag, "abc");
  assert.equal(variables.filter.datetime_geq, "2026-11-24T12:00:00.000Z");
  assert.equal(variables.filter.datetime_lt, "2026-11-26T12:00:00.000Z");

  const out = dailyZoneTraffic([
    { count: 5, sum: { visits: 2, edgeResponseBytes: 100 }, dimensions: { datetimeHour: "2026-11-25T10:00:00Z" } },
    { count: 3, sum: { visits: 1, edgeResponseBytes: 50 }, dimensions: { datetimeHour: "2026-11-25T11:00:00Z" } },
    { count: 1, sum: { visits: 1, edgeResponseBytes: 10 }, dimensions: { datetimeHour: "2026-11-24T23:00:00Z" } },
    { count: 9 },
  ]);
  assert.deepEqual(out.daily.map((d) => d.date), ["2026-11-24", "2026-11-25"]);
  assert.deepEqual(out.daily[1], { date: "2026-11-25", requests: 8, visits: 3, bytes: 150 });
  assert.deepEqual(out.totals, { requests: 9, visits: 4, bytes: 160 });
});

test("Radar call sends the token as a bearer header and unwraps result", async () => {
  let seen;
  const res = await cfRadar("/radar/ranking/domain/x.com", {
    token: "TOK",
    fetchImpl: async (url, opts) => ((seen = { url, opts }), fakeFetch(200, { success: true, result: { details_0: { rank: 1 } } })(url, opts)),
  });
  assert.equal(seen.url, "https://api.cloudflare.com/client/v4/radar/ranking/domain/x.com");
  assert.equal(seen.opts.headers.authorization, "Bearer TOK");
  assert.deepEqual(res, { details_0: { rank: 1 } });
});

test("errors name the cause but never include the token", async () => {
  await assert.rejects(
    cfRadar("/radar/ranking/domain/x.com", { token: "SECRETTOKEN", fetchImpl: fakeFetch(403, { success: false, errors: [{ message: "Authentication error" }] }) }),
    (e) => /Authentication error/.test(e.message) && /permission/.test(e.message) && !e.message.includes("SECRETTOKEN"),
  );
  await assert.rejects(
    cfRadar("/x", { token: "SECRETTOKEN", fetchImpl: async () => { throw new Error("socket hang up SECRETTOKEN"); } }),
    (e) => !e.message.includes("SECRETTOKEN"),
  );
});

test("GraphQL returns data and surfaces query errors", async () => {
  const data = await cfGraphql("q", {}, { token: "T", fetchImpl: fakeFetch(200, { data: { viewer: {} } }) });
  assert.deepEqual(data, { viewer: {} });
  await assert.rejects(cfGraphql("q", {}, { token: "T", fetchImpl: fakeFetch(200, { errors: [{ message: "bad field" }] }) }), /bad field/);
});

test("Cloudflare tools are hidden when no token is configured", () => {
  const off = new McpServer({ name: "t", version: "0" });
  registerCloudflareTools(off, () => makeContext({}));
  assert.deepEqual(Object.keys(off._registeredTools), []);

  const on = new McpServer({ name: "t", version: "0" });
  registerCloudflareTools(on, () => makeContext({ cloudflareToken: "T", cloudflareZoneId: "Z" }));
  assert.deepEqual(Object.keys(on._registeredTools).sort(), ["cf_radar_domain_rank", "cf_zone_traffic"]);
});

test("zone lookup needs a zone ID from the argument or the connection", () => {
  const ctx = makeContext({ cloudflareToken: "T" });
  assert.throws(() => ctx.cloudflareZone(""), /No Cloudflare zone ID/);
  assert.equal(makeContext({ cloudflareToken: "T", cloudflareZoneId: "Z" }).cloudflareZone("ARG"), "ARG");
});
