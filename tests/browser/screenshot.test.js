import assert from "node:assert/strict";
import {createServer} from "node:http";
import {mkdir, mkdtemp, readFile, rm} from "node:fs/promises";
import {resolve, sep} from "node:path";
import {setTimeout as delay} from "node:timers/promises";
import test from "node:test";
import {chromium} from "playwright";

const root = resolve(import.meta.dirname, "../..");
const extension = resolve(root, "dist/page-copy-extension");
const temporary = resolve(root, ".reference/tmp");

async function waitFor(read, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await read();
    if (result) return result;
    await delay(100);
  }
  throw new Error("Timed out waiting for the real browser workflow.");
}

// Toolbar popups are CDP targets, but are not exposed as Playwright pages.
async function openPopup(context, source, extensionId) {
  await source.bringToFront();
  const protocol = await context.browser().newBrowserCDPSession();
  const {targetInfos} = await protocol.send("Target.getTargets", {filter: [{type: "tab"}]});
  const tab = targetInfos.find((target) => target.url === source.url());
  assert.ok(tab, "The source must be a real browser tab.");
  await protocol.send("Extensions.triggerAction", {id: extensionId, targetId: tab.targetId});
  const popup = await waitFor(async () => {
    const targets = await protocol.send("Target.getTargets");
    return targets.targetInfos.find((target) => target.url === `chrome-extension://${extensionId}/popup.html`);
  }, 5000);
  const {sessionId} = await protocol.send("Target.attachToTarget", {targetId: popup.targetId, flatten: false});
  const pending = new Map();
  const errors = [];
  let nextId = 0;
  const receive = (event) => {
    if (event.sessionId !== sessionId) return;
    const message = JSON.parse(event.message);
    const request = pending.get(message.id);
    if (request) {
      clearTimeout(request.timer);
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
    }
    if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.text);
  };
  protocol.on("Target.receivedMessageFromTarget", receive);
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Popup command timed out: ${method}`)); }, 15_000);
    pending.set(id, {resolve, reject, timer});
    protocol.send("Target.sendMessageToTarget", {sessionId, message: JSON.stringify({id, method, params})}).catch((error) => {
      clearTimeout(timer);
      pending.delete(id);
      reject(error);
    });
  });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", {expression, returnByValue: true, awaitPromise: true});
    assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  await send("Runtime.enable");
  await waitFor(() => evaluate('document.readyState === "complete" && document.querySelectorAll("button").length === 2'), 5000);
  assert.equal(await evaluate('document.querySelectorAll("button").length'), 2);
  return {
    errors, evaluate,
    async click(action) {
      assert.ok(["copy", "save"].includes(action));
      const point = await evaluate(`(() => {const r = document.querySelector("#${action}-button").getBoundingClientRect(); return {x: r.x + r.width / 2, y: r.y + r.height / 2};})()`);
      await send("Input.dispatchMouseEvent", {type: "mousePressed", button: "left", clickCount: 1, ...point});
      await send("Input.dispatchMouseEvent", {type: "mouseReleased", button: "left", clickCount: 1, ...point});
    },
    close: () => protocol.send("Target.closeTarget", {targetId: popup.targetId}),
    dispose() {
      protocol.off("Target.receivedMessageFromTarget", receive);
      for (const request of pending.values()) {
        clearTimeout(request.timer);
        request.reject(new Error("Popup disposed."));
      }
      pending.clear();
    },
  };
}

async function scenario(origin, {width = 1200, height = 9831, dpr = 1, action = "copy", noiseHeight = 0, closePopup = false}) {
  await mkdir(temporary, {recursive: true});
  const profile = await mkdtemp(resolve(temporary, "chromium-"));
  let context;
  let popup;
  try {
    context = await chromium.launchPersistentContext(profile, {
      channel: "chromium", headless: true, viewport: {width: 1200, height: 800}, deviceScaleFactor: dpr,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, "--enable-unsafe-extension-debugging"],
      acceptDownloads: true,
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    const extensionId = worker.url().split("/")[2];
    const source = context.pages()[0];
    await source.goto(`${origin}/fixture`);
    await source.evaluate(({width, height, noiseHeight}) => {
      document.body.style.width = `${width}px`;
      document.body.style.height = `${height}px`;
      if (noiseHeight) {
        const canvas = document.createElement("canvas");
        canvas.width = 1200;
        canvas.height = noiseHeight;
        canvas.style.cssText = "position:absolute;top:1000px;left:0";
        document.body.append(canvas);
        const drawing = canvas.getContext("2d");
        const data = drawing.createImageData(canvas.width, canvas.height);
        let seed = 123456789;
        for (let index = 0; index < data.data.length; index += 4) {
          seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
          data.data[index] = seed & 255;
          data.data[index + 1] = (seed >>> 8) & 255;
          data.data[index + 2] = (seed >>> 16) & 255;
          data.data[index + 3] = 255;
        }
        drawing.putImageData(data, 0, 0);
      }
      window.scrollTo({top: 1370, behavior: "instant"});
    }, {width, height, noiseHeight});
    if (action === "save") {
      const protocol = await context.browser().newBrowserCDPSession();
      await protocol.send("Browser.setDownloadBehavior", {behavior: "allow", downloadPath: profile});
    }
    popup = await openPopup(context, source, extensionId);
    await popup.click(action);
    if (closePopup) {
      await waitFor(async () => await source.evaluate(() => scrollY) !== 1370);
      await popup.close();
      await waitFor(async () => await source.evaluate(() => scrollY) === 1370);
    } else {
      const state = await waitFor(async () => {
        const value = await popup.evaluate('({busy: document.querySelector("#copy-button").disabled, status: document.querySelector("#status").textContent})');
        return !value.busy && value;
      });
      if (noiseHeight === 12000) {
        assert.match(state.status, /PNG exceeds/);
      } else if (action === "save") {
        assert.match(state.status, /Save dialog opened/);
        const download = await waitFor(async () => {
          const [item] = await worker.evaluate(() => chrome.downloads.search({limit: 1, orderBy: ["-startTime"]}));
          return item?.state === "complete" && item;
        });
        const png = await readFile(download.filename);
        assert.ok(png.length > 2_000_000, "Verify the real download path with a large image.");
        assert.equal(png.readUInt32BE(16), width);
        assert.equal(png.readUInt32BE(20), height);
      } else {
        assert.match(state.status, /Copied/);
        await context.grantPermissions(["clipboard-read"], {origin});
        await source.bringToFront();
        const image = await source.evaluate(async ({width, height}) => {
          const [item] = await navigator.clipboard.read();
          const bitmap = await createImageBitmap(await item.getType("image/png"));
          const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
          const drawing = canvas.getContext("2d");
          drawing.drawImage(bitmap, 0, 0);
          const pixel = (x, y) => [...drawing.getImageData(Math.floor(x * bitmap.width / width), Math.floor(y * bitmap.height / height), 1, 1).data].slice(0, 3);
          const result = {width: bitmap.width, height: bitmap.height, top: pixel(1100, 10), middle: pixel(110, 4010), lazy: pixel(310, 7010), last: pixel(width - 1, height - 1), seam: pixel(1100, 2050)};
          bitmap.close();
          return result;
        }, {width, height});
        const scale = Math.min(1, 32767 / height, Math.sqrt(64_000_000 / (width * height)));
        assert.equal(image.width, Math.floor(width * scale));
        assert.equal(image.height, Math.floor(height * scale));
        assert.deepEqual(image.top, [220, 30, 30]);
        assert.deepEqual(image.middle, [20, 180, 40]);
        assert.deepEqual(image.lazy, [180, 20, 200]);
        assert.deepEqual(image.last, [20, 60, 210]);
        assert.notDeepEqual(image.seam, image.top, "The fixed header must not repeat at tile boundaries.");
      }
    }
    assert.equal(await source.evaluate(() => scrollY), 1370);
    await waitFor(async () => (await worker.evaluate(() => chrome.runtime.getContexts({contextTypes: ["OFFSCREEN_DOCUMENT"]}))).length === 0);
    await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
      await chrome.debugger.attach({tabId: tab.id}, "1.3");
      await chrome.debugger.detach({tabId: tab.id});
    });
    assert.deepEqual(popup.errors, []);
  } finally {
    popup?.dispose();
    await context?.close();
    assert.ok(profile.startsWith(`${temporary}${sep}`));
    await rm(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 200});
  }
}

test("packaged extension captures through the real toolbar popup", {timeout: 240_000}, async (t) => {
  const fixture = await readFile(new URL("fixture.html", import.meta.url));
  const server = createServer((request, response) => {
    if (request.url.startsWith("/lazy.svg")) {
      response.setHeader("Content-Type", "image/svg+xml");
      response.end('<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" fill="rgb(180,20,200)"/></svg>');
    } else if (request.url === "/fixture") {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(fixture);
    } else { response.writeHead(404); response.end(); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    await t.test("clipboard pixels, lazy content, hidden images, and fixed header", () => scenario(origin, {}));
    await t.test("HiDPI capture preserves the final row", () => scenario(origin, {dpr: 2}));
    await t.test("50,000-pixel page retains its bottom after scaling", () => scenario(origin, {height: 50000}));
    await t.test("horizontal overflow is included", () => scenario(origin, {width: 4301}));
    await t.test("Save as downloads a real PNG above 2 MB", () => scenario(origin, {action: "save", noiseHeight: 3200}));
    await t.test("oversized PNG fails cleanly", () => scenario(origin, {height: 15000, noiseHeight: 12000}));
    await t.test("closing the popup does not leave page or debugger changed", () => scenario(origin, {closePopup: true}));
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
