# Using SEO Advisor as a Claude connector (hosted)

This is for people using a **hosted** SEO Advisor server (a URL someone runs for you, or one you deploy yourself: see [self-hosting.md](self-hosting.md)). It works on claude.ai, the desktop app and, once added, on your phone. Nothing to install.

Everything is read-only. The server cannot change your site, Search Console, Analytics or Bing account.

## 1. Add the connector

1. In Claude, open **Settings → Connectors** (on the web or desktop app) and choose **Add custom connector**.
2. Name it `SEO Advisor` and paste the server address, ending in `/mcp`, for example `https://seo-advisor.example.workers.dev/mcp`.
3. Click **Connect**. Claude opens the SEO Advisor **connect page** in your browser.

On Team and Enterprise plans an owner may need to add the connector for the organisation first. Custom connectors are added on web or desktop and then appear in the mobile app under the same account.

## 2. Fill in the connect page

Everything on the page is **optional**. Add only what you use.

| You want | Fill in | How to get it |
|---|---|---|
| Site audits, AEO checks, competitor gaps, trends | nothing | works straight away |
| PageSpeed / Lighthouse | PageSpeed API key (effectively required: without one you share Google's anonymous quota, which is usually used up) | [google-setup.md](google-setup.md), step 3 |
| Search Console and GA4 | Google service-account key (JSON) | [google-setup.md](google-setup.md) |
| Bing Webmaster data | Bing API key | [bing-setup.md](bing-setup.md) |

Google does **not** accept a plain API key for your Search Console or GA4 data, so the Google field takes a service-account key; the page accepts the whole JSON (paste it or choose the file). Bing and PageSpeed use ordinary API keys. When you click **Check and connect** the page tests each key and shows what it can see, then sends you back to Claude.

Your keys are stored **encrypted** and are used only to read data when you ask Claude a question. Nothing else is stored: no tool inputs, outputs or logs.

> Never paste keys into the chat. The chat is not a safe place for secrets; the connect page is the only place that needs them.

## 3. Your sites must already be set up

The server can only read a site that is already **added and verified** in the account behind your keys.

- **Search Console:** add your domain as a property and verify it (a *Domain* property with a DNS TXT record is the most reliable). Then add the service account's email (the `client_email` in the key file) under **Settings → Users and permissions**.
- **GA4:** add the same email under **Admin → Property access management** with the **Viewer** role.
- **Bing:** add the site in Bing Webmaster Tools (importing from Search Console is quickest) and verify it. The API key belongs to that Bing account.

Not sure where you are? Ask Claude to run the **onboarding** prompt, or just say *"help me set up example.com for SEO Advisor"*. It checks what is already connected and walks you through only the missing steps.

## 4. Using it

You never configure a site in the connector. **Tell Claude which site you mean** each time, for example *"Check search performance for example.com over the last 28 days."*

- **GA4 property ID:** each site has its own. The first time you analyse a site Claude will ask for the property ID (or look it up with `ga_list_properties` and let you pick), then reuse it for the rest of that conversation. In a new conversation it may ask again; keep the ID handy (GA4 → Admin → Property details).
- Search Console sites can be written as `example.com` (treated as a Domain property), `sc-domain:example.com`, or a full `https://example.com/` URL.
- Draft articles are written in the chat; nothing is saved on the server.

## Limits

To keep the service fair and safe there are approximate limits (Cloudflare counts them per location): about 60 tool calls per minute per connection, and about 10 per minute for the tools that fetch many pages (`seo_audit_site`, `seo_audit_page`, `seo_competitor_gaps`, `psi_report`). Pages are fetched only from public websites (no private or internal addresses), with a size and time cap, and the competitor tool only reads pages that site's `robots.txt` allows.

## Changing or removing your keys

- **Change keys:** remove the connector in Claude and add it again, then fill the page with the new keys.
- **Disconnect:** remove the connector in Claude. A connection that is not used for 90 days is also deleted automatically, together with its stored keys.
- Rotate or delete a key at the source (Google Cloud Console, Bing Webmaster Tools) at any time; that stops it working everywhere immediately.

## Troubleshooting

| Message | Meaning |
|---|---|
| "…is not set up for this connection" | You left that source blank on the connect page. Reconnect and add it. |
| Google API 403 on Search Console | The service-account email is not added to that property, or the Search Console API is not enabled in your Google Cloud project. |
| Google API 403 on GA4 | The email is not a Viewer on that property, or the Analytics Data API is not enabled. |
| `ga_list_properties` fails | Enable the **Google Analytics Admin API** in the same Google Cloud project. |
| Bing `InvalidApiKey` | Wrong key, or one generated in a different Bing account. |
| Bing `ThrottleIP` | Bing limits requests per server IP address, and a hosted server (Cloudflare) shares addresses with others. The server retries twice automatically, and the connect page still saves your key if it cannot test it. In testing (Nov 2026) this was throttled most of the time on the hosted server, while the same key worked from a home computer. If you need Bing data, use the local `.mcpb` build. Everything else is unaffected. |
| "Rate limit reached" | Wait a minute. |
