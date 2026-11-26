# Installing in Claude (macOS, Windows, Linux)

seo-advisor-mcp is a local server that Claude starts when it needs it. Installing means two things: get the code onto your computer, then tell Claude where it is.

## 1. Get the code

Install [Node.js](https://nodejs.org) 20 or newer and [git](https://git-scm.com), then:

```bash
git clone https://github.com/<your-github-user>/seo-advisor-mcp.git
cd seo-advisor-mcp
npm install
```

Install Node however you like:

| OS | Option |
|---|---|
| macOS | `brew install node`, or the installer from nodejs.org |
| Windows | `winget install OpenJS.NodeJS.LTS`, or the installer from nodejs.org |
| Linux | your package manager (`apt`, `dnf`, `pacman`…), or [nvm](https://github.com/nvm-sh/nvm) |

Check with `node --version`. It should print `v20` or higher.

Note the **full path** to `server.mjs`. You'll need it below.

| OS | Example |
|---|---|
| macOS | `/Users/you/Developer/seo-advisor-mcp/server.mjs` |
| Linux | `/home/you/seo-advisor-mcp/server.mjs` |
| Windows | `C:\Users\you\seo-advisor-mcp\server.mjs` |

Set up your Google key and ids first if you want Search Console and GA4: [google-setup.md](google-setup.md). The page audit and site audit tools work without any of it.

## 2. Register it with Claude

Choose the app you use.

### Claude Code (all three systems)

Claude Code is the command-line version. Run one command, replacing the values.

**macOS / Linux**

```bash
claude mcp add seo-advisor --scope user \
  -e GOOGLE_APPLICATION_CREDENTIALS="$HOME/.config/seo-advisor/key.json" \
  -e GSC_SITE_URL="sc-domain:example.com" \
  -e GA_PROPERTY_ID="123456789" \
  -e PSI_API_KEY="your-pagespeed-key" \
  -e BING_WEBMASTER_API_KEY_FILE="$HOME/.config/seo-advisor/bing-api-key.txt" \
  -e BING_SITE_URL="https://example.com/" \
  -- node /full/path/to/seo-advisor-mcp/server.mjs
```

**Windows (PowerShell)**

```powershell
claude mcp add seo-advisor --scope user `
  -e GOOGLE_APPLICATION_CREDENTIALS="$env:USERPROFILE\.config\seo-advisor\key.json" `
  -e GSC_SITE_URL="sc-domain:example.com" `
  -e GA_PROPERTY_ID="123456789" `
  -e PSI_API_KEY="your-pagespeed-key" `
  -e BING_WEBMASTER_API_KEY_FILE="$env:USERPROFILE\.config\seo-advisor\bing-api-key.txt" `
  -e BING_SITE_URL="https://example.com/" `
  -- node C:\Users\you\seo-advisor-mcp\server.mjs
```

Leave out any `-e` line you don't need. `--scope user` makes it available in every project; use `--scope local` to limit it to the current one.

Check it:

```bash
claude mcp list
```

It should show `seo-advisor` as connected. Start a new Claude Code session so the tools load.

### Claude Desktop (macOS and Windows)

1. Open the config file, creating it if it doesn't exist:

   | OS | Path |
   |---|---|
   | macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
   | Windows | `%APPDATA%\Claude\claude_desktop_config.json` |

   You can also open it from Claude Desktop: **Settings → Developer → Edit Config**.

2. Add the server under `mcpServers`.

   **macOS**

   ```json
   {
     "mcpServers": {
       "seo-advisor": {
         "command": "node",
         "args": ["/Users/you/Developer/seo-advisor-mcp/server.mjs"],
         "env": {
           "GOOGLE_APPLICATION_CREDENTIALS": "/Users/you/.config/seo-advisor/key.json",
           "GSC_SITE_URL": "sc-domain:example.com",
           "GA_PROPERTY_ID": "123456789",
           "PSI_API_KEY": "your-pagespeed-key",
           "BING_WEBMASTER_API_KEY_FILE": "/Users/you/.config/seo-advisor/bing-api-key.txt",
           "BING_SITE_URL": "https://example.com/"
         }
       }
     }
   }
   ```

   **Windows** (double the backslashes in JSON)

   ```json
   {
     "mcpServers": {
       "seo-advisor": {
         "command": "node",
         "args": ["C:\\Users\\you\\seo-advisor-mcp\\server.mjs"],
         "env": {
           "GOOGLE_APPLICATION_CREDENTIALS": "C:\\Users\\you\\.config\\seo-advisor\\key.json",
           "GSC_SITE_URL": "sc-domain:example.com",
           "GA_PROPERTY_ID": "123456789",
           "PSI_API_KEY": "your-pagespeed-key",
           "BING_WEBMASTER_API_KEY_FILE": "C:\\Users\\you\\.config\\seo-advisor\\bing-api-key.txt",
           "BING_SITE_URL": "https://example.com/"
         }
       }
     }
   }
   ```

3. **Quit Claude Desktop completely** (not just close the window) and reopen it. The tools appear under the connectors/tools menu in a new chat.

If the file already has other servers, add `seo-advisor` next to them inside the same `mcpServers` object.

### Linux with Claude Desktop

At the time of writing, Anthropic does not publish an official Claude Desktop for Linux, so use **Claude Code** (above), which supports Linux fully. If you run a community build of Claude Desktop, its config usually lives at `~/.config/Claude/claude_desktop_config.json` and takes the same JSON as the macOS example.

## 3. Try it

Open a new chat and ask:

> Run an SEO health check on https://example.com

or pick the **seo_health_check** prompt from the prompt menu. Claude will ask permission the first time it uses each tool.

## Troubleshooting

**"spawn node ENOENT", or Claude Desktop can't start the server.**
Desktop apps don't always see the `node` you use in a terminal, especially if it was installed with nvm. Run `which node` (macOS/Linux) or `where node` (Windows) and put that full path in `"command"`.

**The server shows as failed.**
Run it by hand to see the error:

```bash
node /full/path/to/seo-advisor-mcp/server.mjs
```

It should sit silently waiting for input (press Ctrl+C to stop). An error message means a missing `npm install` or an old Node version.

**Try the tools without Claude.**

```bash
npx @modelcontextprotocol/inspector node /full/path/to/seo-advisor-mcp/server.mjs
```

This opens a browser UI where you can call each tool.

**Google errors** (403, empty property list, quota): see the table at the end of [google-setup.md](google-setup.md).

**Updating.**

```bash
cd seo-advisor-mcp
git pull
npm install
```

Then restart Claude Code or Claude Desktop.

**Removing.** Claude Code: `claude mcp remove seo-advisor`. Claude Desktop: delete the `seo-advisor` entry from the config file and restart.
