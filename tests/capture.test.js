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

test("huge pages keep every pixel in overlapping AI tiles instead of shrinking", () => {
  assert.throws(() => capturePlan(3000, 50000), /AI tiles/);
  const plan = capturePlan(3000, 50000, 1, true);
  assert.equal(plan.width, 3000);
  assert.equal(plan.height, 50000);
  const last = plan.tiles.at(-1);
  assert.equal(last.clip.y + last.clip.height, 50000);
  assert.equal(last.destination.y + last.destination.height, plan.height);
  for (let index = 1; index < plan.tiles.length; index++) {
    assert.ok(plan.tiles[index].destination.width <= 1536);
    assert.ok(plan.tiles[index].destination.height <= 1536);
    const before = plan.tiles[index - 1].destination;
    const current = plan.tiles[index].destination;
    if (current.y === before.y) assert.equal(current.x, before.x + before.width - 64);
    else assert.equal(current.y, before.y + before.height - 64);
  }
});

test("integer DIP clips preserve native pixels on Chrome versions that truncate sizes", () => {
  for (const [ratio, zoom] of [[1.100000023841858, 1], [1.25, 1], [1.5, 1], [1.75, 1], [1.5749999284744263, 0.9], [2, 1.25]]) {
    const plan = capturePlan(1501, 5001, ratio, false, zoom);
    assert.equal(plan.width, Math.ceil(1501 * ratio));
    assert.equal(plan.height, Math.ceil(5001 * ratio));
    for (const {clip, destination} of plan.tiles) {
      for (const side of ["width", "height"]) {
        const pixels = Math.round(Math.trunc(clip[side]) * ratio / zoom);
        assert.ok(pixels >= destination[side], "Chrome must receive enough native pixels, including one-pixel edges.");
        assert.ok(pixels <= destination[side] + Math.ceil(ratio / zoom));
      }
      assert.ok(Math.abs(clip.x * ratio / zoom - destination.x) < 1e-9);
      assert.ok(Math.abs(clip.y * ratio / zoom - destination.y) < 1e-9);
    }
  }
  const edge = capturePlan(1200, 9831, 1.25).tiles.at(-1);
  assert.equal(edge.destination.height, 1);
  assert.equal(edge.clip.height, 1, "A one-pixel final row needs a nonempty integer DIP clip.");
});

test("invalid and unbounded dimensions fail explicitly", () => {
  for (const value of [0, -1, NaN, Infinity]) assert.throws(() => capturePlan(100, value));
  assert.throws(() => capturePlan(100000, 100000), /too large/);
  assert.throws(() => capturePlan(100, 100, NaN));
  assert.throws(() => capturePlan(100, 100, 1, false, 0));
  assert.throws(() => capturePlan(100000, 100000, 1, true), /too large/);
});

test("download names preserve Czech and cannot create directories", () => {
  assert.equal(screenshotFilename('Příliš / žluťoučký: web?'), "page-copy-Příliš - žluťoučký- web-.png");
  assert.equal(screenshotFilename(""), "page-copy-page.png");
  assert.equal(screenshotFilename("Příliš", "zip"), "page-copy-Příliš.zip");
  assert.equal(screenshotFilename("bad\ud800", "txt"), "page-copy-bad\ufffd.txt");
  assert.ok(!screenshotFilename('../CON\\test\u0000').includes("/"));
  assert.ok(!screenshotFilename('../CON\\test\u0000').includes("\\"));
});
