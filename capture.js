const TILE_SIZE = 2048;
const MAX_PIXELS = 64_000_000;
const MAX_SIDE = 32767;

export function capturePlan(width, height, pixelRatio = 1, tiled = false, zoom = 1) {
  if (![width, height, pixelRatio, zoom].every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error("The page has no capturable area.");
  }
  width = Math.ceil(width * pixelRatio);
  height = Math.ceil(height * pixelRatio);
  const size = tiled ? 1536 : TILE_SIZE;
  const step = tiled ? size - 64 : size;
  const columns = Math.max(1, Math.ceil((width - size) / step) + 1);
  const rows = Math.max(1, Math.ceil((height - size) / step) + 1);
  if (columns * rows > 256) {
    throw new Error("This page is too large to capture safely. Use text or PDF, or capture a shorter page.");
  }
  if (!tiled && (width > MAX_SIDE || height > MAX_SIDE || width * height > MAX_PIXELS)) {
    throw new Error("This page is too large for one lossless PNG. Choose AI tiles (ZIP), PDF, or text. No pixels were reduced.");
  }
  const tiles = [];
  for (let row = 0; row < rows; row++) {
    const y = row * step;
    for (let column = 0; column < columns; column++) {
      const x = column * step;
      const tileWidth = Math.min(size, width - x);
      const tileHeight = Math.min(size, height - y);
      tiles.push({
        // Released Chrome truncates fractional DIP sizes before applying display scale.
        clip: {x: x / pixelRatio * zoom, y: y / pixelRatio * zoom, width: Math.ceil(tileWidth / pixelRatio * zoom), height: Math.ceil(tileHeight / pixelRatio * zoom), scale: 1},
        destination: {x, y, width: tileWidth, height: tileHeight},
      });
    }
  }
  return {width, height, pixelRatio, tiles};
}

export function screenshotFilename(title, extension = "png") {
  // eslint-disable-next-line no-control-regex -- Windows filenames cannot contain control characters.
  const name = (title || "page").normalize("NFC").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/[. ]+$/g, "").trim().slice(0, 100).replace(/[. ]+$/g, "").toWellFormed();
  return `page-copy-${name || "page"}.${extension}`;
}

export function readPage(includeText = true) {
  const body = includeText && document.body && [document.documentElement, document.body].every((node) => getComputedStyle(node).display !== "none") ? document.body : null;
  const text = includeText ? `${document.title}\n${location.href}\n\n${body?.innerText || ""}` : "";
  if (text.length > 8_000_000) return {error: "The page text exceeds the safe export limit. Capture a shorter page."};
  return {pixelRatio: window.devicePixelRatio, text};
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
  const warnings = [];
  try {
    // Visit the initial document once; infinite feeds must not move the finish line.
    const width = Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0);
    const height = Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0);
    scan:
    for (let y = 0; ; y += Math.max(1, window.innerHeight * 0.8)) {
      for (let x = 0; ; x += Math.max(1, window.innerWidth * 0.8)) {
        if (Date.now() > deadline) {
          warnings.push("Lazy loading stopped after 20 seconds. The export contains the currently loaded page; some resources may be missing.");
          break scan;
        }
        window.scrollTo({left: x, top: y, behavior: "instant"});
        await delay(50);
        if (x + window.innerWidth >= width) break;
      }
      if (y + window.innerHeight >= height) break;
    }
    const loaded = await Promise.race([
      Promise.all([
        document.fonts.ready,
        ...[...document.images].filter((image) => !image.complete && image.getClientRects().length > 0).map((image) => new Promise((resolve) => {
          image.addEventListener("load", resolve, {once: true, signal: imageEvents.signal});
          image.addEventListener("error", resolve, {once: true, signal: imageEvents.signal});
        })),
      ]).then(() => true),
      delay(3000).then(() => false),
    ]);
    if (!loaded) warnings.push("Some images or fonts are still loading. The export contains the resources available now.");
    if (Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0) > height || Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0) > width) warnings.push("The page grew while loading. Newly added or virtualized content may be incomplete.");
    window.scrollTo({left: 0, top: 0, behavior: "instant"});
    await delay(150);
    return {position, warnings};
  } catch (error) {
    window.scrollTo({left: position.x, top: position.y, behavior: "instant"});
    return {position, error: error.message};
  } finally {
    imageEvents.abort();
    style.remove();
  }
}

export function restorePage(position) {
  window.scrollTo({left: position.x, top: position.y, behavior: "instant"});
}

export function waitForPaint() {
  return new Promise((resolve) => {
    let frame;
    const done = () => { clearTimeout(timer); cancelAnimationFrame(frame); resolve(); };
    const timer = setTimeout(done, 250);
    frame = requestAnimationFrame(() => { frame = requestAnimationFrame(done); });
  });
}
