import test from "node:test";
import assert from "node:assert/strict";
import { robotsAllows } from "../src/robots.mjs";

const T = `User-agent: *\nDisallow: /private\nAllow: /private/ok\nDisallow: /*.pdf$\n\nUser-agent: seo-advisor-mcp\nDisallow: /blocked\n`;

test("specific agent group wins over *", () => {
  assert.equal(robotsAllows(T, "/blocked/x"), false);
  assert.equal(robotsAllows(T, "/private/x"), true); // * rules do not apply once a specific group matches
});
test("* group: longest match, wildcards, $", () => {
  const star = `User-agent: *\nDisallow: /private\nAllow: /private/ok\nDisallow: /*.pdf$\n`;
  assert.equal(robotsAllows(star, "/private/x"), false);
  assert.equal(robotsAllows(star, "/private/ok/y"), true);
  assert.equal(robotsAllows(star, "/a/file.pdf"), false);
  assert.equal(robotsAllows(star, "/a/file.pdf?x=1"), true);
  assert.equal(robotsAllows(star, "/blog/post"), true);
});
test("empty or missing robots allows everything", () => {
  assert.equal(robotsAllows("", "/x"), true);
  assert.equal(robotsAllows("User-agent: *\nDisallow:\n", "/x"), true);
});
