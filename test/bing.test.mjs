import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBingDate, aggregateQueryStats, aggregatePageStats, weeklyBuckets, normaliseTrafficStats, bingCall, getBingKey } from "../src/analysis/bing.mjs";

test("parses .NET style dates", () => {
  assert.equal(parseBingDate("/Date(1700000000000)/"), "2023-11-14");
  assert.equal(parseBingDate("/Date(1700000000000-0700)/"), "2023-11-14");
  assert.equal(parseBingDate(null), null);
});

test("aggregates query rows across dates with impression-weighted position", () => {
  const out = aggregateQueryStats([
    { Query: "widget", Clicks: 1, Impressions: 10, AvgImpressionPosition: 4 },
    { Query: "widget", Clicks: 0, Impressions: 30, AvgImpressionPosition: 8 },
    { Query: "other", Clicks: 2, Impressions: 5, AvgImpressionPosition: 2 },
    { Impressions: 99 },
  ]);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], { query: "widget", clicks: 1, impressions: 40, ctr: 2.5, avgPosition: 7 });
});

test("sorts traffic by date", () => {
  const out = normaliseTrafficStats([
    { Date: "/Date(1700086400000)/", Clicks: 2, Impressions: 20 },
    { Date: "/Date(1700000000000)/", Clicks: 1, Impressions: 10 },
  ]);
  assert.deepEqual(out.map((r) => r.date), ["2023-11-14", "2023-11-15"]);
});

test("unwraps the d node and keeps the key out of errors", async () => {
  const ok = await bingCall("GetUserSites", {}, { key: "SECRETKEY", fetchImpl: async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ d: [{ Url: "https://x.com/" }] }) }) });
  assert.deepEqual(ok, [{ Url: "https://x.com/" }]);

  await assert.rejects(
    bingCall("GetUserSites", {}, { key: "SECRETKEY", fetchImpl: async () => ({ ok: false, status: 403, text: async () => JSON.stringify({ Message: "Not authorised" }) }) }),
    (e) => /Not authorised/.test(e.message) && !e.message.includes("SECRETKEY"),
  );
  await assert.rejects(
    bingCall("GetUserSites", {}, { key: "SECRETKEY", fetchImpl: async () => { throw new Error("connect failed https://ssl.bing.com/...apikey=SECRETKEY"); } }),
    (e) => !e.message.includes("SECRETKEY"),
  );
});

test("requires a configured key", () => {
  assert.throws(() => getBingKey({}), /not configured/);
  assert.equal(getBingKey({ BING_WEBMASTER_API_KEY: " abc " }), "abc");
});

test("aggregates page rows across dates", () => {
  const out = aggregatePageStats([
    { Query: "https://x.com/a", Clicks: 2, Impressions: 40, AvgImpressionPosition: 6 },
    { Query: "https://x.com/a", Clicks: 1, Impressions: 10, AvgImpressionPosition: 11 },
    { Query: "https://x.com/b", Clicks: 0, Impressions: 5, AvgImpressionPosition: 3 },
  ]);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], { page: "https://x.com/a", clicks: 3, impressions: 50, avgPosition: 7 });
});

test("groups days into Monday-start weeks", () => {
  const out = weeklyBuckets([
    { date: "2026-11-02", clicks: 1, impressions: 10 }, // Monday
    { date: "2026-11-08", clicks: 2, impressions: 20 }, // Sunday, same week
    { date: "2026-11-09", clicks: 4, impressions: 40 }, // next Monday
  ]);
  assert.deepEqual(out, [
    { weekStarting: "2026-11-02", clicks: 3, impressions: 30 },
    { weekStarting: "2026-11-09", clicks: 4, impressions: 40 },
  ]);
});

test("bingCall retries ThrottleIP, then succeeds", async () => {
  let n = 0;
  const waits = [];
  const fetchImpl = async () => (++n < 3 ? { ok: false, status: 400, text: async () => JSON.stringify({ Message: "ERROR!!! ThrottleIP" }) } : { ok: true, status: 200, text: async () => JSON.stringify({ d: [1] }) });
  const out = await bingCall("GetUserSites", {}, { key: "K", fetchImpl, sleep: async (ms) => waits.push(ms) });
  assert.deepEqual(out, [1]);
  assert.equal(n, 3);
  assert.equal(waits.length, 2);
});

test("bingCall gives a clear, flagged error when still throttled, without the key", async () => {
  const fetchImpl = async () => ({ ok: false, status: 400, text: async () => JSON.stringify({ Message: "ERROR!!! ThrottleIP" }) });
  await assert.rejects(
    bingCall("GetUserSites", {}, { key: "SECRETKEY", fetchImpl, sleep: async () => {} }),
    (e) => e.throttled === true && /not a problem with your key/.test(e.message) && !e.message.includes("SECRETKEY"),
  );
});

test("bingCall does not retry other errors", async () => {
  let n = 0;
  const fetchImpl = async () => (n++, { ok: false, status: 400, text: async () => JSON.stringify({ Message: "ERROR!!! InvalidApiKey" }) });
  await assert.rejects(bingCall("GetUserSites", {}, { key: "K", fetchImpl, sleep: async () => {} }), /InvalidApiKey/);
  assert.equal(n, 1);
});
