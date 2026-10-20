import assert from "node:assert/strict";
import test from "node:test";
import {textDataUrl} from "../formats.js";

test("text downloads preserve UTF-8 across base64 chunks and repair malformed Unicode", () => {
  const text = `${"€".repeat(11000)}\nPříliš žluťoučký kůň 😀\ud800`;
  const url = textDataUrl(text, "text/plain");
  assert.ok(url.startsWith("data:text/plain;charset=utf-8;base64,"));
  assert.equal(Buffer.from(url.split(",")[1], "base64").toString("utf8"), text.toWellFormed());
});
