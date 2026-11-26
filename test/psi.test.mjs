import { test } from "node:test";
import assert from "node:assert/strict";
import { summarisePsi } from "../src/analysis/psi.mjs";

const sample = {
  lighthouseResult: {
    finalUrl: "https://example.com/",
    lighthouseVersion: "12.0.0",
    configSettings: { formFactor: "mobile" },
    categories: {
      performance: { id: "performance", score: 0.39, auditRefs: [{ id: "tbt", weight: 30 }, { id: "cls", weight: 25 }, { id: "ok", weight: 10 }] },
      seo: { id: "seo", score: 1, auditRefs: [] },
    },
    audits: {
      "first-contentful-paint": { displayValue: "2.7 s" },
      tbt: { title: "Total Blocking Time", score: 0.0, displayValue: "9,820 ms" },
      cls: { title: "CLS", score: 1, displayValue: "0" },
      ok: { title: "Fine", score: 0.5, displayValue: "x" },
    },
  },
  loadingExperience: { metrics: { LARGEST_CONTENTFUL_PAINT_MS: { percentile: 3100, category: "AVERAGE" } } },
};

test("summarises scores, lab metrics, field data and ranks issues by weight", () => {
  const s = summarisePsi(sample);
  assert.equal(s.scores.performance, 39);
  assert.equal(s.scores.seo, 100);
  assert.equal(s.lab["first-contentful-paint"], "2.7 s");
  assert.equal(s.fieldDataAvailable, true);
  assert.equal(s.field.LARGEST_CONTENTFUL_PAINT_MS.rating, "AVERAGE");
  assert.deepEqual(s.topIssues.map((i) => i.id), ["tbt", "ok"]); // cls scores 1 so it is not an issue
});

test("handles a response with no field data", () => {
  const s = summarisePsi({ lighthouseResult: { categories: {}, audits: {} } });
  assert.equal(s.fieldDataAvailable, false);
  assert.deepEqual(s.topIssues, []);
});
