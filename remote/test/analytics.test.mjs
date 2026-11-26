import test from "node:test";
import assert from "node:assert/strict";
import { analyticsEnabled, createAnalytics, hashId, sanitize, analyticsFor } from "../src/analytics.mjs";

const SECRET = "0123456789abcdef-test-secret";

test("off unless ANALYTICS is exactly on", () => {
  assert.equal(analyticsEnabled({}), false);
  assert.equal(analyticsEnabled({ ANALYTICS: "off" }), false);
  assert.equal(analyticsEnabled({ ANALYTICS: "yes" }), false);
  assert.equal(analyticsEnabled({ ANALYTICS: " ON " }), true);
});

test("disabled or without a sink: nothing is recorded, no secret needed", async () => {
  const sink = [];
  await createAnalytics({ enabled: false, secret: SECRET, sink: () => sink.push(1) }).track({ event: "tool_call", tool: "psi_report" });
  await createAnalytics({ enabled: true, secret: SECRET, sink: null }).track({ event: "tool_call", tool: "psi_report" });
  assert.equal(sink.length, 0);
  assert.equal(analyticsFor({ ANALYTICS: "off" }).enabled, false);
  assert.equal(analyticsFor({}).enabled, false);
});

test("on without a usable secret is refused", () => {
  assert.throws(() => createAnalytics({ enabled: true, secret: "short", sink: () => {} }), /ANALYTICS_SECRET/);
  assert.equal(analyticsFor({ ANALYTICS: "on", ANALYTICS_ENGINE: { writeDataPoint() {} } }).enabled, false); // misconfigured: off, service keeps working
});

test("only whitelisted, well-formed fields are kept", () => {
  assert.deepEqual(
    sanitize({ event: "tool_call", tool: "psi_report", outcome: "ok", durationMs: 12.6, country: "SG", siteUrl: "https://secret.example", query: "my private query", apiKey: "K" }),
    { event: "tool_call", tool: "psi_report", outcome: "ok", errorKind: "", country: "SG", durationMs: 13 },
  );
  assert.equal(sanitize({ event: "something_else" }), null);
  assert.equal(sanitize({ event: "tool_call", tool: "https://x.com/?apikey=1" }).tool, "");
  assert.equal(sanitize({ event: "tool_call", country: "singapore" }).country, "");
  assert.equal(sanitize({ event: "tool_call", durationMs: -5 }).durationMs, 0);
});

test("writes blobs, doubles and a hashed index, never the raw connection ID or inputs", async () => {
  const points = [];
  const t = createAnalytics({ enabled: true, secret: SECRET, sink: (p) => points.push(p) });
  await t.track({ event: "connection_created", connectionId: "RAW-CONNECTION-ID", country: "MY" });
  await t.track({ event: "tool_call", tool: "gsc_search_analytics", outcome: "error", errorKind: "forbidden", durationMs: 40, connectionId: "RAW-CONNECTION-ID" });
  assert.equal(points.length, 2);
  assert.deepEqual(points[0].blobs, ["connection_created", "", "", "", "MY"]);
  assert.deepEqual(points[1].blobs, ["tool_call", "gsc_search_analytics", "error", "forbidden", ""]);
  assert.deepEqual(points[1].doubles, [40, 1]);
  assert.equal(points[1].indexes[0], await hashId("RAW-CONNECTION-ID", SECRET));
  assert.equal(points[1].indexes[0].length, 64);
  assert.ok(!JSON.stringify(points).includes("RAW-CONNECTION-ID"));
});

test("hash is stable for one secret and different for another", async () => {
  assert.equal(await hashId("abc", SECRET), await hashId("abc", SECRET));
  assert.notEqual(await hashId("abc", SECRET), await hashId("abc", "another-secret-value-123"));
});
