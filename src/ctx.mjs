// Per-user context handed to every tool, so the same tool code serves two hosts:
//   local  (stdio, the .mcpb):   credentials come from environment variables
//   remote (Cloudflare Worker):  credentials come from the user's encrypted connection
//
// A context never holds anything global. Sources that are not set up throw a plain-language error
// only when a tool that needs them is called.

import fs from "node:fs";
import { createGoogleClient } from "./google.mjs";

export const NOT_SET_UP = {
  google: "Google (Search Console / GA4) is not set up for this connection. Reconnect and add the Google service-account key, or see the README for how to create one.",
  bing: "Bing Webmaster is not set up for this connection. Reconnect and add a Bing Webmaster API key (Bing Webmaster Tools > Settings > API access).",
  cloudflare: "Cloudflare is not set up for this connection. Reconnect and add a Cloudflare API token, or set CLOUDFLARE_API_TOKEN locally.",
  cloudflareZone: "No Cloudflare zone ID. Pass zoneId, or set the zone ID when you connect (or CLOUDFLARE_ZONE_ID locally). The zone ID is on the site's Overview page in the Cloudflare dashboard.",
};

/** Build a context from plain values. `google` is a service-account key (object or JSON text). */
export function makeContext({ google, psiKey = "", bingKey = "", cloudflareToken = "", cloudflareZoneId = "", defaults = {} } = {}) {
  const val = (v) => (typeof v === "function" ? v() : v);
  let client;
  return {
    defaults,
    psiKey: () => val(psiKey) || "",
    google() {
      if (client) return client;
      const key = val(google);
      if (!key) throw new Error(NOT_SET_UP.google);
      return (client = createGoogleClient(key));
    },
    bingKey() {
      const key = val(bingKey);
      if (!key) throw new Error(NOT_SET_UP.bing);
      return key;
    },
    /** Cloudflare is optional: tools are only registered when this is true. */
    hasCloudflare: () => Boolean(val(cloudflareToken)),
    cloudflareToken() {
      const t = val(cloudflareToken);
      if (!t) throw new Error(NOT_SET_UP.cloudflare);
      return String(t).trim();
    },
    /** The zone ID for your own site: the argument wins, then the connection's default. */
    cloudflareZone(zoneArg) {
      const z = String(zoneArg || val(cloudflareZoneId) || "").trim();
      if (!z) throw new Error(NOT_SET_UP.cloudflareZone);
      return z;
    },
  };
}

/** Context for the local stdio server, read from environment variables. */
export function localContext(env = process.env) {
  const read = (file, what) => {
    try {
      return fs.readFileSync(file, "utf8");
    } catch (err) {
      throw new Error(`Could not read the ${what} file (${err?.code ?? "error"}). The setting must be a path to a file.`);
    }
  };
  return makeContext({
    google: () => (env.GOOGLE_APPLICATION_CREDENTIALS ? read(env.GOOGLE_APPLICATION_CREDENTIALS, "Google key") : ""),
    psiKey: env.PSI_API_KEY || "",
    bingKey: () => env.BING_WEBMASTER_API_KEY?.trim() || (env.BING_WEBMASTER_API_KEY_FILE ? read(env.BING_WEBMASTER_API_KEY_FILE, "Bing key").trim() : ""),
    cloudflareToken: () => env.CLOUDFLARE_API_TOKEN?.trim() || (env.CLOUDFLARE_API_TOKEN_FILE ? read(env.CLOUDFLARE_API_TOKEN_FILE, "Cloudflare token").trim() : ""),
    cloudflareZoneId: env.CLOUDFLARE_ZONE_ID?.trim() || "",
    defaults: {
      gscSite: env.GSC_SITE_URL || "",
      gaProperty: (env.GA_PROPERTY_ID || "").replace(/^properties\//, ""),
      bingSite: env.BING_SITE_URL || "",
      trendsGeo: env.TRENDS_GEO || "US",
    },
  });
}
