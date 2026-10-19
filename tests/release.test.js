import assert from "node:assert/strict";
import test from "node:test";
import {shouldPromote} from "../scripts/release-version.js";

test("first and newer stable releases become latest", () => {
  assert.equal(shouldPromote("1.0.0", null), true);
  assert.equal(shouldPromote("1.0.10", "v1.0.9"), true);
  assert.equal(shouldPromote("1.10.0", "v1.9.20"), true);
  assert.equal(shouldPromote("2.0.0", "v1.99.99"), true);
});

test("older or equal releases cannot move latest backwards", () => {
  assert.equal(shouldPromote("1.0.0", "v1.0.1"), false);
  assert.equal(shouldPromote("1.0.0", "v1.0.0"), false);
  assert.equal(shouldPromote("1.9.0", "v1.10.0"), false);
  assert.throws(() => shouldPromote("1.0.0", "preview"), /stable/);
});
