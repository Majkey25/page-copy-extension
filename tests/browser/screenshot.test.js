import assert from "node:assert/strict";
import {createServer} from "node:http";
import {mkdir, mkdtemp, readFile, rm} from "node:fs/promises";
import {resolve, sep} from "node:path";
import {setTimeout as delay} from "node:timers/promises";
import test, {before, after} from "node:test";
import {chromium} from "playwright";
import {unzipSync} from "fflate";

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
  await waitFor(() => evaluate('document.readyState === "complete" && document.querySelectorAll("button").length === 3'), 5000);
  return {
    errors, evaluate,
    async click(action) {
      assert.ok(["copy", "save", "text"].includes(action));
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

async function scenario(origin, {width = 1200, height = 9831, dpr = 1, zoom = 1, action = "copy", format = "png", noiseHeight = 0, closePopup = false, resize = false, headed = false, slowImage = false, navigate = false}) {
  const ratio = dpr * zoom;
  await mkdir(temporary, {recursive: true});
  const profile = await mkdtemp(resolve(temporary, "chromium-"));
  let context;
  let popup;
  try {
    context = await chromium.launchPersistentContext(profile, {
      channel: "chromium", headless: !headed, viewport: {width: 1200, height: 800}, deviceScaleFactor: dpr,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, `--force-device-scale-factor=${dpr}`, "--enable-unsafe-extension-debugging"],
      acceptDownloads: true,
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    const extensionId = worker.url().split("/")[2];
    const source = context.pages()[0];
    await source.goto(`${origin}/fixture`);
    if (zoom !== 1) await worker.evaluate(async (zoom) => {
      const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
      await chrome.tabs.setZoom(tab.id, zoom);
    }, zoom);
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
    assert.ok(Math.abs(await source.evaluate(() => devicePixelRatio) - ratio) < 0.001);
    const originalScroll = await source.evaluate(() => scrollY);
    let expectedScroll = originalScroll;
    if (action === "save") {
      const protocol = await context.browser().newBrowserCDPSession();
      await protocol.send("Browser.setDownloadBehavior", {behavior: "allow", downloadPath: profile});
    }
    popup = await openPopup(context, source, extensionId);
    await source.evaluate(async () => {
      await document.fonts.ready;
      window.scrollTo({top: 1900, behavior: "instant"});
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    const visible = await worker.evaluate(() => chrome.tabs.captureVisibleTab(undefined, {format: "png"}));
    const referenceData = await source.evaluate(async ({visible, ratio}) => {
      const bitmap = await createImageBitmap(await (await fetch(visible)).blob());
      const bounds = document.querySelector(".tiny").getBoundingClientRect();
      const canvas = new OffscreenCanvas(Math.round(bounds.width * ratio), Math.round(bounds.height * ratio));
      canvas.getContext("2d").drawImage(bitmap, -Math.round(bounds.left * ratio), -Math.round(bounds.top * ratio));
      bitmap.close();
      const blob = await canvas.convertToBlob({type: "image/png"});
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(blob);
      });
    }, {visible, ratio});
    const reference = Buffer.from(referenceData.split(",")[1], "base64");
    await source.evaluate((top) => window.scrollTo({top, behavior: "instant"}), originalScroll);
    if (slowImage) await source.evaluate(() => {
      const image = new Image();
      image.id = "slow";
      image.src = "/never.svg";
      document.body.append(image);
      const paragraph = document.createElement("p");
      paragraph.textContent = "malformed \ud800";
      document.body.append(paragraph);
    });
    if (resize === "always") await popup.evaluate(`(() => {
      new MutationObserver(() => {
        if (/^Capturing 1 \\//.test(document.querySelector("#status").textContent)) {
          chrome.tabs.query({active: true, currentWindow: true}).then(([tab]) => chrome.scripting.executeScript({target: {tabId: tab.id}, func: () => {
            document.body.style.height = (document.body.scrollHeight + 300) + "px";
            document.body.dataset.captureGrowthCount = String(Number(document.body.dataset.captureGrowthCount || 0) + 1);
          }}));
        }
      }).observe(document.querySelector("#status"), {childList: true});
    })()`);
    await popup.evaluate(`document.querySelector("#save-format").value = ${JSON.stringify(format)}`);
    await popup.click(action);
    if (resize === true) {
      await waitFor(async () => /Capturing/.test(await popup.evaluate('document.querySelector("#status").textContent')));
      await source.evaluate(() => {
        document.body.style.height = `${document.body.scrollHeight + 300}px`;
      });
      height += 300;
    }
    if (navigate) {
      await waitFor(async () => /Capturing/.test(await popup.evaluate('document.querySelector("#status").textContent')));
      await source.goto(`${origin}/replacement`);
      await source.evaluate(() => window.scrollTo({top: 300, behavior: "instant"}));
      expectedScroll = await source.evaluate(() => scrollY);
    }
    if (closePopup) {
      await waitFor(async () => await source.evaluate(() => scrollY) !== originalScroll);
      await popup.close();
      await waitFor(async () => await source.evaluate(() => scrollY) === originalScroll);
    } else if (navigate) {
      await waitFor(async () => (await worker.evaluate(() => chrome.runtime.getContexts({contextTypes: ["OFFSCREEN_DOCUMENT"]}))).length === 0);
    } else {
      const state = await waitFor(async () => {
        const value = await popup.evaluate('({busy: document.querySelector("#copy-button").disabled, status: document.querySelector("#status").textContent})');
        return !value.busy && value;
      });
      if (resize === "always") {
        assert.match(state.status, /kept changing size after 3 capture attempts/);
        assert.equal(await source.evaluate(() => document.body.dataset.captureGrowthCount), "3");
      } else if (noiseHeight === 12000) {
        assert.match(state.status, /PNG exceeds/);
      } else if (format === "png" && Math.ceil(height * ratio) > 32767) {
        assert.match(state.status, /too large for one lossless PNG/);
      } else if (action === "save") {
        assert.match(state.status, /Save dialog opened/);
        const download = await waitFor(async () => {
          const [item] = await worker.evaluate(() => chrome.downloads.search({limit: 1, orderBy: ["-startTime"]}));
          return item?.state === "complete" && item;
        });
        const file = await readFile(download.filename);
        assert.ok(download.filename.endsWith(`.${format}`));
        if (format === "png") {
          assert.ok(file.length > 2_000_000, "Verify the real download path with a large image.");
          assert.equal(file.readUInt32BE(16), Math.ceil(width * ratio));
          assert.equal(file.readUInt32BE(20), Math.ceil(height * ratio));
        } else if (format === "zip") {
          const entries = unzipSync(file);
          assert.match(new TextDecoder().decode(entries["page.txt"]), /Příliš žluťoučký kůň/);
          const manifest = JSON.parse(new TextDecoder().decode(entries["tiles.json"]));
          assert.equal(manifest.width, Math.ceil(width * dpr));
          assert.equal(manifest.height, Math.ceil(height * dpr));
          assert.equal(manifest.pixelRatio, dpr);
          for (const tile of manifest.tiles) {
            const png = Buffer.from(entries[tile.name]);
            assert.equal(png.readUInt32BE(16), tile.width);
            assert.equal(png.readUInt32BE(20), tile.height);
            assert.ok(tile.width <= 1536 && tile.height <= 1536);
          }
          const last = manifest.tiles.at(-1);
          assert.equal(last.y + last.height, Math.ceil(height * dpr));
          const tile = manifest.tiles.find((tile) => tile.x === 0 && tile.y <= 2040 * dpr && tile.y + tile.height >= 2104 * dpr);
          assert.ok(tile, "The overlap must keep the small text together in an AI tile.");
          const matches = await source.evaluate(async ({reference, png, tile, dpr}) => {
            const decode = async (data) => createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
            const baseline = await decode(reference);
            const image = await decode(png);
            const canvas = new OffscreenCanvas(baseline.width, baseline.height);
            const drawing = canvas.getContext("2d");
            drawing.drawImage(baseline, 0, 0);
            const expected = drawing.getImageData(0, 0, canvas.width, canvas.height).data;
            drawing.clearRect(0, 0, canvas.width, canvas.height);
            drawing.drawImage(image, tile.x - 20 * dpr, tile.y - 2040 * dpr);
            const actual = drawing.getImageData(0, 0, canvas.width, canvas.height).data;
            baseline.close(); image.close();
            return expected.every((byte, index) => byte === actual[index]);
          }, {reference: reference.toString("base64"), png: Buffer.from(entries[tile.name]).toString("base64"), tile, dpr});
          assert.ok(matches, "AI tile must preserve every original small-text pixel.");
        } else if (format === "txt") {
          assert.match(file.toString("utf8"), /Příliš žluťoučký kůň/);
          assert.match(file.toString("utf8"), /FINAL PIXEL/);
          assert.ok(!file.toString("utf8").includes("HIDDEN TEXT MUST NOT LEAK"));
          if (slowImage) {
            assert.match(file.toString("utf8"), /malformed \ufffd/);
            assert.equal(await source.evaluate(() => document.querySelector("#slow").complete), false);
          }
        } else {
          assert.equal(file.subarray(0, 5).toString(), "%PDF-");
          assert.match(file.toString("latin1"), /\/Type\s*\/Page\b/);
          assert.match(file.toString("latin1"), /\/Font\b/);
        }
      } else if (action === "text") {
        assert.match(state.status, /Copied page text/);
        await context.grantPermissions(["clipboard-read"], {origin});
        await source.bringToFront();
        const text = await source.evaluate(() => navigator.clipboard.readText());
        assert.match(text, /Příliš žluťoučký kůň/);
        assert.match(text, /FINAL PIXEL/);
        assert.ok(!text.includes("HIDDEN TEXT MUST NOT LEAK"));
      } else {
        assert.match(state.status, /Copied/);
        await context.grantPermissions(["clipboard-read"], {origin});
        await source.bringToFront();
        const image = await source.evaluate(async ({width, height, dpr, reference}) => {
          const [item] = await navigator.clipboard.read();
          const bitmap = await createImageBitmap(await item.getType("image/png"));
          const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
          const drawing = canvas.getContext("2d");
          drawing.drawImage(bitmap, 0, 0);
          const pixel = (x, y) => [...drawing.getImageData(Math.floor(x * bitmap.width / width), Math.floor(y * bitmap.height / height), 1, 1).data].slice(0, 3);
          const baseline = await createImageBitmap(await (await fetch(`data:image/png;base64,${reference}`)).blob());
          const small = new OffscreenCanvas(baseline.width, baseline.height);
          const smallDrawing = small.getContext("2d");
          smallDrawing.drawImage(baseline, 0, 0);
          const expected = smallDrawing.getImageData(0, 0, baseline.width, baseline.height).data;
          const actual = drawing.getImageData(20 * dpr, 2040 * dpr, baseline.width, baseline.height).data;
          const differences = [...expected.keys()].filter((index) => expected[index] !== actual[index]);
          const headerX = Math.min(1100, window.innerWidth - 1);
          const result = {width: bitmap.width, height: bitmap.height, exactTextPixels: expected.every((byte, index) => byte === actual[index]), differences: {count: differences.length, first: differences.slice(0, 8).map((index) => ({index, expected: expected[index], actual: actual[index]}))}, top: pixel(headerX, 10), middle: pixel(110, 4010), lazy: pixel(310, 7010), last: pixel(width - 1, height - 1), seam: pixel(headerX, 2050)};
          baseline.close();
          bitmap.close();
          return result;
        }, {width, height, dpr: ratio, reference: reference.toString("base64")});
        assert.equal(image.width, Math.ceil(width * ratio));
        assert.equal(image.height, Math.ceil(height * ratio));
        assert.ok(image.exactTextPixels, `Clipboard must preserve every original nine-pixel-text pixel: ${JSON.stringify(image.differences)}`);
        assert.deepEqual(image.top, [220, 30, 30]);
        assert.deepEqual(image.middle, [20, 180, 40]);
        assert.deepEqual(image.lazy, [180, 20, 200]);
        assert.deepEqual(image.last, [20, 60, 210]);
        assert.notDeepEqual(image.seam, image.top, "The fixed header must not repeat at tile boundaries.");
      }
    }
    assert.equal(await source.evaluate(() => scrollY), expectedScroll);
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

let server;
let origin;
before(async () => {
  const fixture = await readFile(new URL("fixture.html", import.meta.url));
  server = createServer((request, response) => {
    if (request.url === "/never.svg") {
      response.writeHead(200, {"Content-Type": "image/svg+xml"});
      response.write("<svg");
    } else if (request.url.startsWith("/lazy.svg")) {
      response.setHeader("Content-Type", "image/svg+xml");
      response.end('<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" fill="rgb(180,20,200)"/></svg>');
    } else if (["/fixture", "/replacement"].includes(request.url)) {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(fixture);
    } else { response.writeHead(404); response.end(); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

const scenarios = [
  ["clipboard pixels, lazy content, hidden images, and fixed header", {}],
  ["HiDPI capture preserves the final row", {dpr: 2}],
  ["fractional HiDPI keeps native text pixels", {dpr: 1.25}],
  ["browser page zoom preserves native text pixels", {zoom: 1.25}],
  ["50,000-pixel PNG refuses silent shrinking", {height: 50000}],
  ["50,000-pixel page exports native AI tiles and text", {height: 50000, action: "save", format: "zip"}],
  ["HiDPI AI tiles keep original text pixels", {dpr: 1.25, action: "save", format: "zip"}],
  ["copy text for AI preserves Czech and excludes hidden text", {action: "text"}],
  ["save UTF-8 page text", {action: "save", format: "txt"}],
  ["text export works with stalled images and malformed Unicode", {action: "save", format: "txt", slowImage: true}],
  ["save PDF with native text fonts in a headed browser", {action: "save", format: "pdf", headed: process.platform === "win32"}],
  ["page growth during capture retries with the complete new height", {resize: true}],
  ["a continuously growing page stops safely after three attempts", {resize: "always"}],
  ["horizontal overflow is included", {width: 4301}],
  ["Save as downloads a real PNG above 2 MB", {action: "save", noiseHeight: 3200}],
  ["oversized PNG fails cleanly", {height: 15000, noiseHeight: 12000}],
  ["closing the popup does not leave page or debugger changed", {closePopup: true}],
  ["navigation during capture never scrolls the replacement document", {navigate: true}],
];
for (const [name, options] of scenarios) test(name, {timeout: 120_000}, () => scenario(origin, options));
