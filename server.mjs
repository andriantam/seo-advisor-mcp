#!/usr/bin/env node
// seo-advisor-mcp: an MCP server that makes Claude an SEO, AEO and performance advisor.
// Runs locally over stdio. See README.md for setup.

import { cleanEnv } from "./src/env.mjs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerGoogleTools } from "./src/tools/google.mjs";
import { registerWebTools } from "./src/tools/web.mjs";
import { registerBingTools } from "./src/tools/bing.mjs";
import { registerContentTools } from "./src/tools/content.mjs";
import { registerCloudflareTools } from "./src/tools/cloudflare.mjs";
import { registerPrompts, instructions } from "./src/prompts.mjs";
import { localContext } from "./src/ctx.mjs";

cleanEnv();

const server = new McpServer({ name: "seo-advisor", version: "0.1.0" }, { instructions: instructions({ remote: false }) });

const ctx = localContext();
const getCtx = () => ctx;

registerGoogleTools(server, getCtx);
registerWebTools(server, getCtx);
registerBingTools(server, getCtx);
registerContentTools(server, getCtx, { drafts: true });
registerCloudflareTools(server, getCtx); // optional: only when CLOUDFLARE_API_TOKEN is set
registerPrompts(server);

await server.connect(new StdioServerTransport());
