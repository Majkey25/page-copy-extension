import {readFile} from "node:fs/promises";
import {spawnSync} from "node:child_process";

const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
const tag = `v${manifest.version}`;
if (process.env.GITHUB_REF_TYPE !== "tag" || process.env.GITHUB_REF_NAME !== tag) {
  throw new Error("Release tag must match the stable manifest version.");
}
if (!process.env.GITHUB_REPOSITORY) throw new Error("GITHUB_REPOSITORY is required.");
const result = spawnSync("gh", [
  "release", "create", tag, "dist/page-copy-extension.zip", "dist/SHA256SUMS.txt",
  "--repo", process.env.GITHUB_REPOSITORY, "--verify-tag", "--title", `Page Copy ${tag}`,
  "--notes-file", "RELEASE_NOTES.md", "--latest",
], {stdio: "inherit"});
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`GitHub release failed with exit code ${result.status}.`);
