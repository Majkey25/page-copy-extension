import {cp, mkdir, readFile, rm} from "node:fs/promises";
import {resolve} from "node:path";

const root = resolve(import.meta.dirname, "..");
const destination = resolve(root, "dist", "page-copy-extension");
await rm(destination, {recursive: true, force: true});
await mkdir(destination, {recursive: true});
const files = ["manifest.json", "background.js", "capture.js", "popup.html", "popup.css", "popup.js", "offscreen.html", "offscreen.js", "icons", "LICENSE", "PRIVACY.md"];
for (const file of files) await cp(resolve(root, file), resolve(destination, file), {recursive: true});
const manifest = JSON.parse(await readFile(resolve(destination, "manifest.json"), "utf8"));
console.log(`Page Copy ${manifest.version}: ${destination}`);
