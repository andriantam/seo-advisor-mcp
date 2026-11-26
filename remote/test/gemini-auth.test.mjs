import test from "node:test";
import assert from "node:assert/strict";
import { getPublicMcpAuth } from "../src/auth-gemini.mjs";
import { createWorker, withProps } from "../src/router.mjs";
import { mcpHandler } from "../src/mcp.mjs";

test("returns null for standard Claude/unauthenticated requests on /mcp", () => {
  const req = new Request("https://example.com/mcp", {
    headers: { authorization: "Bearer oauth-token-123" },
  });
  assert.equal(getPublicMcpAuth(req), null);
});

test("no headers on /mcp is not an agent request (no /public/mcp route)", () => {
  const req = new Request("https://example.com/mcp", {
    headers: { "cf-connecting-ip": "1.2.3.4" },
  });
  assert.equal(getPublicMcpAuth(req), null);
});

test("allows /mcp with X-Client: gemini", () => {
  const req = new Request("https://example.com/mcp", {
    headers: { "x-client": "gemini", "cf-connecting-ip": "5.6.7.8" },
  });
  const auth = getPublicMcpAuth(req);
  assert.ok(auth.props);
  assert.equal(auth.props.userId, "public:5.6.7.8");
});

test("decodes base64 x-google-key and extracts BYOK credentials on /mcp", () => {
  const serviceAccount = JSON.stringify({ type: "service_account", project_id: "test" });
  const base64 = btoa(serviceAccount);
  const req = new Request("https://example.com/mcp", {
    headers: {
      "x-google-key": base64,
      "x-psi-key": "psi-123",
      "x-bing-key": "bing-456",
    },
  });
  const auth = getPublicMcpAuth(req);
  assert.equal(auth.props.userId, "public:anon");
  assert.equal(auth.props.google, serviceAccount);
  assert.equal(auth.props.psiKey, "psi-123");
  assert.equal(auth.props.bingKey, "bing-456");
});

const mcpInitBody = () => JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1.0" } },
});

const mcpHeaders = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
};

const mockOauthFetch = async () =>
  new Response("Unauthorized", {
    status: 401,
    headers: { "www-authenticate": 'Bearer realm="OAuth"' },
  });

const worker = createWorker({ mcpHandler, oauthFetch: mockOauthFetch });

test("routing: /mcp without public/BYOK headers falls through to OAuth 401", async () => {
  const req = new Request("https://example.com/mcp", {
    method: "POST",
    headers: mcpHeaders,
    body: mcpInitBody(),
  });
  const res = await worker.fetch(req, {}, {});
  assert.equal(res.status, 401);
  assert.match(res.headers.get("www-authenticate") || "", /Bearer/);
});

test("routing: /public/mcp is gone and falls through to OAuth", async () => {
  const req = new Request("https://example.com/public/mcp", {
    method: "POST",
    headers: mcpHeaders,
    body: mcpInitBody(),
  });
  const res = await worker.fetch(req, {}, {});
  assert.equal(res.status, 401);
});

test("routing: /mcp with X-Client: gemini bypasses OAuth and reaches MCP handler", async () => {
  const req = new Request("https://example.com/mcp", {
    method: "POST",
    headers: { ...mcpHeaders, "x-client": "gemini" },
    body: mcpInitBody(),
  });
  const res = await worker.fetch(req, {}, {});
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.result.serverInfo.name, "seo-advisor");
});

test("routing: non-tool requests on public path are rate-limited by TOOL_LIMITER", async () => {
  const calls = [];
  const env = {
    TOOL_LIMITER: {
      async limit({ key }) {
        calls.push(key);
        return { success: false };
      },
    },
  };
  const req = new Request("https://example.com/mcp", {
    method: "POST",
    headers: { ...mcpHeaders, "x-client": "gemini", "cf-connecting-ip": "9.9.9.9" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
  });
  const res = await worker.fetch(req, env, {});
  assert.equal(res.status, 429);
  assert.deepEqual(calls, ["9.9.9.9"]);
});

test("routing: tools/call on public path is not double-counted by router", async () => {
  const calls = [];
  const env = {
    TOOL_LIMITER: {
      async limit({ key }) {
        calls.push(key);
        return { success: true };
      },
    },
  };
  const req = new Request("https://example.com/mcp", {
    method: "POST",
    headers: { ...mcpHeaders, "x-client": "gemini", "cf-connecting-ip": "8.8.8.8" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "gsc_list_sites", arguments: {} } }),
  });
  const res = await worker.fetch(req, env, {});
  assert.equal(res.status, 200);
  assert.deepEqual(calls, ["public:8.8.8.8"]);
});

test("withProps preserves ExecutionContext prototype methods bound to original ctx", () => {
  class FakeExecutionCtx {
    waitUntil(p) { return [this, p]; }
    passThroughOnException() { return this; }
  }
  const orig = new FakeExecutionCtx();
  const wrapped = withProps(orig, { userId: "public:1.2.3.4" });
  assert.equal(wrapped.props.userId, "public:1.2.3.4");
  const [boundThis, arg] = wrapped.waitUntil("task");
  assert.equal(boundThis, orig);
  assert.equal(arg, "task");
  assert.equal(wrapped.passThroughOnException(), orig);
});
