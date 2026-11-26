# Self-hosting the connector on Cloudflare

The hosted version is one Cloudflare Worker (in [`remote/`](../remote)) plus one KV namespace. You can run your own copy for yourself or your team, so no one else holds your keys.

> **Never turn on Workers Logs or tracing for this Worker.** Bing's API requires the key in the request URL, so request logging would record users' Bing keys. `wrangler.jsonc` ships with observability off; keep it that way.

## What you need

- A Cloudflare account and Node 20+.
- The **Workers Paid plan** ($5/month) is recommended. As published by Cloudflare (Nov 2026), Free allows 50 outbound requests and 10 ms of CPU per invocation, and 1,000 KV writes per day; Paid allows 10,000 outbound requests, 30 s of CPU (configurable) and 1M KV writes per month. Time spent waiting on the network does not count as CPU time. A competitor scan can make 50+ outbound requests and parsing HTML uses CPU, so those tools may fail on Free. Every active connection also refreshes its token about hourly, which writes to KV, so Free supports only a handful of regular users. Try Free first for yourself, and upgrade if a tool fails. Limits change: check <https://developers.cloudflare.com/workers/platform/limits/>.
- This repository, with `npm install` run inside `remote/`.

## Deploy

```bash
cd remote
npm install
npx wrangler login
npx wrangler kv namespace create OAUTH_KV
```

First copy the example config, then paste the printed `id` into it (replace `REPLACE_WITH_KV_NAMESPACE_ID`):

```bash
cp wrangler.jsonc.example wrangler.jsonc
```

Then deploy:

```bash
npx wrangler deploy
```

`remote/wrangler.jsonc` is git-ignored, so your real ID and settings stay out of git. The tracked file is `wrangler.jsonc.example`; keep it sanitised.

Wrangler prints your address, like `https://seo-advisor.<your-subdomain>.workers.dev`. Your connector URL is that address plus `/mcp`. Add it in Claude following [remote-setup.md](remote-setup.md).

You can attach a custom domain in the Cloudflare dashboard (Workers → your Worker → Settings → Domains & Routes). The OAuth addresses follow whichever domain the request used.

## Test locally first

```bash
cd remote
npm run dev          # http://localhost:8787
# in another terminal:
node scripts/e2e.mjs
```

`e2e.mjs` walks the whole flow: client registration, the connect page, token exchange, MCP calls, blocked internal addresses, protected endpoints. Claude itself needs a public HTTPS address, so local testing uses the script rather than Claude.

## What is stored, and where

| Data | Where | Protection |
|---|---|---|
| Each connection's keys | KV, as part of the connection record | AES-GCM encrypted; the key is wrapped by that connection's own token, so KV contents alone cannot decrypt them |
| Access and refresh tokens, auth codes | KV | stored only as hashes |
| OAuth client registrations (name, redirect addresses) | KV | public metadata; expires after 90 days (renewed while in use) |
| Tool inputs and outputs | nowhere | not logged or stored |

A connection, with its encrypted keys, is deleted automatically after 90 days without use (`refreshTokenIdleTTL` in `remote/src/index.mjs`).

Rate limits use Cloudflare's rate-limiting bindings (in `wrangler.jsonc`: 60 tool calls/min, 10/min for the heavy scanning tools, 20/min per IP for the sign-in endpoints). Cloudflare documents these as **approximate and counted separately in each Cloudflare location**, so treat them as abuse protection, not exact quotas. Each binding's `namespace_id` must be unique on your account; change 1001-1003 if another Worker already uses them. For a strict global limit you would need Durable Objects. Adjust the numbers to taste.

## Protections against misuse

Because anyone can point the scanning tools at any address, every outbound fetch goes through [`src/safe-fetch.mjs`](../src/safe-fetch.mjs):

- http/https on ports 80 and 443 only; no credentials in the URL
- no `localhost`, internal-looking names (`.internal`, `.local`, single-label hosts), private, loopback, link-local or cloud-metadata IP addresses, or IPv6 literals
- redirects followed manually (max 5) with every hop re-checked
- 15-second timeout and a size cap on every response

`global_fetch_strictly_public` (a compatibility flag in `wrangler.jsonc`) additionally keeps outbound fetches from reaching other Workers or services in your own Cloudflare account. The competitor scan reads only pages the competitor's `robots.txt` allows. Limit: a public hostname that resolves to a private address cannot be seen from inside a Worker, but a Worker cannot reach private networks anyway.

## Usage counts (optional)

Counting is **off by default** (`ANALYTICS` in `remote/wrangler.jsonc`). It records only two anonymous events (a connection was created, and a tool was called, with the tool name, outcome, duration and a coarse country code). Connection IDs are hashed with a secret, and tool inputs, results, keys, site addresses and queries are never recorded. You switch it on yourself:

1. Set `"ANALYTICS": "on"` in your own config (keep the tracked `wrangler.jsonc` at `off` if you fork it publicly).
2. Set a secret that hashes connection IDs, at least 16 characters: `npx wrangler secret put ANALYTICS_SECRET`. Keep it safe: if you lose it, old counts cannot be matched to new ones.
3. Redeploy.

Not using Cloudflare? Delete the `analytics_engine_datasets` line from `wrangler.jsonc`. The server then runs without it and counting is off, whatever `ANALYTICS` says. The local `.mcpb` and stdio builds never count anything. To send counts somewhere else, supply your own sink to `createAnalytics` in [`remote/src/analytics.mjs`](../remote/src/analytics.mjs).

## Updating

```bash
git pull && cd remote && npm install && npx wrangler deploy
```

Existing connections keep working across updates.
