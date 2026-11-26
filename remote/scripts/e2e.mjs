// End-to-end check against a running `npm run dev` (http://localhost:8787): OAuth registration, the connect
// page, token exchange, MCP calls, SSRF blocking and endpoint protection. Needs network for the example.com audit.
// Usage: (cd remote && npm run dev)   then   node remote/scripts/e2e.mjs
import { createHash, randomBytes } from "node:crypto";
const B = process.env.BASE || "http://localhost:8787";
const b64 = (b) => Buffer.from(b).toString("base64url");
const step = (n, ok, extra = "") => console.log(`${ok ? "PASS" : "FAIL"}  ${n} ${extra}`);

// 1. dynamic client registration
const redirect = "http://localhost:9999/cb";
const reg = await (await fetch(`${B}/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: "e2e", redirect_uris: [redirect], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }) })).json();
step("register client", !!reg.client_id);

// 2. authorize (GET shows the connect page)
const verifier = b64(randomBytes(32));
const challenge = b64(createHash("sha256").update(verifier).digest());
const q = new URLSearchParams({ response_type: "code", client_id: reg.client_id, redirect_uri: redirect, scope: "mcp", state: "xyz", code_challenge: challenge, code_challenge_method: "S256", resource: `${B}/mcp` });
const page = await fetch(`${B}/authorize?${q}`, { redirect: "manual" });
const html = await page.text();
const cookie = page.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
const handle = /name="handle" value="([^"]+)"/.exec(html)?.[1];
step("connect page renders", page.status === 200 && html.includes("Connect SEO Advisor") && !!handle, `csp=${page.headers.get("content-security-policy")?.slice(0, 40)}...`);
step("page sends security headers", page.headers.get("cache-control") === "no-store" && /frame-ancestors 'none'/.test(page.headers.get("content-security-policy")));

// 3. bad google key is rejected without echo
const bad = await fetch(`${B}/authorize`, { method: "POST", redirect: "manual", headers: { cookie, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ handle, decision: "approve", google: "{not json" }) });
const badText = await bad.text();
step("invalid Google key rejected", bad.status === 400 && badText.includes("not valid JSON") && !badText.includes("not json"));

// 4. approve with a Bing key only (fake) -> redirect with code
const ok = await fetch(`${B}/authorize`, { method: "POST", redirect: "manual", headers: { cookie, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ handle, decision: "approve", bing: "FAKE-BING-KEY" }) });
const loc = ok.headers.get("location");
const code = loc && new URL(loc).searchParams.get("code");
step("approve redirects with code + state", ok.status === 302 && !!code && new URL(loc).searchParams.get("state") === "xyz", loc?.slice(0, 40));

// 5. token exchange
const tok = await (await fetch(`${B}/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirect, client_id: reg.client_id, code_verifier: verifier, resource: `${B}/mcp` }) })).json();
step("token exchange", !!tok.access_token, tok.error || "");

// 6. MCP
const rpc = (method, params, id = 1) => fetch(`${B}/mcp`, { method: "POST", headers: { authorization: `Bearer ${tok.access_token}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }) }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "1" } });
step("mcp initialize", init.status === 200 && init.body?.result?.serverInfo?.name === "seo-advisor", init.body?.result?.instructions?.includes("Sites and IDs") ? "(remote instructions)" : "(MISSING remote instructions)");
const list = await rpc("tools/list", {}, 2);
const names = list.body?.result?.tools?.map((t) => t.name) ?? [];
step("tools/list", names.length > 15, `${names.length} tools`);
step("no drafts tools in remote", !names.includes("content_save_draft") && !names.includes("content_list_drafts"));
step("ga_list_properties present", names.includes("ga_list_properties"));
const prompts = await rpc("prompts/list", {}, 3);
step("onboarding prompt present", prompts.body?.result?.prompts?.some((p) => p.name === "onboarding"));

// 7. unconfigured source gives a plain error
const g = await rpc("tools/call", { name: "gsc_list_sites", arguments: {} }, 4);
step("unconfigured Google -> clear message", g.body?.result?.isError && /not set up/.test(g.body.result.content[0].text), g.body?.result?.content?.[0]?.text?.slice(0, 60));
const ga = await rpc("tools/call", { name: "ga_run_report", arguments: {} }, 5);
step("missing propertyId prompts to ask user", /not set up|Ask the user|propertyId/.test(ga.body?.result?.content?.[0]?.text ?? ""));

// 8. SSRF blocked through the tool
const ssrf = await rpc("tools/call", { name: "seo_audit_page", arguments: { url: "http://169.254.169.254/latest/meta-data/" } }, 6);
step("SSRF blocked (metadata IP)", ssrf.body?.result?.isError && /not allowed/i.test(ssrf.body.result.content[0].text), ssrf.body?.result?.content?.[0]?.text);
const ssrf2 = await rpc("tools/call", { name: "seo_audit_site", arguments: { siteUrl: "http://localhost:8787/" } }, 7);
step("SSRF blocked (localhost)", ssrf2.body?.result?.isError, ssrf2.body?.result?.content?.[0]?.text);

// 9. a real public audit works
const real = await rpc("tools/call", { name: "seo_audit_site", arguments: { siteUrl: "https://example.com" } }, 8);
step("real site audit (example.com)", real.body?.result && !real.body.result.isError, real.body?.result?.isError ? real.body.result.content[0].text : "");

// 10. no token / wrong token
const noauth = await fetch(`${B}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
step("no token -> 401", noauth.status === 401);
const wrong = await fetch(`${B}/mcp`, { method: "POST", headers: { authorization: "Bearer nope", "content-type": "application/json" }, body: "{}" });
step("bad token -> 401", wrong.status === 401);

// 11. validate endpoint needs same-origin JSON
const v1 = await fetch(`${B}/setup/validate`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
step("validate rejects missing Origin", v1.status === 403);
const v2 = await fetch(`${B}/setup/validate`, { method: "POST", headers: { "content-type": "application/json", origin: B }, body: JSON.stringify({ google: "junk" }) });
const v2j = await v2.json();
step("validate reports bad Google JSON", v2j.google?.ok === false);
