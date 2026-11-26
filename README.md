# seo-advisor-mcp

An SEO, AEO and site-performance advisor for your own website, built for Claude and other AI clients.

It pulls real data from Google Search Console, Google Analytics 4, Bing Webmaster Tools and PageSpeed Insights (Lighthouse), audits your pages, finds the gaps, and gives the AI the instructions to turn that data into prioritised advice.

It ships as **two parts that work together**:

1. **An MCP server.** It provides the tools: data fetching, audits and analysis. Any MCP client can call them, including Claude, Claude Code, Gemini and other agents.
2. **A Claude skill** ([`skills/seo-advisor/SKILL.md`](skills/seo-advisor/SKILL.md)). It holds the advisor's method: which tools to run for each kind of request, how to rank recommendations, and what not to claim. The skill needs the MCP server connected.

The server runs **locally** (over stdio, on your computer, so your keys never leave it) or as a **hosted connector** on Cloudflare Workers ([docs/self-hosting.md](docs/self-hosting.md)).

> **AEO** (answer-engine optimisation) means making your site easy for AI search and answer engines to find, trust and cite. It is newer and less measurable than classic SEO, and the advisor says so when it gives AEO advice.

## What it can do

### Tools

| Tool | Needs | What it gives you |
|---|---|---|
| `gsc_list_sites` | Google key | Search Console properties you can read |
| `gsc_search_analytics` | Google key | Clicks, impressions, CTR and position by query, page, country, device or date |
| `seo_find_opportunities` | Google key | Striking-distance queries (rank 4-20), low-CTR results, zero-click queries and keyword cannibalisation, with estimated clicks to gain |
| `gsc_list_sitemaps` | Google key | Submitted sitemaps, with errors and warnings |
| `gsc_inspect_url` | Google key | Whether a URL is indexed, and which canonical Google chose |
| `ga_list_properties` | Google key | GA4 accounts and properties the key can read |
| `ga_run_report` | Google key | Any GA4 report, e.g. engagement rate by device or landing page |
| `ga_realtime` | Google key | The last 30 minutes, to confirm your tracking tag fires |
| `bing_*` (7 tools) | Bing API key | Queries, pages, daily traffic, crawl stats, crawl issues and inbound links |
| `psi_report` | PageSpeed key (free) | Lighthouse scores, Core Web Vitals (lab and real-user data) and the top failing audits |
| `seo_audit_page` | nothing | Title, meta, canonical, headings, alt text, links, Open Graph, JSON-LD and AEO signals |
| `seo_audit_site` | nothing | robots.txt, sitemaps, which AI crawlers are blocked, and `llms.txt` |
| `trends_trending_now` | nothing | Current spikes in Google Search for a country, filterable by topic |
| `seo_competitor_gaps` | nothing | Topics a competitor covers (from its public sitemap and newest articles) that you don't |
| `content_save_draft`, `content_list_drafts` | nothing | Saves Markdown drafts to a local folder and lists them as a content calendar. Local build only. **Nothing is published** |
| `cf_radar_domain_rank` | optional Cloudflare token | Cloudflare Radar popularity rank for any domain. This is popularity, not a search ranking |
| `cf_zone_traffic` | optional Cloudflare token and zone ID | Daily requests, visits and bytes for a site on your Cloudflare account (30 days at most) |

The Cloudflare tools are registered only when a token is configured, so they don't appear otherwise.

### Prompts

Ready-made workflows that the client can offer from its prompt menu: `onboarding` (checks which sources are connected and walks through the missing setup), `seo_health_check`, `find_traffic_opportunities`, `content_ideas_from_trends`, `competitor_content_plan`, `aeo_check` and `performance_vs_engagement`.

### Skill

The `seo-advisor` skill covers seven workflows: a full health check, traffic opportunities, AEO readiness, content ideas from trends, a competitor content plan, performance vs engagement, and a setup check. Each one names the tools to run and the output to deliver. Its core rules: ground every claim in tool data, separate data from inference, rank by impact over effort, never promise rankings, and never suggest spam.

## Project layout

```
server.mjs            local MCP server (stdio). Entry point for Claude Code, Claude Desktop and the .mcpb
src/
  ctx.mjs             per-request credentials: environment variables locally, the user's encrypted connection when hosted
  google.mjs          Google service-account client (Search Console, GA4)
  safe-fetch.mjs      outbound fetch with SSRF protection, used by every tool that reads a URL
  robots.mjs          robots.txt parsing
  prompts.mjs         the advisor's instructions and the prompt workflows
  tools/              tool registration (MCP input schemas and handlers), one file per source
  analysis/           pure functions with the logic (audits, opportunities, PSI, Bing, Cloudflare, drafts, trends)
  cloudflare.mjs      Cloudflare API client (Radar, GraphQL analytics)
remote/               hosted version: a Cloudflare Worker with OAuth, a connect page and the same tools
skills/seo-advisor/   the Claude skill
docs/                 setup guides (Google, Bing, Cloudflare, Gemini, Claude install, self-hosting)
test/                 unit tests for src/
remote/test/          tests for the hosted server (routing, rate limits, Gemini access)
manifest.json         Claude Desktop extension manifest (used by pack.sh)
pack.sh               builds the one-click .mcpb extension
```

Tool handlers stay thin. A handler reads its input, calls a client in `src/`, and passes the data to a pure function in `src/analysis/`. The tests cover the pure functions.

## Requirements

- Node.js 20 or newer, and npm.
- Optional, depending on which tools you want: a Google service-account key, a Bing Webmaster API key, a free PageSpeed Insights key, and a Cloudflare API token.

The page and site audits, trends and competitor tools need no credentials.

## Run it locally

```bash
git clone https://github.com/andriantam/seo-advisor-mcp.git
cd seo-advisor-mcp
npm install
npm test          # unit tests; no network or credentials needed
npm start         # starts the server on stdio. An MCP client normally starts it for you
```

To try the tools without a client, open the MCP Inspector:

```bash
npx @modelcontextprotocol/inspector node server.mjs
```

Configuration is environment variables, read when the server starts. `.env.example` lists them, but the server does not read `.env` itself. Export the variables in your shell, or set them where you register the server.

| Variable | Required | Meaning |
|---|---|---|
| `GOOGLE_APPLICATION_CREDENTIALS` | for `gsc_*`, `ga_*` | Path to your service-account JSON key |
| `GSC_SITE_URL` | optional | Default Search Console property, e.g. `sc-domain:andriantam.com` |
| `GA_PROPERTY_ID` | optional | Default GA4 property ID (digits only) |
| `BING_WEBMASTER_API_KEY` or `BING_WEBMASTER_API_KEY_FILE` | for `bing_*` | Bing Webmaster API key, or a path to a file that holds it (the file is safer) |
| `BING_SITE_URL` | optional | Default Bing site, e.g. `https://andriantam.com/` |
| `TRENDS_GEO` | optional | Default country code for trends, e.g. `SG`. Defaults to `US` |
| `SEO_DRAFTS_DIR` | optional | Absolute path of the drafts folder. Defaults to `~/seo-advisor-drafts` |
| `PSI_API_KEY` | recommended | Free PageSpeed Insights key. Without it you share an anonymous quota that runs out quickly |
| `CLOUDFLARE_API_TOKEN` or `CLOUDFLARE_API_TOKEN_FILE` | optional | Read-only Cloudflare token. Enables the Cloudflare tools |
| `CLOUDFLARE_ZONE_ID` | optional | Zone ID of your own site, for `cf_zone_traffic` |

Set up each credential: [Google](docs/google-setup.md), [Bing](docs/bing-setup.md), [Cloudflare](docs/cloudflare-setup.md).

## Connect it to a client

- **Claude Code, Claude Desktop, and Claude on web and mobile:** [docs/install.md](docs/install.md) has the exact commands and settings. The hosted connector is covered in [docs/remote-setup.md](docs/remote-setup.md).
- **Gemini and other MCP agents:** [docs/gemini-setup.md](docs/gemini-setup.md). Agents can use the hosted `/mcp` endpoint with the `X-Client: gemini` header, or send their own keys in headers.
- **One-click extension (`.mcpb`):** build it with `./pack.sh` (see below), then open the file in Claude Desktop.

### Install the skill

The skill is a folder containing a `SKILL.md` file. For Claude Code, copy it into your skills directory:

```bash
mkdir -p ~/.claude/skills
cp -R skills/seo-advisor ~/.claude/skills/
```

Then ask Claude for an SEO audit, and it will follow the skill's workflows. Keep the MCP server connected too, because the skill tells Claude how to use the server's tools.

## Develop

**Add or change a tool.**

1. Put the data logic in `src/analysis/` as pure functions, and add a test in `test/`.
2. Register the MCP tool in the matching file in `src/tools/`. Wrap the handler in `guard(...)` so errors come back as plain tool errors.
3. Add the tool to `server.mjs` (local) and `remote/src/mcp.mjs` (hosted) if it should work in both. Local-only and hosted-only tools are fine. Note the difference in the README table.
4. If the tool makes many outbound requests, add it to `HEAVY_TOOLS` in `remote/src/mcp.mjs` so it gets the tighter rate limit.
5. Run `npm test`.

**Change the advisor's behaviour.** Edit `src/prompts.mjs` for the server instructions and prompts, and `skills/seo-advisor/SKILL.md` for the skill's workflows. Keep the tool names in both consistent.

**Work on the hosted server.**

```bash
cd remote
npm install
npm test          # routing, rate limits and Gemini access; no network needed
npm run dev       # local Worker with wrangler dev
npm run e2e       # end-to-end check against a running Worker
```

`npm run dev` needs a `wrangler.jsonc` file. Copy `remote/wrangler.jsonc.example` and fill in your KV namespace ID, as described in [docs/self-hosting.md](docs/self-hosting.md). That file is git-ignored, so your IDs stay out of the repository.

**Build the one-click extension.**

```bash
./pack.sh         # writes seo-advisor.mcpb with production dependencies only, and no credentials
```

`pack.sh` uses `npx` to fetch the `mcpb` CLI, so the first run needs network access.

## Hosted or local?

| | Hosted connector | Local (`.mcpb` or stdio) |
|---|---|---|
| Install | add a URL in the client | install the extension, or run Node |
| Works on mobile | yes (add it on web or desktop first) | no |
| Where your keys live | encrypted in the Worker's KV store | on your computer only |
| Drafts folder | no (drafts are written in chat) | yes |
| Bing Webmaster | may be throttled, because a hosted server shares one IP address ([troubleshooting](docs/remote-setup.md#troubleshooting)) | reliable, because it uses your own IP |

## Security

- The Google scopes are read-only (`webmasters.readonly`, `analytics.readonly`). The tools cannot change your site, Search Console or Analytics.
- Keep the service-account key out of git. Give the service account the lowest role: Restricted in Search Console, Viewer in GA4.
- `seo_audit_page` and `seo_audit_site` fetch whatever URL you give them. `src/safe-fetch.mjs` blocks localhost, internal names and private, loopback and link-local addresses, and it re-checks every redirect. It cannot see a public hostname that resolves to a private address, so point the audits at sites you own or may reasonably read.
- Tool results, including your queries and traffic numbers, go to the AI client as part of the conversation.
- The hosted server does not log tool inputs or outputs. Usage counts are off by default. Never turn on request logging for the Worker, because Bing's API puts the key in the request URL.

## Limits and gaps

- **Competitor analysis** reads public sitemaps and the newest article pages, at most 100 pages, five at a time. It cannot see competitor traffic or search volume, which need a paid keyword database.
- **Keyword interest over time** is not covered. Google has no public API for it, and the unofficial endpoints are rate-limited and often blocked.
- **Social platforms** (TikTok, Instagram, Facebook, Xiaohongshu) have no general trends API for ordinary accounts, so none is built in.
- **AEO advice** is emerging and less proven than classic SEO. The advisor says so when it applies.

## Roadmap

Pull requests are welcome. Roughly in order of usefulness:

- Google Trends interest over time, once the official API is generally available
- Chrome UX Report API for real-user Core Web Vitals history
- Optional paid keyword and backlink adapters (Semrush, Ahrefs, DataForSEO), each opt-in
- IndexNow submission for changed URLs
- Sign in with Google (OAuth) for the hosted connector, so users don't need a service-account key
- Scheduled reports, such as a weekly digest run from cron

## License

[MIT](LICENSE)
