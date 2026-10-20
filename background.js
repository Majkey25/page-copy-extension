import {capturePlan, preparePage, readPage, restorePage, screenshotFilename} from "./capture.js";
import {EXPORT_LIMIT, FORMATS, textDataUrl} from "./formats.js";
import {readExport} from "./page-data.js";

let busy = false;

function progress(status) {
  chrome.runtime.sendMessage({target: "popup", status}).catch(() => {});
}

async function imageCommand(action, payload = {}) {
  const result = await chrome.runtime.sendMessage({target: "offscreen", action, ...payload});
  if (!result?.ok) throw new Error(result?.error || "Could not assemble the export.");
  return result;
}

async function captureCommand(target, method, params) {
  let timer;
  try {
    return await Promise.race([
      chrome.debugger.sendCommand(target, method, params),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${method} timed out. The page may have navigated; try again.`)), 30_000); }),
    ]);
  } finally { clearTimeout(timer); }
}

async function openOffscreen() {
  if ((await chrome.runtime.getContexts({contextTypes: ["OFFSCREEN_DOCUMENT"]})).length) await chrome.offscreen.closeDocument();
  await chrome.offscreen.createDocument({url: "offscreen.html", reasons: ["BLOBS"], justification: "Assemble lossless images and page archives locally."});
}

async function pageFiles(tabId, format, documentId) {
  const target = documentId ? {tabId, documentIds: [documentId]} : {tabId};
  const scripts = [];
  if (["md", "bundle"].includes(format)) scripts.push("vendor/turndown.js", "vendor/turndown-plugin-gfm.js");
  if (["svg", "bundle"].includes(format)) scripts.push("vendor/purify.min.js");
  if (scripts.length) await chrome.scripting.executeScript({target, files: scripts});
  const [page] = await chrome.scripting.executeScript({target, func: readExport, args: [format]});
  if (page?.result?.error) throw new Error(page.result.error);
  if (!page?.result) throw new Error("The page changed during export. Please try again.");
  return page.result;
}

async function nativeFile(target, format) {
  progress(format === "pdf" ? "Creating PDF…" : "Creating offline MHTML…");
  if (format === "pdf") {
    const {data} = await captureCommand(target, "Page.printToPDF", {printBackground: true, preferCSSPageSize: true, generateTaggedPDF: true});
    if (data.length > Math.ceil(EXPORT_LIMIT / 3) * 4) throw new Error("The PDF exceeds the browser's transfer limit. Use text or a shorter page.");
    return {name: "page.pdf", base64: data};
  }
  const {data} = await captureCommand(target, "Page.captureSnapshot", {format: "mhtml"});
  if (new TextEncoder().encode(data).length > EXPORT_LIMIT) throw new Error("The MHTML exceeds the browser's transfer limit. Export a smaller page.");
  return {name: "page.mhtml", text: data};
}

async function captureImage(tabId, documentId, target, tiled) {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) {
      progress("Page resized. Retrying capture…");
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    const metrics = await captureCommand(target, "Page.getLayoutMetrics");
    const {width, height} = metrics.cssContentSize;
    const zoom = await chrome.tabs.getZoom(tabId);
    const [page] = await chrome.scripting.executeScript({target: {tabId, documentIds: [documentId]}, func: readPage, args: [false]});
    if (!page?.result) throw new Error("The page changed during capture. Please try again.");
    const plan = capturePlan(width, height, page.result.pixelRatio, tiled, zoom);
    await imageCommand("start", {...plan, tiled});
    for (const [index, tile] of plan.tiles.entries()) {
      progress(`Capturing ${index + 1} / ${plan.tiles.length}…`);
      const shot = await captureCommand(target, "Page.captureScreenshot", {format: "png", clip: tile.clip, captureBeyondViewport: true, fromSurface: true});
      await imageCommand("tile", {data: shot.data, destination: tile.destination, padding: Math.ceil(plan.pixelRatio / zoom)});
    }
    const after = await captureCommand(target, "Page.getLayoutMetrics");
    const widthAfter = Math.ceil(after.cssContentSize.width * plan.pixelRatio);
    const heightAfter = Math.ceil(after.cssContentSize.height * plan.pixelRatio);
    if (widthAfter === plan.width && heightAfter === plan.height) return plan;
    if (attempt === 2 && widthAfter === plan.width && heightAfter > plan.height) return {...plan, warning: "The page kept growing. Captured the area measured at the start of the final attempt; newly added content is outside the image."};
  }
  throw new Error("The page kept changing size after 3 capture attempts. Pause live content or use text/PDF.");
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
    const bundle = format === "bundle";
    const warnings = [];
    const save = async (url) => {
      await chrome.action.setTitle({tabId, title: warnings.length ? `Last export: ${warnings.map((warning) => warning.reason).join(" ")}` : "Page Copy"});
      await chrome.downloads.download({url, filename: screenshotFilename(tab.title, FORMATS[format].extension), saveAs: true});
      return {ok: true, warnings};
    };
    if (["txt", "md", "json", "html", "svg"].includes(format)) {
      let files;
      if (format === "txt") {
        const [page] = await chrome.scripting.executeScript({target: {tabId}, func: readPage});
        if (page?.result?.error) throw new Error(page.result.error);
        if (!page?.result) throw new Error("The page changed during export. Please try again.");
        files = [{name: "page.txt", text: page.result.text}];
      } else ({files} = await pageFiles(tabId, format));
      if (action === "copy") return {ok: true, text: files.map((file) => format === "svg" ? `<!-- ${file.name} -->\n${file.text}` : file.text).join("\n\n")};
      if (format !== "svg") return save(textDataUrl(files[0].text, FORMATS[format].mime));
      await openOffscreen();
      offscreen = true;
      await imageCommand("start", {tiled: true});
      for (const file of files) await imageCommand("file", {file});
      const {dataUrl} = await imageCommand("finish", {archiveOnly: true, guide: FORMATS.svg.detail, manifest: {format: "svg", source: tab.url, capturedAt: new Date().toISOString(), warnings: []}});
      return save(dataUrl);
    }
    try {
      await chrome.debugger.attach(target, "1.3");
      attached = true;
    } catch (error) {
      throw new Error(`Cannot capture this tab. Close its DevTools and try again. ${error.message}`, {cause: error});
    }
    const [prepared] = await chrome.scripting.executeScript({target: {tabId}, func: preparePage});
    if (prepared?.result?.error) {
      if (!bundle) throw new Error(prepared.result.error);
      warnings.push({format: "png", reason: `${prepared.result.error} Lazy content may also be incomplete in the other formats.`});
    }
    position = prepared?.result?.position;
    documentId = prepared?.documentId;
    if (!documentId || (!prepared.result?.error && !position)) throw new Error("The page changed during capture. Please try again.");
    for (const reason of prepared.result?.warnings || []) warnings.push({format: "preparation", reason});
    const verifyDocument = async () => {
      const [page] = await chrome.scripting.executeScript({target: {tabId, documentIds: [documentId]}, func: readPage, args: [false]});
      if (!page?.result) throw new Error("The page changed during export. Please try again.");
    };
    if (["pdf", "mhtml"].includes(format)) {
      const file = await nativeFile(target, format);
      await verifyDocument();
      if (action === "copy") {
        if (file.text.length > 8_000_000) throw new Error("The MHTML is too large for source-text copying. Save and attach the file instead.");
        return {ok: true, text: file.text, warnings};
      }
      return save(file.base64 ? `data:application/pdf;base64,${file.base64}` : textDataUrl(file.text, FORMATS.mhtml.mime));
    }
    await openOffscreen();
    offscreen = true;
    let plan;
    try {
      if (prepared.result?.error) await imageCommand("start", {tiled: true});
      else plan = await captureImage(tabId, documentId, target, bundle || format === "zip");
      if (plan?.warning) warnings.push({format: "png", reason: plan.warning});
    }
    catch (error) {
      if (!bundle) throw error;
      warnings.push({format: "png", reason: error.message});
      await imageCommand("start", {tiled: true});
    }
    if (bundle) {
      try {
        const page = await pageFiles(tabId, "bundle", documentId);
        warnings.push(...page.warnings);
        for (const file of page.files) {
          try { await imageCommand("file", {file}); }
          catch (error) { warnings.push({file: file.name, reason: error.message}); }
        }
      } catch (error) { warnings.push({format: "page data", reason: error.message}); }
      for (const format of ["mhtml", "pdf"]) {
        try { await imageCommand("file", {file: await nativeFile(target, format)}); }
        catch (error) { warnings.push({format, reason: error.message}); }
      }
      await verifyDocument();
    }
    progress(bundle ? "Creating complete archive…" : format === "zip" ? "Creating AI archive…" : "Creating PNG…");
    const [finishedPage] = await chrome.scripting.executeScript({target: {tabId, documentIds: [documentId]}, func: readPage, args: [format === "zip"]});
    if (finishedPage?.result?.error) throw new Error(finishedPage.result.error);
    if (!finishedPage?.result) throw new Error("The page changed during export. Please try again.");
    const {dataUrl} = await imageCommand("finish", {
      width: plan?.width, height: plan?.height, pixelRatio: plan?.pixelRatio, text: finishedPage.result.text,
      bundle, guide: FORMATS.bundle.detail, warnings,
      manifest: bundle ? {schemaVersion: 1, source: tab.url, title: tab.title, capturedAt: new Date().toISOString(), warnings} : undefined,
    });
    return action === "save" ? save(dataUrl) : {ok: true, dataUrl, warnings};
  } finally {
    if (position && documentId) {
      try { await chrome.scripting.executeScript({target: {tabId, documentIds: [documentId]}, func: restorePage, args: [position]}); }
      catch (error) { console.warn("Could not restore page position:", error.message); }
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
  if (sender.url !== chrome.runtime.getURL("popup.html") || !["copy", "save"].includes(message.action) || !Object.hasOwn(FORMATS, format) || (message.action === "copy" && !FORMATS[format].copy)) {
    respond({ok: false, error: "Invalid capture request."});
    return;
  }
  capture(message.tabId, message.action, format).then(respond).catch((error) => respond({ok: false, error: error.message}));
  return true;
});
