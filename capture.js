const TILE_SIZE = 2048;
const MAX_PIXELS = 64_000_000;
const MAX_SIDE = 32767;

export function capturePlan(width, height) {
  if (![width, height].every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error("The page has no capturable area.");
  }
  width = Math.ceil(width);
  height = Math.ceil(height);
  if (Math.ceil(width / TILE_SIZE) * Math.ceil(height / TILE_SIZE) > 256) {
    throw new Error("This page is too large for one image. Capture a shorter page.");
  }
  const scale = Math.min(1, MAX_SIDE / width, MAX_SIDE / height, Math.sqrt(MAX_PIXELS / (width * height)));
  const outputWidth = Math.max(1, Math.floor(width * scale));
  const outputHeight = Math.max(1, Math.floor(height * scale));
  const tiles = [];
  for (let y = 0; y < height; y += TILE_SIZE) {
    for (let x = 0; x < width; x += TILE_SIZE) {
      const right = Math.min(x + TILE_SIZE, width);
      const bottom = Math.min(y + TILE_SIZE, height);
      const leftOut = Math.round(x * outputWidth / width);
      const topOut = Math.round(y * outputHeight / height);
      tiles.push({
        clip: {x, y, width: right - x, height: bottom - y, scale: 1},
        destination: {
          x: leftOut, y: topOut,
          width: Math.round(right * outputWidth / width) - leftOut,
          height: Math.round(bottom * outputHeight / height) - topOut,
        },
      });
    }
  }
  return {width: outputWidth, height: outputHeight, tiles};
}

export function screenshotFilename(title) {
  const name = (title || "page").normalize("NFC").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/[. ]+$/g, "").trim().slice(0, 100).replace(/[. ]+$/g, "");
  return `page-copy-${name || "page"}.png`;
}

// Runs in Chrome's isolated world, without access to the extension's APIs.
export async function preparePage() {
  const position = {x: window.scrollX, y: window.scrollY};
  const style = document.createElement("style");
  style.textContent = "html, body { scroll-behavior: auto !important; scroll-snap-type: none !important; overflow-anchor: none !important; }";
  document.documentElement.append(style);
  const deadline = Date.now() + 20_000;
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const imageEvents = new AbortController();
  try {
    // Visit the page to trigger lazy images and intersection observers.
    for (let y = 0; ; y += Math.max(1, window.innerHeight * 0.8)) {
      const width = Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0);
      for (let x = 0; ; x += Math.max(1, window.innerWidth * 0.8)) {
        if (Date.now() > deadline) throw new Error("Page preparation timed out. Very long or continuously growing pages may exceed the capture limit.");
        window.scrollTo({left: x, top: y, behavior: "instant"});
        await delay(120);
        if (x + window.innerWidth >= width) break;
      }
      const height = Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0);
      if (y + window.innerHeight >= height) {
        await delay(250);
        const settledHeight = Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0);
        if (y + window.innerHeight >= settledHeight) break;
      }
    }
    await Promise.race([
      Promise.all([
        document.fonts.ready,
        ...[...document.images].filter((image) => !image.complete && image.getClientRects().length > 0).map((image) => new Promise((resolve) => {
          image.addEventListener("load", resolve, {once: true, signal: imageEvents.signal});
          image.addEventListener("error", resolve, {once: true, signal: imageEvents.signal});
        })),
      ]),
      delay(3000).then(() => { throw new Error("Some page images are still loading. Wait a moment, then try again."); }),
    ]);
    window.scrollTo({left: 0, top: 0, behavior: "instant"});
    await delay(150);
    return {position};
  } catch (error) {
    window.scrollTo({left: position.x, top: position.y, behavior: "instant"});
    return {error: error.message};
  } finally {
    imageEvents.abort();
    style.remove();
  }
}

export function restorePage(position) {
  window.scrollTo({left: position.x, top: position.y, behavior: "instant"});
}
