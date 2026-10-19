import {createArchive} from "./archive.js";

let canvas;
let context;
let files;
let totalBytes;
let tiles;

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
  if (message.action === "tile") {
    const blob = await (await fetch(`data:image/png;base64,${message.data}`)).blob();
    const {x, y, width, height} = message.destination;
    const header = new DataView(await blob.slice(16, 24).arrayBuffer());
    if (header.getUint32(0) !== width || header.getUint32(4) !== height) {
      throw new Error("The screenshot pixel ratio changed. Keep the zoom unchanged and try again.");
    }
    if (files) {
      totalBytes += blob.size;
      if (totalBytes > 40_000_000 || files.length >= 256) throw new Error("The AI archive exceeds the safe export limit. Use text or capture a shorter page.");
      const name = `tile-${String(files.length + 1).padStart(3, "0")}.png`;
      files.push({name, bytes: new Uint8Array(await blob.arrayBuffer())});
      tiles.push({name, ...message.destination});
      return {ok: true};
    }
    const image = await createImageBitmap(blob);
    try {
      context.drawImage(image, x, y);
    } finally { image.close(); }
    return {ok: true};
  }
  if (message.action === "finish") {
    if (files) {
      const encoder = new TextEncoder();
      files.push(
        {name: "page.txt", bytes: encoder.encode(message.text)},
        {name: "tiles.json", bytes: encoder.encode(JSON.stringify({width: message.width, height: message.height, pixelRatio: message.pixelRatio, tiles}, null, 2))},
        {name: "README.txt", bytes: encoder.encode("Read page.txt for exact page text. For visual details, attach the numbered PNG tiles individually in order. Tiles keep original device pixels and overlap by 64 pixels. Coordinates in tiles.json use output pixels. Chats may resize images even when PNG is lossless. Text excludes canvas, image text, and embedded frames; it is not OCR.\n")},
      );
      const blob = createArchive(files);
      if (blob.size > 40_000_000) throw new Error("The AI archive exceeds the browser's transfer limit. Use text or capture a shorter page.");
      files = undefined;
      tiles = undefined;
      return {ok: true, dataUrl: await dataUrl(blob)};
    }
    const blob = await canvas.convertToBlob({type: "image/png"});
    if (blob.size > 40_000_000) throw new Error("The PNG exceeds the browser's image transfer limit. Choose AI tiles (ZIP), PDF, or text.");
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
