import assert from "node:assert/strict";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {dirname, resolve, sep} from "node:path";
import {archive} from "./check-package.js";

const destination = resolve(import.meta.dirname, "../dist/page-copy-extension");
await rm(destination, {recursive: true, force: true});
for (const [file, bytes] of Object.entries(archive)) {
  const path = resolve(destination, file);
  assert.ok(path.startsWith(`${destination}${sep}`), "Archive paths must stay in the extension directory.");
  await mkdir(dirname(path), {recursive: true});
  await writeFile(path, bytes);
}
console.log("Unpacked the verified release ZIP for browser tests.");
