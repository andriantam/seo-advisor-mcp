// On-page and site-level SEO + AEO (answer-engine optimisation) checks. No credentials needed.

import * as cheerio from "cheerio";
import { safeFetch, assertPublicUrl } from "../safe-fetch.mjs";

const UA = "seo-advisor-mcp/0.1 (site audit)";
const TIMEOUT_MS = 15000;

/** AI crawlers worth knowing about. Blocking them removes you from that engine's answers. */
export const AI_BOTS = [
  { ua: "GPTBot", owner: "OpenAI (training)" },
  { ua: "OAI-SearchBot", owner: "OpenAI (ChatGPT search)" },
  { ua: "ChatGPT-User", owner: "OpenAI (user-triggered browsing)" },
  { ua: "ClaudeBot", owner: "Anthropic (training)" },
  { ua: "Claude-SearchBot", owner: "Anthropic (search)" },
  { ua: "Claude-User", owner: "Anthropic (user-triggered)" },
  { ua: "PerplexityBot", owner: "Perplexity" },
  { ua: "Google-Extended", owner: "Google (Gemini training opt-out token)" },
  { ua: "Applebot-Extended", owner: "Apple (Apple Intelligence opt-out token)" },
  { ua: "CCBot", owner: "Common Crawl (feeds many AI datasets)" },
];

const finding = (id, severity, message, fix) => ({ id, severity, message, ...(fix ? { fix } : {}) });

async function fetchText(url) {
  const res = await safeFetch(url, { timeoutMs: TIMEOUT_MS, headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,text/plain,*/*" } });
  return { res, text: res.text };
}

const assertHttp = assertPublicUrl;

function flattenJsonLd(value, out = []) {
  if (Array.isArray(value)) value.forEach((v) => flattenJsonLd(v, out));
  else if (value && typeof value === "object") {
    out.push(value);
    if (value["@graph"]) flattenJsonLd(value["@graph"], out);
  }
  return out;
}

const asArray = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

/** Analyse one page's HTML. Exported separately so it can be tested without the network. */
export function analyzeHtml(html, pageUrl) {
  const $ = cheerio.load(html);
  const findings = [];
  const url = new URL(pageUrl);

  const title = $("head > title").first().text().trim();
  const description = $('meta[name="description"]').attr("content")?.trim() || "";
  const canonical = $('link[rel="canonical"]').attr("href")?.trim() || "";
  const robotsMeta = ($('meta[name="robots"]').attr("content") || "").toLowerCase();
  const lang = $("html").attr("lang") || "";
  const viewport = $('meta[name="viewport"]').attr("content") || "";
  const h1s = $("h1").map((_, e) => $(e).text().trim().replace(/\s+/g, " ")).get();
  const headings = $("h2, h3").map((_, e) => $(e).text().trim().replace(/\s+/g, " ")).get();
  const images = $("img").toArray();
  const noAlt = images.filter((i) => $(i).attr("alt") === undefined).length;

  const bodyText = $("body").clone().find("script,style,noscript").remove().end().text().replace(/\s+/g, " ").trim();
  const wordCount = bodyText ? bodyText.split(" ").length : 0;

  let internal = 0;
  let external = 0;
  $("a[href]").each((_, a) => {
    const href = $(a).attr("href");
    if (!href || href.startsWith("#") || /^(mailto|tel|javascript):/i.test(href)) return;
    try {
      new URL(href, url).hostname === url.hostname ? internal++ : external++;
    } catch {
      /* ignore malformed href */
    }
  });

  // Structured data
  const jsonLdNodes = [];
  let jsonLdInvalid = 0;
  $('script[type="application/ld+json"]').each((_, s) => {
    try {
      flattenJsonLd(JSON.parse($(s).html() || ""), jsonLdNodes);
    } catch {
      jsonLdInvalid++;
    }
  });
  const types = [...new Set(jsonLdNodes.flatMap((n) => asArray(n["@type"])))];
  const has = (t) => types.includes(t);
  const articleNodes = jsonLdNodes.filter((n) => asArray(n["@type"]).some((t) => /Article|BlogPosting|NewsArticle/.test(t)));

  const og = {
    title: !!$('meta[property="og:title"]').attr("content"),
    description: !!$('meta[property="og:description"]').attr("content"),
    image: !!$('meta[property="og:image"]').attr("content"),
  };
  const questionHeadings = headings.filter((h) => /\?$|^(how|what|why|when|where|who|which|can|does|is|are)\b/i.test(h));

  // ---- findings ----
  if (!title) findings.push(finding("title-missing", "high", "No <title> tag.", "Add a unique, descriptive title of about 30-60 characters."));
  else if (title.length < 30 || title.length > 60)
    findings.push(finding("title-length", "low", `Title is ${title.length} characters (about 30-60 displays fully).`, "Tighten or expand it; put the main topic first."));

  if (!description) findings.push(finding("meta-description-missing", "medium", "No meta description.", "Write a 70-160 character summary that earns the click."));
  else if (description.length < 70 || description.length > 160)
    findings.push(finding("meta-description-length", "low", `Meta description is ${description.length} characters (about 70-160 is typical).`));

  if (!canonical) findings.push(finding("canonical-missing", "medium", "No canonical link.", "Add <link rel=\"canonical\"> pointing at the preferred URL."));
  else {
    try {
      const c = new URL(canonical, url);
      if (c.origin + c.pathname.replace(/\/$/, "") !== url.origin + url.pathname.replace(/\/$/, ""))
        findings.push(finding("canonical-differs", "info", `Canonical points to ${c.href}, not this URL.`, "Fine if intended (duplicates); otherwise fix it."));
    } catch {
      findings.push(finding("canonical-invalid", "medium", `Canonical is not a valid URL: ${canonical}`));
    }
  }

  if (/noindex/.test(robotsMeta)) findings.push(finding("noindex", "high", "Page has a noindex robots meta tag, so it will not appear in search.", "Remove noindex if the page should rank."));
  if (!viewport) findings.push(finding("viewport-missing", "high", "No viewport meta tag; the page is not mobile-friendly.", "Add <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">."));
  if (!lang) findings.push(finding("lang-missing", "low", "<html> has no lang attribute.", "Set lang=\"en\" (or your language)."));

  if (h1s.length === 0) findings.push(finding("h1-missing", "medium", "No <h1> heading.", "Add one h1 describing the page topic."));
  else if (h1s.length > 1) findings.push(finding("h1-multiple", "low", `${h1s.length} <h1> headings.`, "Keep a single h1 and use h2/h3 for sections."));

  if (images.length && noAlt / images.length > 0.2)
    findings.push(finding("img-alt", "medium", `${noAlt} of ${images.length} images have no alt attribute.`, "Describe each meaningful image; helps accessibility and Google Images."));

  if (wordCount < 300) findings.push(finding("thin-content", "low", `Only about ${wordCount} words of visible text.`, "Fine for galleries or tools; articles usually need more depth."));
  if (internal < 3) findings.push(finding("few-internal-links", "low", `Only ${internal} internal links.`, "Link to related pages so crawlers and readers can move around."));

  if (!og.title || !og.description || !og.image)
    findings.push(finding("open-graph", "low", "Open Graph tags incomplete (title, description or image missing).", "Complete them for better link previews, which also feed AI and social cards."));

  // Structured data and AEO
  if (jsonLdNodes.length === 0)
    findings.push(finding("jsonld-missing", "medium", "No JSON-LD structured data.", "Add schema.org JSON-LD (WebSite, Person/Organization, Article, ImageObject, FAQPage as relevant)."));
  if (jsonLdInvalid) findings.push(finding("jsonld-invalid", "high", `${jsonLdInvalid} JSON-LD block(s) failed to parse.`, "Fix the JSON syntax; invalid blocks are ignored."));
  if (jsonLdNodes.length && !has("Person") && !has("Organization"))
    findings.push(finding("aeo-entity", "low", "No Person or Organization entity in the structured data.", "Declare who is behind the site so engines can attribute and trust the content."));
  for (const a of articleNodes) {
    if (!a.datePublished) findings.push(finding("aeo-article-date", "medium", "Article schema lacks datePublished.", "Add datePublished and dateModified; freshness is a ranking and citation signal."));
    if (!a.author) findings.push(finding("aeo-article-author", "medium", "Article schema lacks author.", "Add a named author (Person) to support E-E-A-T."));
  }
  if (articleNodes.length && questionHeadings.length === 0)
    findings.push(finding("aeo-question-headings", "info", "No question-style headings found.", "Answer engines favour pages that pose a clear question and answer it directly in the first sentence beneath."));

  return {
    url: pageUrl,
    facts: {
      title,
      titleLength: title.length,
      metaDescription: description,
      metaDescriptionLength: description.length,
      canonical,
      lang,
      h1: h1s,
      h2h3Count: headings.length,
      questionHeadings: questionHeadings.length,
      images: images.length,
      imagesWithoutAlt: noAlt,
      wordCount,
      internalLinks: internal,
      externalLinks: external,
      structuredDataTypes: types,
      openGraph: og,
    },
    findings,
  };
}

/** Parse robots.txt into groups of { agents, rules }. */
export function parseRobots(text) {
  const groups = [];
  const sitemaps = [];
  let current = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === "sitemap") sitemaps.push(value);
    else if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    } else if ((key === "allow" || key === "disallow") && current) current.rules.push({ type: key, path: value });
    lastWasAgent = false;
  }
  return { groups, sitemaps };
}

/** True when the named bot is fully blocked from the site root. */
export function isFullyBlocked(parsed, ua) {
  const name = ua.toLowerCase();
  const group = parsed.groups.find((g) => g.agents.includes(name)) || parsed.groups.find((g) => g.agents.includes("*"));
  if (!group) return false;
  const disallowAll = group.rules.some((r) => r.type === "disallow" && r.path === "/");
  const allowAll = group.rules.some((r) => r.type === "allow" && r.path === "/");
  return disallowAll && !allowAll;
}

export async function auditPage(url) {
  assertHttp(url);
  const { res, text } = await fetchText(url);
  const result = analyzeHtml(text, res.url);
  result.http = { status: res.status, finalUrl: res.url, redirected: res.redirected, contentType: res.headers.get("content-type") };
  if (!res.ok) result.findings.unshift(finding("http-status", "high", `Page returned HTTP ${res.status}.`));
  const xrobots = res.headers.get("x-robots-tag");
  if (xrobots && /noindex/i.test(xrobots)) result.findings.unshift(finding("x-robots-noindex", "high", `X-Robots-Tag header says: ${xrobots}`));
  return result;
}

export async function auditSite(siteUrl) {
  const origin = assertHttp(siteUrl).origin;
  const findings = [];
  const out = { origin, robots: null, sitemaps: [], llmsTxt: null, aiCrawlers: [], findings };

  try {
    const { res, text } = await fetchText(`${origin}/robots.txt`);
    if (!res.ok) {
      findings.push(finding("robots-missing", "low", `robots.txt returned HTTP ${res.status}.`, "Add a robots.txt that links your sitemap."));
    } else {
      const parsed = parseRobots(text);
      out.robots = { status: res.status, groups: parsed.groups.length, sitemapsDeclared: parsed.sitemaps };
      if (!parsed.sitemaps.length) findings.push(finding("robots-no-sitemap", "medium", "robots.txt does not declare a Sitemap.", "Add a 'Sitemap: https://…/sitemap-index.xml' line."));
      if (isFullyBlocked(parsed, "Googlebot") || isFullyBlocked(parsed, "*"))
        findings.push(finding("robots-blocks-all", "high", "robots.txt blocks the whole site for Googlebot or all crawlers.", "Remove 'Disallow: /' unless the site is meant to be private."));
      out.aiCrawlers = AI_BOTS.map((b) => ({ ...b, blocked: isFullyBlocked(parsed, b.ua) }));
      const blocked = out.aiCrawlers.filter((b) => b.blocked);
      if (blocked.length)
        findings.push(finding("aeo-ai-bots-blocked", "info", `robots.txt blocks: ${blocked.map((b) => b.ua).join(", ")}.`, "Blocking search-type bots (OAI-SearchBot, Claude-SearchBot, PerplexityBot) keeps you out of those answers. Training bots are a separate, personal choice."));
      for (const sm of parsed.sitemaps.slice(0, 3)) {
        try {
          const r = await safeFetch(sm, { timeoutMs: TIMEOUT_MS, maxBytes: 200_000, headers: { "user-agent": UA } });
          out.sitemaps.push({ url: sm, status: r.status });
          if (!r.ok) findings.push(finding("sitemap-unreachable", "high", `Declared sitemap ${sm} returned HTTP ${r.status}.`));
        } catch (e) {
          out.sitemaps.push({ url: sm, error: String(e.message || e) });
        }
      }
    }
  } catch (e) {
    findings.push(finding("robots-error", "medium", `Could not fetch robots.txt: ${e.message || e}`));
  }

  try {
    const r = await safeFetch(`${origin}/llms.txt`, { timeoutMs: TIMEOUT_MS, maxBytes: 200_000, headers: { "user-agent": UA } });
    out.llmsTxt = { status: r.status };
    if (!r.ok)
      findings.push(finding("aeo-llms-txt", "info", "No /llms.txt.", "Optional and unproven: a plain-text map of your best pages for AI tools. Cheap to add, but don't expect measurable gains."));
  } catch {
    out.llmsTxt = { status: null };
  }

  return out;
}
