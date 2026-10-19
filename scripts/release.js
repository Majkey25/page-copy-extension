import {readFile} from "node:fs/promises";
import {spawnSync} from "node:child_process";
import {shouldPromote} from "./release-version.js";

const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
const tag = `v${manifest.version}`;
if (process.env.GITHUB_REF_TYPE !== "tag" || process.env.GITHUB_REF_NAME !== tag) {
  throw new Error("Release tag must match the stable manifest version.");
}
if (!process.env.GITHUB_REPOSITORY) throw new Error("GITHUB_REPOSITORY is required.");
function github(path, allowMissing = false) {
  const result = spawnSync("gh", ["api", `repos/${process.env.GITHUB_REPOSITORY}/${path}`], {encoding: "utf8"});
  if (result.error) throw result.error;
  if (allowMissing && result.status !== 0 && result.stderr.includes("HTTP 404")) return null;
  if (result.status !== 0) throw new Error(`GitHub metadata request failed: ${result.stderr}`);
  return JSON.parse(result.stdout);
}
const commit = github(`commits/${tag}`);
if (commit.sha !== process.env.GITHUB_SHA) throw new Error("The remote release tag moved after checks started.");
const latest = github("releases/latest", true);
const promote = shouldPromote(manifest.version, latest?.tag_name ?? null);
const result = spawnSync("gh", [
  "release", "create", tag, "dist/page-copy-extension.zip", "dist/SHA256SUMS.txt",
  "--repo", process.env.GITHUB_REPOSITORY, "--verify-tag", "--title", `Page Copy ${tag}`,
  "--notes-file", "RELEASE_NOTES.md", promote ? "--latest" : "--latest=false",
], {stdio: "inherit"});
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`GitHub release failed with exit code ${result.status}.`);
