import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeHtml, parseRobots, isFullyBlocked } from "../src/analysis/audit.mjs";

const ids = (r) => r.findings.map((f) => f.id);

const GOOD = `<!doctype html><html lang="en"><head>
<title>Night driving a Acme Widget through mountain passes</title>
<meta name="description" content="A first-hand account of driving a blue Acme Widget at night through mountain passes, with photos, settings and route notes for photographers.">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="canonical" href="https://example.com/widget">
<meta property="og:title" content="x"><meta property="og:description" content="x"><meta property="og:image" content="x">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[
 {"@type":"Person","name":"A"},
 {"@type":"Article","headline":"h","datePublished":"2026-01-01","author":{"@type":"Person","name":"A"}}]}</script>
</head><body><h1>Night driving</h1><h2>How do I shoot a moving car?</h2>
<a href="/a">a</a><a href="/b">b</a><a href="/c">c</a><img src="x.jpg" alt="car">
<p>${"word ".repeat(400)}</p></body></html>`;

test("a well-formed page has no high or medium findings", () => {
  const r = analyzeHtml(GOOD, "https://example.com/widget");
  const bad = r.findings.filter((f) => f.severity === "high" || f.severity === "medium");
  assert.deepEqual(bad, []);
  assert.deepEqual(r.facts.structuredDataTypes.sort(), ["Article", "Person"]);
});

test("flags missing basics", () => {
  const r = analyzeHtml("<html><head></head><body><p>hi</p></body></html>", "https://example.com/");
  for (const id of ["title-missing", "meta-description-missing", "canonical-missing", "viewport-missing", "h1-missing", "jsonld-missing"]) {
    assert.ok(ids(r).includes(id), `expected ${id}`);
  }
});

test("flags noindex", () => {
  const r = analyzeHtml('<html><head><meta name="robots" content="noindex,follow"></head><body></body></html>', "https://example.com/");
  assert.ok(ids(r).includes("noindex"));
});

test("flags Article schema without date or author, and invalid JSON-LD", () => {
  const html = `<html><head><title>t</title><script type="application/ld+json">{"@type":"Article","headline":"h"}</script><script type="application/ld+json">{oops</script></head><body></body></html>`;
  const r = analyzeHtml(html, "https://example.com/");
  assert.ok(ids(r).includes("aeo-article-date"));
  assert.ok(ids(r).includes("aeo-article-author"));
  assert.ok(ids(r).includes("jsonld-invalid"));
});

const ROBOTS = `
User-agent: *
Disallow: /private/

User-agent: GPTBot
User-agent: CCBot
Disallow: /

User-agent: ClaudeBot
Allow: /

Sitemap: https://example.com/sitemap.xml
`;

test("parses robots.txt groups and sitemaps", () => {
  const p = parseRobots(ROBOTS);
  assert.equal(p.groups.length, 3);
  assert.deepEqual(p.sitemaps, ["https://example.com/sitemap.xml"]);
});

test("detects fully blocked bots, including grouped user-agents", () => {
  const p = parseRobots(ROBOTS);
  assert.equal(isFullyBlocked(p, "GPTBot"), true);
  assert.equal(isFullyBlocked(p, "CCBot"), true);
  assert.equal(isFullyBlocked(p, "ClaudeBot"), false);
  assert.equal(isFullyBlocked(p, "PerplexityBot"), false); // falls back to * which only blocks /private/
});

test("treats Disallow: / under * as blocking everything", () => {
  assert.equal(isFullyBlocked(parseRobots("User-agent: *\nDisallow: /"), "Googlebot"), true);
});
