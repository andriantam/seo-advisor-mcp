import { test } from "node:test";
import assert from "node:assert/strict";
import { findOpportunities, expectedCtr } from "../src/analysis/opportunities.mjs";

const row = (query, page, clicks, impressions, position) => ({
  keys: [query, page],
  clicks,
  impressions,
  ctr: impressions ? clicks / impressions : 0,
  position,
});

test("expectedCtr falls as position worsens", () => {
  assert.ok(expectedCtr(1) > expectedCtr(3));
  assert.ok(expectedCtr(3) > expectedCtr(8));
  assert.ok(expectedCtr(8) > expectedCtr(30));
});

test("finds striking-distance queries and estimates gain", () => {
  const out = findOpportunities([row("acme widget build", "/a", 5, 1000, 9), row("rare", "/b", 0, 10, 8)], { minImpressions: 50 });
  assert.equal(out.strikingDistance.length, 1);
  assert.equal(out.strikingDistance[0].query, "acme widget build");
  assert.equal(out.strikingDistance[0].extraClicksIfTop3, 95); // 1000 * 10% - 5
});

test("flags low CTR on page 1", () => {
  const out = findOpportunities([row("night photography tips", "/p", 2, 2000, 3)], { minImpressions: 50 });
  assert.equal(out.lowCtr.length, 1);
  assert.ok(out.lowCtr[0].extraClicksAtExpectedCtr > 100);
});

test("does not flag healthy CTR", () => {
  const out = findOpportunities([row("good", "/p", 300, 2000, 3)], { minImpressions: 50 });
  assert.equal(out.lowCtr.length, 0);
});

test("detects cannibalisation across pages", () => {
  const out = findOpportunities([row("widget review", "/a", 5, 400, 6), row("widget review", "/b", 4, 300, 8), row("widget review", "/c", 0, 10, 40)], { minImpressions: 50 });
  assert.equal(out.cannibalisation.length, 1);
  assert.equal(out.cannibalisation[0].pages.length, 2);
});

test("lists zero-click queries only above the threshold", () => {
  const out = findOpportunities([row("shown a lot", "/p", 0, 500, 12), row("shown little", "/q", 0, 60, 12)], { minImpressions: 50 });
  assert.deepEqual(out.zeroClick.map((r) => r.query), ["shown a lot"]);
});

test("ignores rows without query+page keys", () => {
  const out = findOpportunities([{ keys: ["only-one"], clicks: 1, impressions: 100, ctr: 0.01, position: 5 }]);
  assert.equal(out.summary.rowsAnalysed, 0);
});
