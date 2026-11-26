import { test } from "node:test";
import assert from "node:assert/strict";
import { tokens, slugTokens, parseSitemapXml, looksLikeContent, summarisePage, findGaps, fetchSitemapUrls, competitorGaps } from "../src/analysis/competitor.mjs";

test("tokens drop stop words and short words", () => {
  assert.deepEqual(tokens("How to Change the Fog Lamp on a Gadget"), ["change", "fog", "lamp", "gadget"]);
});

test("slugTokens reads the last path segment", () => {
  assert.deepEqual(slugTokens("https://x.com/blog/how-to-change-fog-lamp"), ["change", "fog", "lamp"]);
  assert.deepEqual(slugTokens("not a url"), []);
});

test("parses a urlset and a sitemap index", () => {
  const set = parseSitemapXml(`<urlset><url><loc>https://x.com/a-b</loc><lastmod>2026-01-02</lastmod></url><url><loc>https://x.com/c-d</loc></url></urlset>`);
  assert.deepEqual(set.urls, [{ loc: "https://x.com/a-b", lastmod: "2026-01-02" }, { loc: "https://x.com/c-d", lastmod: null }]);
  const idx = parseSitemapXml(`<sitemapindex><sitemap><loc>https://x.com/s1.xml</loc></sitemap></sitemapindex>`);
  assert.deepEqual(idx.sitemaps, ["https://x.com/s1.xml"]);
});

test("looksLikeContent filters home, tags and files", () => {
  const o = "https://x.com";
  assert.equal(looksLikeContent("https://x.com/", o), false);
  assert.equal(looksLikeContent("https://x.com/tag/cars", o), false);
  assert.equal(looksLikeContent("https://x.com/img/photo-one.jpg", o), false);
  assert.equal(looksLikeContent("https://x.com/blog/best-lens-for-cars", o), true);
  assert.equal(looksLikeContent("https://other.com/blog/best-lens-for-cars", o), false);
});

test("summarisePage reads title, h1 and h2s", () => {
  const s = summarisePage("<html><head><title>T</title></head><body><main><h1>Big  one</h1><h2>A</h2><h2>B</h2><p>one two three</p></main></body></html>");
  assert.equal(s.title, "T");
  assert.equal(s.h1, "Big one");
  assert.deepEqual(s.headings, ["A", "B"]);
});

test("findGaps marks covered, partly covered and gap", () => {
  const own = [{ label: "https://me.com/change-fog-lamp-gadget", tokens: ["change", "fog", "lamp", "gadget"] }];
  const out = findGaps(
    [
      { url: "https://x.com/a", h1: "Change fog lamp Gadget" },
      { url: "https://x.com/b", h1: "Gadget fog bulb replacement" },
      { url: "https://x.com/c", h1: "Tyre pressure guide" },
    ],
    own,
  );
  assert.deepEqual(out.map((p) => p.status), ["covered", "partly covered", "gap"]);
});

const page = (title, h1) => `<html><head><title>${title}</title></head><body><main><h1>${h1}</h1><h2>Steps</h2><p>${"word ".repeat(50)}</p></main></body></html>`;
const fake = (map) => async (url) => (url in map ? { ok: true, status: 200, text: map[url] } : { ok: false, status: 404, text: "" });

test("fetchSitemapUrls follows an index and reports a missing sitemap", async () => {
  const f = fake({
    "https://x.com/sitemap.xml": `<sitemapindex><sitemap><loc>https://x.com/s1.xml</loc></sitemap></sitemapindex>`,
    "https://x.com/s1.xml": `<urlset><url><loc>https://x.com/blog/one-two</loc></url></urlset>`,
  });
  const r = await fetchSitemapUrls("x.com", { fetchText: f });
  assert.equal(r.origin, "https://x.com");
  assert.equal(r.urls.length, 1);
  await assert.rejects(fetchSitemapUrls("https://nope.com", { fetchText: fake({}) }), /No sitemap found/);
});

test("competitorGaps reports gaps newest first", async () => {
  const f = fake({
    "https://rival.com/sitemap.xml": `<urlset><url><loc>https://rival.com/blog/change-fog-lamp-gadget</loc><lastmod>2026-01-01</lastmod></url><url><loc>https://rival.com/blog/tyre-pressure-guide</loc><lastmod>2026-03-01</lastmod></url></urlset>`,
    "https://rival.com/blog/change-fog-lamp-gadget": page("Fog lamp", "Change fog lamp Gadget"),
    "https://rival.com/blog/tyre-pressure-guide": page("Tyres", "Tyre pressure guide"),
    "https://me.com/sitemap.xml": `<urlset><url><loc>https://me.com/articles/change-fog-lamp-gadget</loc></url></urlset>`,
  });
  const r = await competitorGaps({ competitor: "https://rival.com", ownSite: "https://me.com", fetchText: f });
  assert.equal(r.gaps.length, 1);
  assert.equal(r.gaps[0].url, "https://rival.com/blog/tyre-pressure-guide");
  assert.equal(r.alreadyCovered.length, 1);
  assert.match(r.notes[0], /not available/);
});
