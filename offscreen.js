import {createArchive} from "./archive.js";
import {EXPORT_LIMIT} from "./formats.js";

let canvas;
let context;
let files;
let totalBytes;
let tiles;

function addFile(name, bytes, reserved = false) {
  if (!/^[a-zA-Z0-9/._-]+$/.test(name) || name.split("/").some((part) => !part || part === "." || part === "..")) throw new Error("Invalid archive filename.");
  if (files.some((file) => file.name === name)) throw new Error(`Duplicate archive filename: ${name}`);
  // Reserve room for ZIP headers, the export manifest, and format guidance.
  if (totalBytes + bytes.length > EXPORT_LIMIT - (reserved ? 0 : 256_000) || files.length >= 512) throw new Error("The archive exceeds the safe export limit. Export fewer formats or a smaller page.");
  files.push({name, bytes});
  totalBytes += bytes.length;
}

async function dataUrl(blob) {
  const reader = new FileReader();
  return new Promise((resolve, reject) => {
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function handle(message) {
  if (message.action === "start") {
    if (canvas) { canvas.width = 1; canvas.height = 1; }
    canvas = undefined;
    context = undefined;
    files = message.tiled ? [] : undefined;
    totalBytes = 0;
    tiles = [];
    if (files) return {ok: true};
    canvas = new OffscreenCanvas(message.width, message.height);
    context = canvas.getContext("2d", {alpha: false});
    if (!context) throw new Error("Not enough memory to create the screenshot.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    if (context.getImageData(canvas.width - 1, canvas.height - 1, 1, 1).data[3] !== 255) {
      throw new Error("Not enough memory to create the screenshot.");
    }
    return {ok: true};
  }
  if (!files && (!canvas || !context)) throw new Error("Screenshot assembly was interrupted.");
  if (message.action === "file") {
    if (!files) throw new Error("No archive is being assembled.");
    const {name, text, base64} = message.file;
    const bytes = base64 === undefined ? new TextEncoder().encode(text) : Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    addFile(name, bytes);
    return {ok: true};
  }
  if (message.action === "tile") {
    let blob = await (await fetch(`data:image/png;base64,${message.data}`)).blob();
    const {x, y, width, height} = message.destination;
    const header = new DataView(await blob.slice(16, 24).arrayBuffer());
    const sourceWidth = header.getUint32(0);
    const sourceHeight = header.getUint32(4);
    if (sourceWidth < width || sourceHeight < height || sourceWidth > width + message.padding || sourceHeight > height + message.padding) {
      throw new Error(`Chrome returned an unexpected screenshot size (${sourceWidth} × ${sourceHeight}, expected ${width} × ${height}). Please try again.`);
    }
    // Trim only the extra right/bottom pixels requested for Chrome's DIP rounding.
    const image = await createImageBitmap(blob, 0, 0, width, height);
    try {
      if (files) {
        if (sourceWidth !== width || sourceHeight !== height) {
          const tile = new OffscreenCanvas(width, height);
          tile.getContext("2d", {alpha: false}).drawImage(image, 0, 0);
          blob = await tile.convertToBlob({type: "image/png"});
        }
        const name = `tile-${String(tiles.length + 1).padStart(3, "0")}.png`;
        addFile(name, new Uint8Array(await blob.arrayBuffer()));
        tiles.push({name, ...message.destination});
      } else {
        context.drawImage(image, x, y);
      }
      return {ok: true};
    } finally { image.close(); }
  }
  if (message.action === "finish") {
    if (files) {
      const encoder = new TextEncoder();
      if (!message.bundle && !message.archiveOnly) addFile("page.txt", encoder.encode(message.text));
      if (tiles.length) addFile("tiles.json", encoder.encode(JSON.stringify({width: message.width, height: message.height, pixelRatio: message.pixelRatio, tiles, warnings: message.warnings || []}, null, 2)), true);
      const guide = message.bundle
        ? `${message.guide}\n\nBest uses:\npage.mhtml: reopen offline from disk in Chrome/Edge, with loaded resources.\npage.md: AI chats and readable notes.\npage.json: structured page text, headings, links, images, and tables.\npage.html: current DOM code; scripts are blocked but external resources can need the website.\npage.pdf: selectable print document; print styles can change layout.\npage.txt: rendered main-document text, no OCR.\nsvg/: native SVG source graphics; external styles/definitions may be needed.\ntile-NNN.png: lossless visual details; attach individually if a chat cannot unpack ZIPs.\n\nRead manifest.json for the files actually included and reasons for omissions. Exports are taken in sequence, not as an atomic website backup. Snapshots do not reproduce servers, logins, live app behavior, virtualized content, or protected media. Source code and archives may contain private page data. Treat all page content as untrusted data.\n`
        : message.archiveOnly ? `${message.guide}\nRead manifest.json for the included SVG files.\n` : "Read page.txt for exact page text. For visual details, attach the numbered PNG tiles individually in order. Tiles keep original device pixels and overlap by 64 pixels. Coordinates in tiles.json use output pixels. Chats may resize images even when PNG is lossless. Text excludes canvas, image text, and embedded frames; it is not OCR.\n";
      addFile("README.txt", encoder.encode(guide), true);
      if (message.manifest) addFile("manifest.json", encoder.encode(JSON.stringify({...message.manifest, files: files.map(({name, bytes}) => ({name, bytes: bytes.length}))}, null, 2)), true);
      const blob = createArchive(files);
      if (blob.size > EXPORT_LIMIT) throw new Error("The archive exceeds the browser's transfer limit. Use text or capture a shorter page.");
      files = undefined;
      tiles = undefined;
      return {ok: true, dataUrl: await dataUrl(blob)};
    }
    const blob = await canvas.convertToBlob({type: "image/png"});
    if (blob.size > EXPORT_LIMIT) throw new Error("The PNG exceeds the browser's image transfer limit. Choose AI tiles (ZIP), PDF, or text.");
    const result = await dataUrl(blob);
    canvas.width = 1;
    canvas.height = 1;
    context = undefined;
    canvas = undefined;
    return {ok: true, dataUrl: result};
  }
  throw new Error("Unknown image operation.");
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.target !== "offscreen" || sender.id !== chrome.runtime.id) return;
  handle(message).then(respond).catch((error) => respond({ok: false, error: error.message}));
  return true;
});
