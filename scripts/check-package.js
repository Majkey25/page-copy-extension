import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {unzipSync} from "fflate";
import {vendorFiles} from "./vendor-files.js";

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"));
const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
assert.equal(manifest.version, pkg.version, "Manifest and package versions must match.");
assert.match(manifest.version, /^\d+\.\d+\.\d+$/, "Releases require a stable version.");
if (process.env.GITHUB_REF_TYPE === "tag") {
  assert.equal(process.env.GITHUB_REF_NAME, `v${manifest.version}`, "The release tag must match manifest.json.");
}
const files = [
  "LICENSE", "PRIVACY.md", "archive.js", "background.js", "capture.js", "manifest.json", "offscreen.html", "offscreen.js",
  "formats.js", "page-data.js", "popup.css", "popup.html", "popup.js", "icons/icon.svg", ...Object.values(manifest.icons), ...Object.keys(vendorFiles),
];
const zip = await readFile(resolve(root, "dist", "page-copy-extension.zip"));
export const archive = unzipSync(zip);
assert.deepEqual(Object.keys(archive).sort(), files.sort(), "The ZIP must contain only extension files.");
for (const file of files) {
  assert.deepEqual(Buffer.from(archive[file]), await readFile(resolve(root, vendorFiles[file] || file)), `${file} differs from source.`);
}
const checksum = `${createHash("sha256").update(zip).digest("hex")}  page-copy-extension.zip\n`;
assert.equal(await readFile(resolve(root, "dist", "SHA256SUMS.txt"), "utf8"), checksum);
console.log(`Verified ${files.length} packaged files, source bytes, version, release tag, and SHA-256.`);
