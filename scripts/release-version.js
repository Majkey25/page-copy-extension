export function shouldPromote(version, latestTag) {
  if (latestTag === null) return true;
  const latest = /^v(\d+)\.(\d+)\.(\d+)$/.exec(latestTag);
  if (!latest) throw new Error("The latest release must have a stable vX.Y.Z tag.");
  const current = version.split(".").map(Number);
  const previous = latest.slice(1).map(Number);
  const difference = current.findIndex((part, index) => part !== previous[index]);
  return difference >= 0 && current[difference] > previous[difference];
}
