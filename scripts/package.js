import {cp, mkdir, readFile, readdir, rm, writeFile} from "node:fs/promises";
import {relative, resolve, sep} from "node:path";
import {createHash} from "node:crypto";
import {zipSync} from "fflate";
import {vendorFiles} from "./vendor-files.js";

const root = resolve(import.meta.dirname, "..");
const destination = resolve(root, "dist", "page-copy-extension");
await rm(destination, {recursive: true, force: true});
await mkdir(destination, {recursive: true});
const files = ["manifest.json", "archive.js", "background.js", "capture.js", "formats.js", "page-data.js", "popup.html", "popup.css", "popup.js", "offscreen.html", "offscreen.js", "icons", "LICENSE", "PRIVACY.md"];
for (const file of files) await cp(resolve(root, file), resolve(destination, file), {recursive: true});
await mkdir(resolve(destination, "vendor"));
for (const [file, source] of Object.entries(vendorFiles)) await cp(resolve(root, source), resolve(destination, file));
const manifest = JSON.parse(await readFile(resolve(destination, "manifest.json"), "utf8"));
const entries = await readdir(destination, {recursive: true, withFileTypes: true});
const archive = {};
const paths = entries.filter((entry) => entry.isFile()).map((entry) => resolve(entry.parentPath, entry.name)).sort();
for (const path of paths) {
  archive[relative(destination, path).split(sep).join("/")] = await readFile(path);
}
const zip = zipSync(archive, {level: 9, mtime: new Date(2000, 0, 1)});
const name = "page-copy-extension.zip";
await writeFile(resolve(root, "dist", name), zip);
await writeFile(resolve(root, "dist", "SHA256SUMS.txt"), `${createHash("sha256").update(zip).digest("hex")}  ${name}\n`);
console.log(`Page Copy ${manifest.version}: dist/${name} and dist/SHA256SUMS.txt`);
