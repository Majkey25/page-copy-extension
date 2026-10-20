import {FORMATS} from "./formats.js";

const status = document.querySelector("#status");
const buttons = [...document.querySelectorAll(".actions > button")];
const saveFormat = document.querySelector("#save-format");
const copyButton = document.querySelector("#copy-button");
const infoButton = document.querySelector("#info-button");
const info = document.querySelector("#format-info");
let running = false;
let pinned = false;

saveFormat.replaceChildren(...Object.entries(FORMATS).map(([value, format]) => new Option(format.label, value)));

function updateFormat() {
  const format = FORMATS[saveFormat.value];
  copyButton.textContent = format.copy ? `COPY ${saveFormat.value === "svg" ? "SVG CODE" : saveFormat.value.toUpperCase()}` : "SAVE AND ATTACH THIS FILE";
  copyButton.disabled = running || !format.copy;
  document.querySelector("#format-help").textContent = format.copy ? `${format.use} Hover or focus i for details.` : `${format.use} Use Save as, then attach the file.`;
  document.querySelector("#info-title").textContent = format.label;
  document.querySelector("#info-use").textContent = `Best for: ${format.use}`;
  document.querySelector("#info-detail").textContent = format.detail;
}

function showInfo(show) {
  info.hidden = !show;
  infoButton.setAttribute("aria-expanded", String(show));
}

saveFormat.addEventListener("change", updateFormat);
infoButton.addEventListener("pointerenter", () => showInfo(true));
infoButton.addEventListener("focus", () => showInfo(true));
infoButton.addEventListener("click", () => { pinned = !pinned; showInfo(pinned); });
document.querySelector("#info-wrap").addEventListener("pointerleave", () => { if (!pinned && document.activeElement !== infoButton) showInfo(false); });
infoButton.addEventListener("blur", () => { if (!pinned) showInfo(false); });
document.addEventListener("pointerdown", (event) => { if (!event.target.closest("#info-wrap")) { pinned = false; showInfo(false); } });
document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !info.hidden) { event.preventDefault(); event.stopPropagation(); pinned = false; showInfo(false); } });
updateFormat();

chrome.runtime.onMessage.addListener((message) => {
  if (message.target === "popup" && message.status) status.textContent = message.status;
});

async function capture(action, format) {
  running = true;
  buttons.forEach((button) => { button.disabled = true; });
  saveFormat.disabled = true;
  status.dataset.error = "false";
  status.textContent = "Preparing page… Keep this popup open.";
  try {
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    const result = await chrome.runtime.sendMessage({target: "background", action, format, tabId: tab?.id});
    if (!result?.ok) throw new Error(result?.error || "Capture failed. Please try again.");
    if (action === "copy" && result.text !== undefined) {
      await navigator.clipboard.writeText(result.text);
      status.textContent = format === "txt" ? "Copied page text. Paste into your AI chat. Image/canvas text is not included." : `Copied ${format.toUpperCase()} source as plain text. Paste into an editor or AI chat.`;
    } else if (action === "copy") {
      const blob = await (await fetch(result.dataUrl)).blob();
      await navigator.clipboard.write([new ClipboardItem({"image/png": blob})]);
      status.textContent = "Copied lossless PNG. The receiving chat may resize it. Use text or AI tiles for long pages.";
    } else {
      status.textContent = result.warnings?.length ? `Save dialog opened. ${result.warnings.length} export(s) were skipped; read manifest.json for reasons.` : "Save dialog opened.";
    }
  } catch (error) {
    status.dataset.error = "true";
    status.textContent = error instanceof Error ? error.message : "Capture failed. Please try again.";
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
    saveFormat.disabled = false;
    running = false;
    updateFormat();
  }
}

copyButton.addEventListener("click", () => capture("copy", saveFormat.value));
document.querySelector("#text-button").addEventListener("click", () => capture("copy", "txt"));
document.querySelector("#save-button").addEventListener("click", () => capture("save", saveFormat.value));
