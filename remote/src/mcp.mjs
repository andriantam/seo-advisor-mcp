// The MCP endpoint (protected by OAuth). Stateless: every request builds a fresh server from the
// caller's decrypted connection details, answers, and keeps nothing.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { makeContext } from "../../src/ctx.mjs";
import { registerGoogleTools } from "../../src/tools/google.mjs";
import { registerWebTools } from "../../src/tools/web.mjs";
import { registerBingTools } from "../../src/tools/bing.mjs";
import { registerContentTools } from "../../src/tools/content.mjs";
import { registerCloudflareTools } from "../../src/tools/cloudflare.mjs";
import { registerPrompts, instructions } from "../../src/prompts.mjs";
import { analyticsFor } from "./analytics.mjs";

export const VERSION = "0.2.0";
const MAX_BODY_BYTES = 256 * 1024;
/** Tools that fan out to many outbound requests get a tighter limit. */
export const HEAVY_TOOLS = new Set(["seo_audit_site", "seo_audit_page", "seo_competitor_gaps", "psi_report"]);

export function buildServer(props) {
  const ctx = makeContext({
    google: props.google,
    psiKey: props.psiKey,
    bingKey: props.bingKey,
    cloudflareToken: props.cloudflareToken,
    cloudflareZoneId: props.cloudflareZoneId,
  });
  const getCtx = () => ctx;
  const server = new McpServer({ name: "seo-advisor", version: VERSION }, { instructions: instructions({ remote: true }) });
  registerGoogleTools(server, getCtx);
  registerWebTools(server, getCtx);
  registerBingTools(server, getCtx);
  registerContentTools(server, getCtx, { drafts: false });
  registerCloudflareTools(server, getCtx); // optional: only when a Cloudflare token was added at connect time
  registerPrompts(server);
  return server;
}

const rpcError = (id, text) => Response.json({ jsonrpc: "2.0", id: id ?? null, result: { isError: true, content: [{ type: "text", text }] } });

/** Returns a Response if a tool call in this request is over its limit, otherwise null. */
export async function checkLimits(env, userId, messages) {
  for (const m of messages) {
    if (m?.method !== "tools/call") continue;
    const heavy = HEAVY_TOOLS.has(m.params?.name);
    const limiter = heavy ? env.HEAVY_LIMITER : env.TOOL_LIMITER;
    if (!limiter) continue;
    const { success } = await limiter.limit({ key: userId });
    if (!success)
      return rpcError(m.id, heavy ? "Rate limit reached for site-scanning tools (10 per minute). Wait a minute and try again." : "Rate limit reached (60 tool calls per minute). Wait a minute and try again.");
  }
  return null;
}

export const mcpHandler = {
  async fetch(request, env, ctx) {
    const userId = ctx.auth?.userId || ctx.props?.userId || "anon";
    let toolCall = null;
    if (request.method === "POST") {
      if (Number(request.headers.get("content-length") || 0) > MAX_BODY_BYTES) return new Response("Request too large", { status: 413 });
      const body = await request.clone().json().catch(() => null);
      const messages = Array.isArray(body) ? body : [body];
      const limited = await checkLimits(env, userId, messages);
      if (limited) return limited;
      // Only the tool name is kept for usage counts; arguments are never read beyond this.
      const call = messages.find((m) => m?.method === "tools/call");
      if (call) toolCall = call.params?.name;
    }
    const server = buildServer(ctx.props || {});
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    const started = Date.now();
    const response = await transport.handleRequest(request);
    if (toolCall) await countToolCall(env, ctx, toolCall, response, Date.now() - started);
    return response;
  },
};

/** Count one tool call. Never throws: counting must not change the answer a user gets. */
async function countToolCall(env, ctx, tool, response, durationMs) {
  try {
    const failed = await response.clone().json().then((j) => Boolean(j?.result?.isError || j?.error)).catch(() => false);
    // Public (no-login) callers are identified only by IP for rate limits. Never count them by IP.
    const userId = ctx.props?.userId;
    const connectionId = userId && !userId.startsWith("public:") ? userId : undefined;
    await analyticsFor(env).track({ event: "tool_call", tool, outcome: failed ? "error" : "ok", durationMs, connectionId });
  } catch (err) {
    console.warn("usage count failed", err?.name || "error");
  }
}
