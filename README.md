# seo-advisor-mcp

An [MCP](https://modelcontextprotocol.io) server that turns Claude (or Google Gemini) into an **SEO, AEO and site-performance advisor** for your own website. It pulls real data from Google Search Console, Google Analytics 4 and Lighthouse, audits your pages, finds the gaps, and tells Claude how to reason about them and what to recommend.

- **Two ways to run it.** As a **Claude connector** on a hosted server (works on web, desktop and mobile, nothing to install; see [docs/remote-setup.md](docs/remote-setup.md)), or **locally** on your own computer as a Desktop Extension or stdio server (your keys never leave your machine).
- **Read-only.** It uses read-only Google scopes and cannot change your site, your Search Console or your Analytics.
- **Bring your own credentials.** Every user supplies their own keys: on the connect page for the hosted connector, or in the extension settings locally. Claude never sees them.
- **Open source.** Run your own hosted copy on Cloudflare ([docs/self-hosting.md](docs/self-hosting.md)) or use the local build.

> **AEO** (answer-engine optimisation) means making your site easy for AI search and answer engines to find, trust and cite. It is newer and less measurable than classic SEO, and this tool says so when it gives AEO advice.

## Hosted connector or local?

| | Hosted connector | Local (`.mcpb` / stdio) |
|---|---|---|
| Install | add a URL in Claude | install the extension, or run Node |
| Works on mobile | yes (add it on web/desktop first) | no |
| Where your keys live | encrypted on the server you connect to | on your computer only |
| Site and GA4 IDs | you tell Claude per conversation | can be set once in settings |
| Drafts folder | no (drafts are written in chat) | yes |
| Bing Webmaster | may be throttled: Bing limits requests per server IP address and a hosted server shares one (see [troubleshooting](docs/remote-setup.md#troubleshooting)) | reliable, it uses your own IP |
| Data | nothing is stored by the server except your encrypted keys | nothing leaves your machine except API calls you trigger |

The hosted server lives in [`remote/`](remote); the tools are shared with the local build in `src/`. Gemini and other MCP agents can connect too: see [docs/gemini-setup.md](docs/gemini-setup.md). Pick whichever suits you; the rest of this README describes the local build.

## What it can do

| Tool | Needs | What it gives you |
|---|---|---|
| `gsc_list_sites` | Google key | Search Console properties you can read |
| `gsc_search_analytics` | Google key | Clicks, impressions, CTR and position by query, page, country, device or date |
| `seo_find_opportunities` | Google key | **Gap analysis:** striking-distance queries (rank 4-20), low-CTR results, zero-click queries, keyword cannibalisation, with estimated clicks to gain |
| `gsc_list_sitemaps` | Google key | Submitted sitemaps, errors and warnings |
| `gsc_inspect_url` | Google key | Is a URL indexed? Which canonical did Google choose? |
| `ga_run_report` | Google key | Any GA4 report, e.g. engagement rate by device or landing page |
| `ga_realtime` | Google key | Last 30 minutes, to confirm your tracking tag fires |
| `bing_*` (7 tools) | Bing API key | Bing Webmaster Tools: queries, pages, daily traffic, crawl stats, crawl issues, inbound links |
| `psi_report` | PSI key (free) | **Lighthouse** scores, Core Web Vitals lab and real-user data, top failing audits |
| `seo_audit_page` | nothing | Title, meta, canonical, headings, alt text, links, Open Graph, JSON-LD, plus AEO signals |
| `seo_audit_site` | nothing | robots.txt, sitemaps, **which AI crawlers you block**, `llms.txt` |
| `trends_trending_now` | nothing | What is spiking in Google Search right now in a country, filterable to your niche |
| `seo_competitor_gaps` | nothing | Reads a competitor's public sitemap and newest articles, and lists topics they cover that you don't |
| `content_save_draft`, `content_list_drafts` | nothing | Saves article drafts as Markdown files in a local folder and lists them as a content calendar. **Nothing is published** |
| `cf_radar_domain_rank` | Cloudflare token (optional) | Cloudflare Radar popularity rank for any domain. Popularity, not a search ranking. Only listed when a token is set |
| `cf_zone_traffic` | Cloudflare token + zone ID (optional) | Daily requests, visits and bytes for a site on your Cloudflare account (30 days at most). Only listed when a token is set |

It also ships six **prompts** (ready-made workflows you can start from Claude's prompt menu) and built-in advisor instructions, so Claude ranks recommendations by impact over effort, cites the data, and doesn't promise rankings:

- `seo_health_check`: runs everything and writes a prioritised report
- `find_traffic_opportunities`: where small changes could win clicks
- `content_ideas_from_trends`: timely content ideas that fit your niche, using trends plus your Search Console data
- `competitor_content_plan`: finds a competitor's topics you haven't covered, plans one article a week, and saves reviewable drafts (never publishes)
- `aeo_check`: can AI search find, trust and cite this page?
- `performance_vs_engagement`: is a slow or heavy page driving visitors away?

## Install as a Claude Desktop extension (no folder needed)

Build a one-click bundle, then open it in Claude Desktop:

```bash
./pack.sh        # writes seo-advisor.mcpb (production dependencies only, no credentials)
open seo-advisor.mcpb
```

Claude Desktop shows an install dialog asking for your Search Console property, GA4 property ID, key files and so on, and then lists **SEO Advisor** under Settings > Extensions. The values are stored by Claude on your machine, and everything still runs locally. If you previously added `seo-advisor` by hand (e.g. `claude mcp add`), remove that entry to avoid two copies.

## Quick start

You need [Node.js](https://nodejs.org) 20 or newer and git.

```bash
git clone https://github.com/<your-github-user>/seo-advisor-mcp.git
cd seo-advisor-mcp
npm install
```

Then:

1. **Set up Google access** (about 15 minutes): [docs/google-setup.md](docs/google-setup.md). For Bing: [docs/bing-setup.md](docs/bing-setup.md)
2. **Add it to Claude** on macOS, Windows or Linux: [docs/install.md](docs/install.md)
3. Ask Claude something like:
   - "Run the `seo_health_check` prompt for https://example.com"
   - "Which queries am I ranking 4-20 for, and what should I change first?"
   - "Is my site's heavy 3D homepage hurting mobile engagement?"
   - "Can ChatGPT and Perplexity crawl my site?"

Only want the audit and Lighthouse tools? Skip step 1 except the free PageSpeed key. The page and site audits need no credentials at all.

## Configuration

All settings are environment variables, set when you register the server with Claude.

| Variable | Required | Meaning |
|---|---|---|
| `GOOGLE_APPLICATION_CREDENTIALS` | for `gsc_*`, `ga_*` | Path to your service-account JSON key |
| `GSC_SITE_URL` | optional | Default Search Console property, e.g. `sc-domain:example.com` |
| `GA_PROPERTY_ID` | optional | Default GA4 property id (digits only) |
| `BING_WEBMASTER_API_KEY` or `BING_WEBMASTER_API_KEY_FILE` | for `bing_*` | Your Bing Webmaster API key, or the path to a file that holds it (the file is safer) |
| `BING_SITE_URL` | optional | Default Bing site, e.g. `https://example.com/` |
| `TRENDS_GEO` | optional | Default country code for trends, e.g. `SG`. Defaults to `US` |
| `SEO_DRAFTS_DIR` | optional | Absolute path of the drafts folder. Defaults to `~/seo-advisor-drafts` |
| `PSI_API_KEY` | recommended | Free key for PageSpeed Insights. Without it you share an anonymous quota that is often exhausted |
| `CLOUDFLARE_API_TOKEN` | optional | Read-only Cloudflare API token. Enables `cf_radar_domain_rank` (and `cf_zone_traffic` with a zone ID). See [docs/cloudflare-setup.md](docs/cloudflare-setup.md) |
| `CLOUDFLARE_ZONE_ID` | optional | Zone ID of your own site, for `cf_zone_traffic` |

## Security

- Read-only scopes: `webmasters.readonly` and `analytics.readonly`.
- The key file stays on your disk. Keep it out of git (the included `.gitignore` helps) and give the service account the lowest role (Restricted in Search Console, Viewer in GA4).
- `seo_audit_page` and `seo_audit_site` fetch whatever URL you give them, from your machine. Point them at your own sites.
- Tool results, including your search queries and traffic numbers, are sent to Claude as part of the conversation, so treat them like anything else you paste into a chat.

## Competitor gaps and drafts: what they do and don't do

- **Do:** read the competitor's public sitemap (any site's `/sitemap.xml`), fetch their newest article pages, and compare their topics with your own pages and the Search Console queries you pass in. Drafts go to a local folder as Markdown with `status: draft` and an optional `publishOn` date, which `content_list_drafts` shows as a calendar.
- **Don't:** see the competitor's traffic or search volume (that needs a paid keyword database), publish anything, or overwrite a draft you've changed to another status. Auto-publishing is deliberately left out: Google's spam policies target mass-produced AI articles, and answer engines favour pages with real first-hand experience. The prompt asks Claude to leave `[ADD ...]` placeholders for the experience, photos and numbers only you have.
- Be polite with other people's sites: the tool reads at most 100 pages, five at a time, with an identifying user agent. Use it on sites you may reasonably read.

## Trends: what is and isn't covered

- **Covered:** Google's public "Trending Now" feed (`trends_trending_now`), which lists current spikes by country.
- **Not covered yet: keyword interest over time.** Google has no public API for it. Its official Trends API is in a small alpha by application, and the unofficial endpoints that libraries like `pytrends` use are rate-limited and often blocked (they returned HTTP 429 when tested). Support will be added once the official API is open to you, or through an optional paid provider.
- **Social platforms (TikTok, Instagram, Facebook, Xiaohongshu):** none offers a general trends API to normal accounts, so none is built in. Instagram and Facebook research data (Meta Content Library) is limited to approved researchers. TikTok's Research API is academic-only; its Creative Center trends are viewable on the web but have no official API. Xiaohongshu has no public API. Third-party scrapers exist (for example on Apify), but they are paid, can break, and may breach the platforms' terms, so they would be an opt-in adapter at your own risk.

## Roadmap

Ideas, roughly in the order they'd be most useful. Pull requests welcome.

- **Google Trends interest over time**, through the official API once it's generally available
- **Chrome UX Report API:** real-user Core Web Vitals history for any origin with enough traffic
- **Keyword and backlink data:** optional adapters for Semrush, Ahrefs or DataForSEO (paid APIs, so each stays opt-in)
- **Social trend adapters (opt-in):** TikTok, Instagram, Facebook and Xiaohongshu via a third-party data provider you choose and pay for
- **IndexNow:** submit changed URLs to Bing, Yandex and others
- **Sign in with Google (OAuth)** for the hosted connector, so users do not need a service-account key. Needs Google app verification
- **Directory listing** for the hosted connector
- **AI-visibility tracking:** whether and how answer engines cite your pages (no reliable free API yet)
- **Scheduled reports:** a weekly digest you can run from cron

## Development

```bash
npm test                 # unit tests, no network or credentials needed
npx @modelcontextprotocol/inspector node server.mjs   # try the tools in a browser UI
```

The analysis logic lives in `src/analysis/` as pure functions with tests. Tool registration is in `src/tools/`, and the advisor's instructions and prompts are in `src/prompts.mjs`.

## License

[MIT](LICENSE)
