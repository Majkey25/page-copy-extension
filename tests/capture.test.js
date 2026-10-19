import assert from "node:assert/strict";
import test from "node:test";
import {capturePlan, screenshotFilename} from "../capture.js";

test("tiles cover a long, wide page exactly, including its final pixel", () => {
  const plan = capturePlan(4301, 9876);
  assert.equal(plan.width, 4301);
  assert.equal(plan.height, 9876);
  let area = 0;
  for (const {clip, destination} of plan.tiles) {
    assert.ok(clip.width <= 2048 && clip.height <= 2048);
    assert.equal(destination.x, clip.x);
    assert.equal(destination.y, clip.y);
    area += destination.width * destination.height;
  }
  assert.equal(area, plan.width * plan.height);
  const last = plan.tiles.at(-1).destination;
  assert.equal(last.x + last.width, plan.width);
  assert.equal(last.y + last.height, plan.height);
});

test("huge pages retain the whole page within canvas limits", () => {
  const plan = capturePlan(3000, 50000);
  assert.ok(plan.width * plan.height <= 64_000_000);
  assert.ok(plan.height <= 32767);
  const last = plan.tiles.at(-1);
  assert.equal(last.clip.y + last.clip.height, 50000);
  assert.equal(last.destination.y + last.destination.height, plan.height);
  for (let index = 1; index < plan.tiles.length; index++) {
    const before = plan.tiles[index - 1].destination;
    const current = plan.tiles[index].destination;
    if (current.y === before.y) assert.equal(current.x, before.x + before.width);
    else assert.equal(current.y, before.y + before.height);
  }
});

test("invalid and unbounded dimensions fail explicitly", () => {
  for (const value of [0, -1, NaN, Infinity]) assert.throws(() => capturePlan(100, value));
  assert.throws(() => capturePlan(100000, 100000), /too large/);
});

test("download names preserve Czech and cannot create directories", () => {
  assert.equal(screenshotFilename('Příliš / žluťoučký: web?'), "page-copy-Příliš - žluťoučký- web-.png");
  assert.equal(screenshotFilename(""), "page-copy-page.png");
  assert.ok(!screenshotFilename('../CON\\test\u0000').includes("/"));
  assert.ok(!screenshotFilename('../CON\\test\u0000').includes("\\"));
});
