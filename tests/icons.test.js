import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

test("manifest icons are valid PNG files at their declared sizes", async () => {
  const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
  for (const [size, path] of Object.entries(manifest.icons)) {
    const image = await readFile(new URL(`../${path}`, import.meta.url));
    assert.equal(image.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(image.readUInt32BE(16), Number(size));
    assert.equal(image.readUInt32BE(20), Number(size));
    assert.equal(manifest.action.default_icon[size], path);
  }
});
