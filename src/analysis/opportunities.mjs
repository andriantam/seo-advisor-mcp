// Turns raw Search Console rows (dimensions: query, page) into prioritised SEO opportunities.
// Pure functions, so they are easy to test and to reason about.

/**
 * Rough share of clicks a result gets at a given position. These are industry-average
 * ballpark figures (they vary a lot by query type and SERP features), used only to spot
 * results that earn far less than usual for where they rank.
 */
export function expectedCtr(position) {
  if (position <= 1.5) return 0.28;
  if (position <= 2.5) return 0.15;
  if (position <= 3.5) return 0.1;
  if (position <= 4.5) return 0.07;
  if (position <= 5.5) return 0.055;
  if (position <= 10.5) return 0.03;
  if (position <= 20.5) return 0.008;
  return 0.003;
}

const round = (n, d = 1) => Number(n.toFixed(d));

const shape = (r) => ({
  query: r.keys[0],
  page: r.keys[1],
  clicks: r.clicks,
  impressions: r.impressions,
  ctr: round(r.ctr * 100, 2),
  position: round(r.position, 1),
});

/**
 * @param rows Search Console rows with keys [query, page]
 * @param opts minImpressions: ignore rows below this; top: max items per list
 */
export function findOpportunities(rows, { minImpressions = 50, top = 15 } = {}) {
  const usable = rows.filter((r) => Array.isArray(r.keys) && r.keys.length >= 2);

  const strikingDistance = usable
    .filter((r) => r.position >= 4 && r.position <= 20 && r.impressions >= minImpressions)
    .map((r) => ({
      ...shape(r),
      extraClicksIfTop3: Math.max(0, Math.round(r.impressions * 0.1 - r.clicks)),
    }))
    .sort((a, b) => b.extraClicksIfTop3 - a.extraClicksIfTop3)
    .slice(0, top);

  const lowCtr = usable
    .filter((r) => r.position <= 10.5 && r.impressions >= minImpressions && r.ctr < expectedCtr(r.position) * 0.5)
    .map((r) => ({
      ...shape(r),
      expectedCtr: round(expectedCtr(r.position) * 100, 2),
      extraClicksAtExpectedCtr: Math.max(0, Math.round(r.impressions * expectedCtr(r.position) - r.clicks)),
    }))
    .sort((a, b) => b.extraClicksAtExpectedCtr - a.extraClicksAtExpectedCtr)
    .slice(0, top);

  const zeroClick = usable
    .filter((r) => r.clicks === 0 && r.impressions >= minImpressions * 2)
    .map(shape)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, top);

  // Cannibalisation: one query where two or more of your pages each take a real share.
  const byQuery = new Map();
  for (const r of usable) {
    if (!byQuery.has(r.keys[0])) byQuery.set(r.keys[0], []);
    byQuery.get(r.keys[0]).push(r);
  }
  const cannibalisation = [];
  for (const [query, list] of byQuery) {
    const total = list.reduce((s, r) => s + r.impressions, 0);
    if (total < minImpressions) continue;
    const contenders = list.filter((r) => r.impressions >= total * 0.2);
    if (contenders.length < 2) continue;
    cannibalisation.push({
      query,
      totalImpressions: total,
      pages: contenders
        .sort((a, b) => b.impressions - a.impressions)
        .map((r) => ({ page: r.keys[1], impressions: r.impressions, clicks: r.clicks, position: round(r.position, 1) })),
    });
  }
  cannibalisation.sort((a, b) => b.totalImpressions - a.totalImpressions);

  const totals = usable.reduce(
    (t, r) => ({ clicks: t.clicks + r.clicks, impressions: t.impressions + r.impressions }),
    { clicks: 0, impressions: 0 },
  );

  return {
    summary: {
      rowsAnalysed: usable.length,
      clicks: totals.clicks,
      impressions: totals.impressions,
      minImpressions,
    },
    strikingDistance,
    lowCtr,
    zeroClick,
    cannibalisation: cannibalisation.slice(0, top),
    notes: [
      "strikingDistance: ranked 4-20 with real demand; improving content and internal links is the cheapest traffic win.",
      "lowCtr: ranks on page 1 but earns under half the typical CTR for that position; rewrite title and meta description.",
      "zeroClick: shown often, never clicked; check intent match and snippet.",
      "cannibalisation: several of your pages compete for one query; consolidate or differentiate them.",
      "Expected CTR figures are rough industry averages, not your own benchmarks.",
    ],
  };
}
