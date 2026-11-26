// SEO Advisor remote MCP server (Cloudflare Worker).
//   /mcp        MCP over Streamable HTTP. Claude uses OAuth 2.1; Gemini and other agents send X-Client: gemini
//               or their own keys in headers and skip OAuth (see router.mjs and auth-gemini.mjs)
//   /authorize  the connect page where a user pastes their own keys
//   /register, /token, /.well-known/*   OAuth plumbing, handled by @cloudflare/workers-oauth-provider
// Nothing is stored except each connection's keys, encrypted by the OAuth library (AES-GCM, wrapped by
// the connection's own token) in KV. No analytics, no logs of tool inputs or outputs.

import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { mcpHandler } from "./mcp.mjs";
import { authorize, validateKeys, shell, secHeaders, REPO_URL } from "./setup.mjs";
import { createWorker, underLimit } from "./router.mjs";

const homePage = (origin) => {
  const html = shell(
    "SEO Advisor",
    `<h1>SEO Advisor</h1><p>An MCP server that turns Claude and Google Gemini into an SEO, AEO and site-performance advisor: Search Console, GA4, Bing Webmaster, PageSpeed and on-page audits. Read-only.</p>
<p><strong>For Claude:</strong> add <code>${origin}/mcp</code> as a custom connector in Claude (Settings, Connectors). You will be asked for your own keys once.</p>
<p><strong>For Gemini or other MCP agents:</strong> connect to <code>${origin}/mcp</code> with the header <code>X-Client: gemini</code>. No login is needed for the audit tools. Optional bring-your-own-key headers (<code>X-Google-Key</code>, <code>X-PSI-Key</code>, <code>X-Bing-Key</code>) enable the rest.</p>
<p class="mut"><a href="${REPO_URL}/blob/main/docs/gemini-setup.md">Gemini setup</a> · <a href="${REPO_URL}/blob/main/docs/remote-setup.md">Setup guide</a> · <a href="${REPO_URL}">Source (MIT)</a></p>`,
  );
  return new Response(html, { headers: secHeaders({}, "none") });
};

const defaultHandler = {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === "/authorize") {
      if (!(await underLimit(env.AUTH_LIMITER, request))) return new Response("Too many requests", { status: 429 });
      return authorize(request, env);
    }
    if (pathname === "/setup/validate" && request.method === "POST") {
      if (!(await underLimit(env.AUTH_LIMITER, request))) return Response.json({ error: "Too many attempts. Wait a minute." }, { status: 429 });
      return validateKeys(request);
    }
    if (pathname === "/health") return Response.json({ ok: true });
    if (pathname === "/") return homePage(new URL(request.url).origin);
    return new Response("Not found", { status: 404 });
  },
};

const providers = new Map();
function providerFor(origin) {
  let p = providers.get(origin);
  if (!p) {
    p = new OAuthProvider({
      apiRoute: "/mcp",
      apiHandler: mcpHandler,
      defaultHandler,
      authorizeEndpoint: "/authorize",
      tokenEndpoint: "/token",
      clientRegistrationEndpoint: "/register",
      // A connection (and the encrypted keys inside it) is deleted automatically after 90 days without use.
      // Active connections keep sliding forward, so people are not asked to reconnect while they use it.
      refreshTokenTTL: 90 * 86400,
      refreshTokenIdleTTL: 90 * 86400,
      scopesSupported: ["mcp"],
      requiredScopes: ["mcp"],
      resourceMetadata: { resource: `${origin}/mcp`, authorization_servers: [origin], resource_name: "SEO Advisor" },
      clientIdMetadataDocumentEnabled: true,
    });
    providers.set(origin, p);
  }
  return p;
}

export default createWorker({
  mcpHandler,
  oauthFetch: (request, env, ctx, origin) => providerFor(origin).fetch(request, env, ctx),
});
