import {capturePlan, preparePage, readPage, restorePage, screenshotFilename} from "./capture.js";

let busy = false;

function progress(status) {
  chrome.runtime.sendMessage({target: "popup", status}).catch(() => {});
}

async function imageCommand(action, payload = {}) {
  const result = await chrome.runtime.sendMessage({target: "offscreen", action, ...payload});
  if (!result?.ok) throw new Error(result?.error || "Could not assemble the screenshot.");
  return result;
}

async function captureTile(target, clip) {
  let timer;
  try {
    return await Promise.race([
      chrome.debugger.sendCommand(target, "Page.captureScreenshot", {format: "png", clip, captureBeyondViewport: true, fromSurface: true}),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Screenshot capture timed out. The page may have navigated; try again.")), 30_000); }),
    ]);
  } finally { clearTimeout(timer); }
}

async function capture(tabId, action, format) {
  if (busy) throw new Error("A capture is already running. Please wait.");
  if (!Number.isInteger(tabId)) throw new Error("Open a web page first.");
  busy = true;
  const target = {tabId};
  let attached = false;
  let offscreen = false;
  let position;
  let documentId;
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!/^https?:\/\//i.test(tab.url || "")) throw new Error("Open a normal website. Browser pages and PDFs are not supported.");
    if (format === "txt") {
      const [page] = await chrome.scripting.executeScript({target: {tabId}, func: readPage});
      if (page?.result?.error) throw new Error(page.result.error);
      if (!page?.result) throw new Error("The page changed during export. Please try again.");
      const text = page.result.text;
      if (action === "copy") return {ok: true, text};
      await chrome.downloads.download({url: `data:text/plain;charset=utf-8,${encodeURIComponent(text.toWellFormed())}`, filename: screenshotFilename(tab.title, "txt"), saveAs: true});
      return {ok: true};
    }
    try {
      await chrome.debugger.attach(target, "1.3");
      attached = true;
    } catch (error) {
      throw new Error(`Cannot capture this tab. Close its DevTools and try again. ${error.message}`, {cause: error});
    }
    const [prepared] = await chrome.scripting.executeScript({target: {tabId}, func: preparePage});
    if (prepared?.result?.error) throw new Error(prepared.result.error);
    position = prepared?.result?.position;
    documentId = prepared?.documentId;
    if (!position || !documentId) throw new Error("The page changed during capture. Please try again.");
    if (format === "pdf") {
      progress("Creating PDF…");
      const {data} = await chrome.debugger.sendCommand(target, "Page.printToPDF", {printBackground: true, preferCSSPageSize: true, generateTaggedPDF: true});
      await chrome.scripting.executeScript({target: {tabId, documentIds: [documentId]}, func: readPage, args: [false]});
      if (data.length > Math.ceil(40_000_000 / 3) * 4) throw new Error("The PDF exceeds the browser's transfer limit. Use text or a shorter page.");
      await chrome.downloads.download({url: `data:application/pdf;base64,${data}`, filename: screenshotFilename(tab.title, "pdf"), saveAs: true});
      return {ok: true};
    }
    if ((await chrome.runtime.getContexts({contextTypes: ["OFFSCREEN_DOCUMENT"]})).length) {
      await chrome.offscreen.closeDocument();
    }
    await chrome.offscreen.createDocument({url: "offscreen.html", reasons: ["BLOBS"], justification: "Assemble lossless PNG or AI screenshot tiles locally."});
    offscreen = true;
    let plan;
    let stable = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) {
        progress("Page resized. Retrying capture…");
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      const metrics = await chrome.debugger.sendCommand(target, "Page.getLayoutMetrics");
      const {width, height} = metrics.cssContentSize;
      const zoom = await chrome.tabs.getZoom(tabId);
      const [page] = await chrome.scripting.executeScript({target: {tabId, documentIds: [documentId]}, func: readPage, args: [false]});
      if (!page?.result) throw new Error("The page changed during capture. Please try again.");
      plan = capturePlan(width, height, page.result.pixelRatio, format === "zip", zoom);
      await imageCommand("start", {...plan, tiled: format === "zip"});
      for (const [index, tile] of plan.tiles.entries()) {
        progress(`Capturing ${index + 1} / ${plan.tiles.length}…`);
        const shot = await captureTile(target, tile.clip);
        await imageCommand("tile", {data: shot.data, destination: tile.destination, padding: Math.ceil(plan.pixelRatio / zoom)});
      }
      const after = await chrome.debugger.sendCommand(target, "Page.getLayoutMetrics");
      if (Math.ceil(after.cssContentSize.width * plan.pixelRatio) === plan.width && Math.ceil(after.cssContentSize.height * plan.pixelRatio) === plan.height) {
        stable = true;
        break;
      }
    }
    if (!stable) throw new Error("The page kept changing size after 3 capture attempts. Pause live content or use text/PDF.");
    progress(format === "zip" ? "Creating AI archive…" : "Creating PNG…");
    const [finishedPage] = await chrome.scripting.executeScript({target: {tabId, documentIds: [documentId]}, func: readPage, args: [format === "zip"]});
    if (finishedPage?.result?.error) throw new Error(finishedPage.result.error);
    if (!finishedPage?.result) throw new Error("The page changed during export. Please try again.");
    const {dataUrl} = await imageCommand("finish", {width: plan.width, height: plan.height, pixelRatio: plan.pixelRatio, text: finishedPage.result.text});
    if (action === "save") {
      await chrome.downloads.download({url: dataUrl, filename: screenshotFilename(tab.title, format), saveAs: true});
      return {ok: true};
    }
    return {ok: true, dataUrl};
  } finally {
    if (position) {
      try {
        if (documentId) await chrome.scripting.executeScript({target: {tabId, documentIds: [documentId]}, func: restorePage, args: [position]});
      } catch (error) { console.warn("Could not restore page position:", error.message); }
    }
    if (attached) {
      try { await chrome.debugger.detach(target); }
      catch (error) { console.warn("Debugger already detached:", error.message); }
    }
    if (offscreen) {
      try { await chrome.offscreen.closeDocument(); }
      catch (error) { console.warn("Could not close screenshot document:", error.message); }
    }
    busy = false;
  }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.target !== "background") return;
  const format = message.format || "png";
  if (sender.url !== chrome.runtime.getURL("popup.html") || !["copy", "save"].includes(message.action) || !["png", "zip", "pdf", "txt"].includes(format) || (message.action === "copy" && !["png", "txt"].includes(format))) {
    respond({ok: false, error: "Invalid capture request."});
    return;
  }
  capture(message.tabId, message.action, format).then(respond).catch((error) => respond({ok: false, error: error.message}));
  return true;
});
