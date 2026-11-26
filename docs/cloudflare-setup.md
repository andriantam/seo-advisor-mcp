# Cloudflare setup (optional)

Cloudflare is optional. Skip this page if you don't use Cloudflare. Without a token, the Cloudflare tools are not offered at all.

There are two tools, and they need different setups:

| Tool | Needs | Works for |
|---|---|---|
| `cf_radar_domain_rank` | an API token | any domain, even one not on Cloudflare |
| `cf_zone_traffic` | an API token **and** a zone ID | a site on your Cloudflare account |

## 1. Create a read-only API token

1. Open the Cloudflare dashboard, go to **My Profile > API Tokens**, and choose **Create Token**.
2. Start from a custom token. Give it read access only: **Account Analytics: Read** (or **Zone Analytics: Read**) for the zone you use, and read access to Radar if the dashboard offers it separately. Don't grant edit permissions.
3. Copy the token once. Cloudflare won't show it again.

Radar may be available with a narrower permission than the one above. If `cf_radar_domain_rank` returns a permission error, check the token's permissions in the dashboard.

## 2. Find the zone ID (only for `cf_zone_traffic`)

Open the site in the Cloudflare dashboard. The **Zone ID** is on the Overview page, in the right-hand column.

## 3. Add it to the connector

- **Hosted connector:** on the connect page, paste the token in the *Cloudflare (optional)* section and, if you have one, the zone ID. The page tests the token before connecting.
- **Local (Claude Desktop extension):** fill in *Cloudflare API token* and *Cloudflare zone ID* in the extension settings.
- **Local (Node):** set `CLOUDFLARE_API_TOKEN` (or `CLOUDFLARE_API_TOKEN_FILE`, a path to a file holding the token) and `CLOUDFLARE_ZONE_ID`.

## Limits and what the data means

- **Radar rank** is Cloudflare's popularity ranking across its network. It is not a search ranking. Exact ranks are only given for the top 100 domains. Other domains get a bucket such as "top 200k".
- **Zone traffic** covers about the last 31 days. The tool caps the window at 30 days. The newest day is partial. Cloudflare limits how many queries one token can make in a short window, so don't loop over many zones.

## Verifying the API shapes

The Radar and GraphQL response shapes in this code come from Cloudflare's public docs. The GraphQL query was checked against the docs' hourly example. Before relying on it, run `cf_zone_traffic` and `cf_radar_domain_rank` once with a real token and compare the output with the dashboard. If a field name differs, fix it in `src/analysis/cloudflare.mjs`.
