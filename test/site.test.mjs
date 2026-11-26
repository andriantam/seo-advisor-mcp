import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSite } from "../src/tools/google.mjs";

test("normalizeSite", () => {
  assert.equal(normalizeSite("andriantam.com"), "sc-domain:andriantam.com");
  assert.equal(normalizeSite("sc-domain:a.com"), "sc-domain:a.com");
  assert.equal(normalizeSite("https://a.com/"), "https://a.com/");
  assert.equal(normalizeSite(""), "");
});
