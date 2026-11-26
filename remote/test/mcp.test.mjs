import test from "node:test";
import assert from "node:assert/strict";
import { buildServer, checkLimits, HEAVY_TOOLS } from "../src/mcp.mjs";

test("remote server exposes the scanning/analytics tools and no draft-saving tools", () => {
  const server = buildServer({});
  const names = Object.keys(server._registeredTools);
  for (const n of ["gsc_search_analytics", "ga_run_report", "ga_list_properties", "bing_query_stats", "psi_report", "seo_audit_site", "seo_competitor_gaps", "trends_trending_now"])
    assert.ok(names.includes(n), n);
  assert.ok(!names.includes("content_save_draft"));
  assert.ok(!names.includes("content_list_drafts"));
});

const limiter = (allow) => ({ calls: [], async limit(o) { this.calls.push(o.key); return { success: allow }; } });
const call = (name, id = 1) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name } });

test("heavy tools use the heavy limiter, others the normal one, keyed by user", async () => {
  const env = { TOOL_LIMITER: limiter(true), HEAVY_LIMITER: limiter(true) };
  assert.equal(await checkLimits(env, "u1", [call("psi_report"), call("gsc_list_sites")]), null);
  assert.deepEqual(env.HEAVY_LIMITER.calls, ["u1"]);
  assert.deepEqual(env.TOOL_LIMITER.calls, ["u1"]);
  assert.ok(HEAVY_TOOLS.has("seo_competitor_gaps"));
});

test("over the limit returns a plain tool error, not a crash", async () => {
  const res = await checkLimits({ TOOL_LIMITER: limiter(false) }, "u1", [call("gsc_list_sites", 7)]);
  const j = await res.json();
  assert.equal(j.id, 7);
  assert.equal(j.result.isError, true);
  assert.match(j.result.content[0].text, /Rate limit/);
});

test("non-tool messages and a missing limiter binding are not limited", async () => {
  assert.equal(await checkLimits({}, "u1", [call("psi_report")]), null);
  assert.equal(await checkLimits({ TOOL_LIMITER: limiter(false) }, "u1", [{ jsonrpc: "2.0", id: 1, method: "tools/list" }]), null);
});
