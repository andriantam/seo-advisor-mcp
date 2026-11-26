import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTrendingRss, filterTrends } from "../src/analysis/trends.mjs";

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:ht="https://trends.google.com/trending/rss" version="2.0"><channel>
<item><title>acme widget sti</title><ht:approx_traffic>500+</ht:approx_traffic><pubDate>Sat, 21 Nov 2026 21:50:00 -0800</pubDate>
 <ht:news_item><ht:news_item_title>New Widget revealed</ht:news_item_title><ht:news_item_source>Tech Mag</ht:news_item_source><ht:news_item_url>https://example.com/a</ht:news_item_url></ht:news_item>
 <ht:news_item><ht:news_item_title>Widget pricing</ht:news_item_title><ht:news_item_source>Auto</ht:news_item_source><ht:news_item_url>https://example.com/b</ht:news_item_url></ht:news_item>
</item>
<item><title>miley cyrus</title><ht:approx_traffic>100+</ht:approx_traffic><pubDate>Sat, 21 Nov 2026 20:00:00 -0800</pubDate>
 <ht:news_item><ht:news_item_title>Wedding rehearsal</ht:news_item_title><ht:news_item_source>Page Six</ht:news_item_source><ht:news_item_url>https://example.com/c</ht:news_item_url></ht:news_item>
</item></channel></rss>`;

test("parses topics, traffic buckets and news items from the feed", () => {
  const t = parseTrendingRss(XML);
  assert.equal(t.length, 2);
  assert.equal(t[0].topic, "acme widget sti");
  assert.equal(t[0].approxSearches, "500+");
  assert.equal(t[0].news.length, 2);
  assert.equal(t[0].news[0].source, "Tech Mag");
});

test("filters by topic or headline words", () => {
  const t = parseTrendingRss(XML);
  assert.deepEqual(filterTrends(t, ["widget"]).map((x) => x.topic), ["acme widget sti"]);
  assert.deepEqual(filterTrends(t, ["wedding"]).map((x) => x.topic), ["miley cyrus"]);
  assert.equal(filterTrends(t, []).length, 2);
});

import { parseGeos } from "../src/analysis/trends.mjs";
test("parseGeos accepts several separators and dedupes", () => {
  assert.deepEqual(parseGeos("MY, sg;MY  GB"), ["MY", "SG", "GB"]);
});
