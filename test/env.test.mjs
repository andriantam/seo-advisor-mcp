import test from "node:test";
import assert from "node:assert/strict";
import { cleanEnv } from "../src/env.mjs";

test("cleanEnv drops unresolved placeholders and blanks, keeps real values", () => {
  const env = cleanEnv({
    A: "${user_config.google_key_file}",
    B: "  ",
    C: "/real/path.json",
    D: "US",
  });
  assert.deepEqual(env, { C: "/real/path.json", D: "US" });
});
