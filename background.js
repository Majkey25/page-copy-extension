import {capturePlan, preparePage, restorePage, screenshotFilename} from "./capture.js";

let busy = false;

function progress(status) {
  chrome.runtime.sendMessage({target: "popup", status}).catch(() => {});
}

async function imageCommand(action, payload = {}) {
  const result = await chrome.runtime.sendMessage({target: "offscreen", action, ...payload});
  if (!result?.ok) throw new Error(result?.error || "Could not assemble the screenshot.");
  return result;
}

async function capture(tabId, action) {
  if (busy) throw new Error("A capture is already running. Please wait.");
  if (!Number.isInteger(tabId)) throw new Error("Open a web page first.");
  busy = true;
  const target = {tabId};
  let attached = false;
  let offscreen = false;
  let position;
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!/^https?:\/\//i.test(tab.url || "")) throw new Error("Open a normal website. Browser pages and PDFs are not supported.");
    try {
      await chrome.debugger.attach(target, "1.3");
      attached = true;
    } catch (error) {
      throw new Error(`Cannot capture this tab. Close its DevTools and try again. ${error.message}`, {cause: error});
    }
    const [prepared] = await chrome.scripting.executeScript({target: {tabId}, func: preparePage});
    if (prepared?.result?.error) throw new Error(prepared.result.error);
    position = prepared?.result?.position;
    if (!position) throw new Error("The page changed during capture. Please try again.");
    const metrics = await chrome.debugger.sendCommand(target, "Page.getLayoutMetrics");
    const {width, height} = metrics.cssContentSize;
    const plan = capturePlan(width, height);
    if ((await chrome.runtime.getContexts({contextTypes: ["OFFSCREEN_DOCUMENT"]})).length) {
      await chrome.offscreen.closeDocument();
    }
    await chrome.offscreen.createDocument({url: "offscreen.html", reasons: ["BLOBS"], justification: "Assemble screenshot tiles into one PNG locally."});
    offscreen = true;
    await imageCommand("start", {width: plan.width, height: plan.height});
    for (const [index, tile] of plan.tiles.entries()) {
      progress(`Capturing ${index + 1} / ${plan.tiles.length}…`);
      const shot = await chrome.debugger.sendCommand(target, "Page.captureScreenshot", {
        format: "png", clip: tile.clip, captureBeyondViewport: true, fromSurface: true,
      });
      await imageCommand("tile", {data: shot.data, destination: tile.destination});
    }
    const after = await chrome.debugger.sendCommand(target, "Page.getLayoutMetrics");
    if (after.cssContentSize.width !== width || after.cssContentSize.height !== height) {
      throw new Error("The page changed size during capture. Wait for it to finish loading and try again.");
    }
    progress("Creating PNG…");
    const {dataUrl} = await imageCommand("finish");
    if (action === "save") {
      await chrome.downloads.download({url: dataUrl, filename: screenshotFilename(tab.title), saveAs: true});
      return {ok: true};
    }
    return {ok: true, dataUrl};
  } finally {
    if (position) {
      try {
        await chrome.scripting.executeScript({target: {tabId}, func: restorePage, args: [position]});
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
  if (sender.url !== chrome.runtime.getURL("popup.html") || !["copy", "save"].includes(message.action)) {
    respond({ok: false, error: "Invalid capture request."});
    return;
  }
  capture(message.tabId, message.action).then(respond).catch((error) => respond({ok: false, error: error.message}));
  return true;
});
