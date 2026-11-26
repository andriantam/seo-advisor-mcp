// The connect page: shown when someone adds this server as a connector in Claude. They paste their own
// keys here; the OAuth library then stores them encrypted with a key only that connection's token can
// unwrap (AES-GCM, key wrapped by the token). Nothing is shown back and nothing is logged.

import { AuthorizationError, CimdFetchError } from "@cloudflare/workers-oauth-provider";
import { parseServiceAccount, createGoogleClient } from "../../src/google.mjs";
import { bingCall } from "../../src/analysis/bing.mjs";
import { cfRadar, cfGraphql } from "../../src/cloudflare.mjs";
import { zoneTrafficRequest } from "../../src/analysis/cloudflare.mjs";
import { analyticsFor } from "./analytics.mjs";

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
// Source repository, linked from the connect page.
export const REPO_URL = "https://github.com/andriantam/seo-advisor-mcp";
const DOCS = `${REPO_URL}/blob/main/docs/remote-setup.md`;

const STYLE = `
:root{color-scheme:light dark;--bg:#fff;--fg:#1a1a1a;--mut:#666;--line:#d9d9d9;--acc:#1a56db;--card:#f7f7f8;--ok:#0a7a3d;--bad:#b42318}
@media (prefers-color-scheme:dark){:root{--bg:#161616;--fg:#eee;--mut:#a0a0a0;--line:#333;--acc:#6ea0ff;--card:#202020;--ok:#4cc38a;--bad:#ff8a80}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,sans-serif}
main{max-width:640px;margin:0 auto;padding:24px 16px 64px}h1{font-size:1.5rem;margin:.2em 0}h2{font-size:1.05rem;margin:1.6em 0 .2em}
p,li{color:var(--fg)}.mut{color:var(--mut);font-size:.92rem}a{color:var(--acc)}
label{display:block;font-weight:600;margin-top:1.1em}textarea,input[type=password],input[type=text]{width:100%;margin-top:.3em;padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--fg);font:14px ui-monospace,monospace}
textarea{min-height:110px}.row{display:flex;gap:10px;flex-wrap:wrap;margin-top:1.6em}
button{font:inherit;padding:11px 18px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--fg);cursor:pointer}
button.p{background:var(--acc);color:#fff;border-color:var(--acc)}button:disabled{opacity:.6}
.box{border:1px solid var(--line);background:var(--card);border-radius:10px;padding:12px 14px;margin-top:1em}
.ok{color:var(--ok)}.bad{color:var(--bad)}#res div{margin:.3em 0}code{font-size:.9em}`;

function shell(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title><style>${STYLE}</style></head><body><main>${body}</main></body></html>`;
}

function secHeaders(extra, nonce) {
  const h = new Headers(extra);
  h.set("content-type", "text/html; charset=utf-8");
  h.set("cache-control", "no-store");
  h.set("referrer-policy", "no-referrer");
  h.set("x-content-type-options", "nosniff");
  h.set("content-security-policy", `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'self'; img-src data:; frame-ancestors 'none'; base-uri 'none'`);
  return h;
}

function formPage(details, handle, nonce) {
  const client = esc(details.clientName || "an app");
  const body = `
<h1>Connect SEO Advisor</h1>
<p><strong>${client}</strong> is asking to connect to your SEO Advisor.${details.clientDomain ? ` Published by <strong>${esc(details.clientDomain)}</strong>.` : ""} After you continue you'll be sent back to <strong>${esc(details.redirectHost)}</strong>.</p>
${details.redirectIsLoopback ? '<p class="bad"><strong>This sends access to an app on your own computer.</strong> Continue only if you just started connecting from it.</p>' : ""}
<p class="mut">Everything below is optional. Site scans, PageSpeed (with or without a key) and trends work with nothing filled in. Add only the sources you use. Your keys are stored encrypted and are only used to read data for your own requests. <a href="${DOCS}" target="_blank" rel="noopener">How to get each key</a></p>

<form method="post" id="f" autocomplete="off">
<input type="hidden" name="handle" value="${esc(handle)}">

<h2>Google: Search Console and GA4</h2>
<p class="mut">A Google <em>service-account key</em> (JSON). The site must already be verified in Search Console, and the service account's email added there and in GA4 as a user. Search Console and GA4 do not accept plain API keys.</p>
<label for="google">Service-account key (paste the whole JSON, or choose the file)</label>
<textarea id="google" name="google" spellcheck="false" placeholder='{"type": "service_account", ...}'></textarea>
<input type="file" id="gfile" accept=".json,application/json" class="mut">

<h2>Bing Webmaster Tools</h2>
<label for="bing">API key</label>
<input type="password" id="bing" name="bing" spellcheck="false" autocomplete="off">

<h2>PageSpeed Insights</h2>
<label for="psi">API key (optional, avoids rate limits)</label>
<input type="password" id="psi" name="psi" spellcheck="false" autocomplete="off">

<h2>Cloudflare (optional)</h2>
<p class="mut">Skip this unless you use Cloudflare. A token gives <em>Cloudflare Radar</em> domain rank for any domain. Add a zone ID as well to see daily traffic for a site on your Cloudflare account. Create a read-only API token in the Cloudflare dashboard; the zone ID is on the site's Overview page.</p>
<label for="cf">API token</label>
<input type="password" id="cf" name="cloudflare" spellcheck="false" autocomplete="off">
<label for="cfz">Zone ID (only for a site on your Cloudflare account)</label>
<input type="text" id="cfz" name="cloudflare_zone" spellcheck="false" autocomplete="off">

<div id="res" class="box" hidden></div>
<div class="row"><button class="p" type="button" id="go" name="decision" value="approve">Check and connect</button><button type="submit" name="decision" value="deny" formnovalidate>Cancel</button></div>
<noscript><p class="mut">Without JavaScript the keys are saved without a test. <button type="submit" name="decision" value="approve">Connect without testing</button></p></noscript>
</form>
<script nonce="${nonce}">
const $=id=>document.getElementById(id), f=$("f"), res=$("res"), go=$("go");
$("gfile").addEventListener("change",async e=>{const t=e.target.files[0];if(t)$("google").value=await t.text();});
function line(ok,msg){const d=document.createElement("div");d.className=ok?"ok":"bad";d.textContent=(ok?"✓ ":"✗ ")+msg;res.appendChild(d)}
go.addEventListener("click",async()=>{
  const body={google:$("google").value.trim(),bing:$("bing").value.trim(),psi:$("psi").value.trim(),cloudflare:$("cf").value.trim(),cloudflareZone:$("cfz").value.trim()};
  res.hidden=false;res.replaceChildren();go.disabled=true;
  if(!body.google&&!body.bing&&!body.psi&&!body.cloudflare){line(true,"No keys entered: connecting with the no-login tools only.");return submit()}
  try{
    const r=await fetch("/setup/validate",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
    const j=await r.json();let bad=false;
    if(j.google){if(j.google.ok){line(true,"Google key works (service account "+j.google.email+"). Search Console properties it can see: "+(j.google.sites.length?j.google.sites.join(", "):"none yet; add this email as a user in Search Console"))}else{bad=true;line(false,"Google: "+j.google.error)}}
    if(j.bing){if(j.bing.throttled){line(true,"Bing is rate-limiting this server right now, so the key could not be tested. It will be saved; if Bing tools fail later, try again in a few minutes.")}else if(j.bing.ok){line(true,"Bing key works. Verified sites: "+(j.bing.sites.length?j.bing.sites.join(", "):"none yet"))}else{bad=true;line(false,"Bing: "+j.bing.error)}}
    if(j.psi)line(true,"PageSpeed key saved (not tested).");
    if(j.cloudflare){if(j.cloudflare.ok){line(true,"Cloudflare token works (Radar).")}else{bad=true;line(false,"Cloudflare: "+j.cloudflare.error)}
      if(j.cloudflare.zone){if(j.cloudflare.zone.ok){line(true,"Cloudflare zone traffic works.")}else{bad=true;line(false,"Cloudflare zone: "+j.cloudflare.zone.error)}}}
    if(j.error){bad=true;line(false,j.error)}
    if(bad){go.disabled=false;return}
    setTimeout(submit,900);
  }catch{line(false,"Could not run the check. Try again.");go.disabled=false}
});
function submit(){const i=document.createElement("input");i.type="hidden";i.name="decision";i.value="approve";f.appendChild(i);f.submit()}
</script>`;
  return shell("Connect SEO Advisor", body);
}

const errorPage = (msg, status = 400) =>
  new Response(shell("Cannot connect", `<h1>Cannot connect</h1><p>${esc(msg)}</p><p class="mut">Go back to Claude and add the connector again.</p>`), {
    status,
    headers: secHeaders({}, "none"),
  });

/** GET and POST /authorize */
export async function authorize(request, env) {
  const oauth = env.OAUTH_PROVIDER;
  try {
    if (request.method === "GET") {
      const req = await oauth.parseAuthRequest(request);
      const details = await oauth.describeConsent(req);
      const consent = await oauth.beginConsent(req);
      const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
      return new Response(formPage(details, consent.handle, nonce), { headers: secHeaders(consent.headers, nonce) });
    }
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

    const form = await request.formData();
    const handle = String(form.get("handle") || "");
    if (form.get("decision") !== "approve") {
      const denied = await oauth.denyConsent(request, handle);
      return new Response(null, { status: 302, headers: denied.headers });
    }

    // Structural checks only here (the page already did a live test). Never echo values back.
    const props = { userId: crypto.randomUUID() };
    const google = String(form.get("google") || "").trim();
    if (google) {
      try {
        const k = parseServiceAccount(google);
        props.google = JSON.stringify(k);
      } catch (e) {
        return errorPage(e.message);
      }
    }
    const bing = String(form.get("bing") || "").trim();
    const psi = String(form.get("psi") || "").trim();
    if (bing) props.bingKey = bing;
    if (psi) props.psiKey = psi;
    const cloudflare = String(form.get("cloudflare") || "").trim();
    const cloudflareZone = String(form.get("cloudflare_zone") || "").trim();
    if (cloudflare) props.cloudflareToken = cloudflare;
    if (cloudflareZone) props.cloudflareZoneId = cloudflareZone;
    if ((google.length > 20_000) || bing.length > 200 || psi.length > 200 || cloudflare.length > 300 || cloudflareZone.length > 64)
      return errorPage("One of the values is too long to be a valid key.");

    const approved = await oauth.approveConsent(request, handle, { scope: ["mcp"] });
    const { redirectTo } = await oauth.completeAuthorization({
      request: approved.request,
      userId: props.userId,
      metadata: { label: "SEO Advisor", sources: [google && "google", bing && "bing", psi && "psi", cloudflare && "cloudflare"].filter(Boolean) },
      scope: ["mcp"],
      props,
    });
    try {
      await analyticsFor(env).track({ event: "connection_created", connectionId: props.userId, country: request.cf?.country });
    } catch (err) {
      console.warn("usage count failed", err?.name || "error");
    }
    approved.headers.set("Location", redirectTo);
    return new Response(null, { status: 302, headers: approved.headers });
  } catch (error) {
    if (error instanceof AuthorizationError && error.redirectTo) return Response.redirect(error.redirectTo, 302);
    if (error instanceof AuthorizationError) return errorPage(error.description || "This connection request is no longer valid.");
    if (error instanceof CimdFetchError) return errorPage("This app could not be verified.");
    throw error;
  }
}

/** POST /setup/validate: test keys without storing them. Same-origin JSON only. */
export async function validateKeys(request) {
  const origin = new URL(request.url).origin;
  if (request.headers.get("origin") !== origin || !(request.headers.get("content-type") || "").includes("application/json"))
    return Response.json({ error: "Not allowed." }, { status: 403 });
  if (Number(request.headers.get("content-length") || 0) > 40_000) return Response.json({ error: "Too large." }, { status: 413 });
  const body = await request.json().catch(() => ({}));
  const out = {};
  if (body.google) {
    try {
      const client = createGoogleClient(body.google);
      const data = await client.call("https://www.googleapis.com/webmasters/v3/sites");
      out.google = { ok: true, email: client.email, sites: (data.siteEntry || []).map((s) => s.siteUrl).slice(0, 20) };
    } catch (e) {
      out.google = { ok: false, error: e.message };
    }
  }
  if (body.bing) {
    try {
      const sites = await bingCall("GetUserSites", {}, { key: String(body.bing) });
      out.bing = { ok: true, sites: (Array.isArray(sites) ? sites : []).map((s) => s.Url).slice(0, 20) };
    } catch (e) {
      // Bing throttles shared server addresses; do not block connecting because of that.
      out.bing = e.throttled ? { ok: true, throttled: true } : { ok: false, error: e.message };
    }
  }
  if (body.psi) out.psi = { ok: true };
  if (body.cloudflare) {
    const token = String(body.cloudflare);
    try {
      // Radar works with any valid token, so it is a good test of the token itself.
      await cfRadar("/radar/ranking/domain/cloudflare.com", { token });
      out.cloudflare = { ok: true };
    } catch (e) {
      out.cloudflare = { ok: false, error: e.message };
    }
    if (body.cloudflareZone && out.cloudflare.ok) {
      try {
        const { query, variables } = zoneTrafficRequest({ zoneTag: String(body.cloudflareZone), days: 1 });
        await cfGraphql(query, variables, { token });
        out.cloudflare.zone = { ok: true };
      } catch (e) {
        out.cloudflare.zone = { ok: false, error: e.message };
      }
    }
  }
  return Response.json(out, { headers: { "cache-control": "no-store" } });
}

export { shell, secHeaders, esc };
