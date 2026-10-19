import assert from "node:assert/strict";
import test from "node:test";
import {unzipSync} from "fflate";
import {createArchive} from "../archive.js";

test("AI ZIP opens with an independent reader and preserves PNG and UTF-8 bytes", async () => {
  const text = new TextEncoder().encode("Příliš žluťoučký kůň\nSmall text stays text.");
  const png = Uint8Array.from({length: 8193}, (_, index) => index % 256);
  const archive = createArchive([{name: "tile-001.png", bytes: png}, {name: "stránka.txt", bytes: text}]);
  assert.equal(archive.type, "application/zip");
  const entries = unzipSync(new Uint8Array(await archive.arrayBuffer()));
  assert.deepEqual(Object.keys(entries), ["tile-001.png", "stránka.txt"]);
  assert.deepEqual(entries["tile-001.png"], png);
  assert.deepEqual(entries["stránka.txt"], text);
});

test("ZIP header carries the standard CRC-32 checksum", async () => {
  const archive = createArchive([{name: "crc.txt", bytes: new TextEncoder().encode("123456789")}]);
  const header = new DataView(await archive.arrayBuffer());
  assert.equal(header.getUint32(14, true), 0xcbf43926);
});
