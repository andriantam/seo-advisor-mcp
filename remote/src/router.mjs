import { getPublicMcpAuth } from "./auth-gemini.mjs";

export async function underLimit(limiter, request) {
  if (!limiter) return true;
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  return (await limiter.limit({ key: ip })).success;
}

async function hasToolCall(request) {
  if (request.method !== "POST") return false;
  const body = await request.clone().json().catch(() => null);
  const messages = Array.isArray(body) ? body : [body];
  return messages.some((m) => m?.method === "tools/call");
}

export function withProps(ctx, props) {
  const bound = { ...ctx, props };
  if (typeof ctx?.waitUntil === "function") bound.waitUntil = ctx.waitUntil.bind(ctx);
  if (typeof ctx?.passThroughOnException === "function") bound.passThroughOnException = ctx.passThroughOnException.bind(ctx);
  return bound;
}

/**
 * Build the Worker fetch handler with injectable mcpHandler and oauthFetch so
 * the routing cascade can be unit-tested in Node without cloudflare: imports.
 */
export function createWorker({ mcpHandler, oauthFetch }) {
  return {
    async fetch(request, env, ctx) {
      const url = new URL(request.url);
      // Throttle the unauthenticated OAuth endpoints per IP so they cannot be used to fill storage.
      if ((url.pathname === "/register" || url.pathname === "/token") && !(await underLimit(env.AUTH_LIMITER, request)))
        return new Response("Too many requests", { status: 429 });

      // On /mcp only: a request with X-Client: gemini or BYOK headers is an agent request (e.g. Gemini),
      // handled without OAuth. Everything else falls through to Claude's OAuth flow below.
      if (url.pathname === "/mcp") {
        const publicAuth = getPublicMcpAuth(request);
        if (publicAuth) {
          // Tool calls are rate-limited inside mcpHandler.checkLimits; limit non-tool requests
          // (initialize, tools/list, GET, invalid JSON) here so they cannot be spammed.
          if (!(await hasToolCall(request)) && !(await underLimit(env.TOOL_LIMITER, request))) {
            return new Response("Too many requests", { status: 429 });
          }
          return mcpHandler.fetch(request, env, withProps(ctx, publicAuth.props));
        }
      }

      // Default: Claude OAuthProvider (Claude tokens, /authorize, /token, and unauthenticated Claude 401s)
      return oauthFetch(request, env, ctx, url.origin);
    },
  };
}
