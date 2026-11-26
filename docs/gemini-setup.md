# Using SEO Advisor with Google Gemini & MCP Agents

SEO Advisor is built on the open **Model Context Protocol (MCP)** standard. You can connect any Gemini-powered agent (such as Google Antigravity, Gemini CLI, or other MCP-compatible agents) either locally via stdio or remotely via your hosted Cloudflare Worker.

No extra passwords or Gemini API keys are required—the hosted endpoint is public, and each user optionally brings their own Search Console / GA4 / PageSpeed / Bing credentials.

---

## Option 1: Install as an Antigravity Plugin / Skill

This repository includes a companion Skill (`skills/seo-advisor/SKILL.md`) and Antigravity plugin files (`plugin.json` + `mcp_config.json`).

* **As an Antigravity Plugin:** Copy or clone the repo into `~/.gemini/config/plugins/seo-advisor/` (global) or `<workspace>/.agents/plugins/seo-advisor/` (workspace). The plugin layout (`plugin.json`, `mcp_config.json`, `skills/`) follows the usual convention; this was not checked against a current Antigravity release, so confirm the install path in its docs. Update the placeholder URL in `mcp_config.json` to your deployed Worker URL (or point it to local `server.mjs`).
* **As a Skill only:** Copy `skills/seo-advisor/` into your project's `.agents/skills/` (or `~/.gemini/config/skills/` globally) so your agent follows the SEO/AEO workflows whenever you ask for an audit.

---

## Option 2: Local Stdio (Recommended for Personal Use with Keys)

Add `seo-advisor` to your agent's MCP configuration:

```json
{
  "mcpServers": {
    "seo-advisor": {
      "command": "node",
      "args": ["/path/to/seo-advisor-mcp/server.mjs"],
      "env": {
        "GOOGLE_APPLICATION_CREDENTIALS": "/path/to/key.json",
        "GSC_SITE_URL": "sc-domain:example.com",
        "GA_PROPERTY_ID": "123456789",
        "PSI_API_KEY": "your-pagespeed-key"
      }
    }
  }
}
```

---

## Option 3: Hosted Cloudflare Worker (Public / No-Install)

Your hosted worker supports both **Claude (via OAuth 2.1)** and **non-OAuth MCP agents (via public/header access)** on the same deployment:

### A. No-login tools
If you only need the no-login tools (`seo_audit_page`, `seo_audit_site`, `trends_trending_now`, `seo_competitor_gaps`), point your agent at `/mcp` with the `X-Client: gemini` header (replace `<your-subdomain>` with your Cloudflare Workers subdomain):

```json
{
  "mcpServers": {
    "seo-advisor": {
      "url": "https://seo-advisor.<your-subdomain>.workers.dev/mcp",
      "headers": {
        "X-Client": "gemini"
      }
    }
  }
}
```

### B. Bring Your Own Keys (via Headers)
To also use Search Console, GA4, PageSpeed Insights, or Bing Webmaster Tools on the hosted endpoint (`/mcp`), configure your agent to pass your own credentials in request headers:

```json
{
  "mcpServers": {
    "seo-advisor": {
      "url": "https://seo-advisor.<your-subdomain>.workers.dev/mcp",
      "headers": {
        "X-Client": "gemini",
        "X-Google-Key": "<base64-encoded-service-account-json>",
        "X-PSI-Key": "<your-pagespeed-key>",
        "X-Bing-Key": "<your-bing-key>"
      }
    }
  }
}
```

*(All credential headers are optional—only include the ones you use. Each caller is rate-limited per IP, so users sharing a NAT IP share that rate-limit budget.)*

---

## Does this affect Claude?

**No.** Claude users continue to connect to `/mcp` without any custom headers, which triggers the standard OAuth 2.1 `/authorize` flow where users paste their keys once.
