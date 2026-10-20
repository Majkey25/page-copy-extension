import assert from "node:assert/strict";
import {createServer} from "node:http";
import {mkdir, mkdtemp, readFile, rm} from "node:fs/promises";
import {resolve, sep} from "node:path";
import {setTimeout as delay} from "node:timers/promises";
import test, {before, after} from "node:test";
import {chromium} from "playwright";
import {unzipSync} from "fflate";
import {FORMATS} from "../../formats.js";
import {pathToFileURL} from "node:url";

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

async function verifyExport(context, source, bytes, format, origin, partial, filename) {
  const text = bytes.toString("utf8");
  if (format === "md") {
    assert.match(text, /## Export tools/);
    assert.ok(text.includes(`[source link](${origin}/details?example=1)`));
    assert.match(text, /Visible child/);
    assert.match(text, /Visible summary/);
    assert.match(text, /\| Item \| Value \|/);
    assert.match(text, /```js\r?\nconst greeting/);
    assert.ok(!text.includes("HIDDEN TEXT MUST NOT LEAK"));
    assert.ok(!text.includes("exportScriptRan"));
  } else if (format === "json") {
    const page = JSON.parse(text);
    assert.equal(page.schemaVersion, 1);
    assert.equal(page.url, `${origin}/fixture`);
    assert.ok(page.headings.some((heading) => heading.level === 2 && heading.text === "Export tools"));
    assert.ok(page.links.some((link) => link.url === `${origin}/details?example=1`));
    assert.ok(page.links.some((link) => link.url === `${origin}/vector-link`));
    assert.deepEqual(page.tables[0].rows, [["Item", "Value"], ["Žluťoučký", "1.25"]]);
    assert.ok(!text.includes("HIDDEN TEXT MUST NOT LEAK"));
  } else if (format === "html") {
    assert.match(text, /^<!doctype html>/);
    assert.match(text, /Content-Security-Policy/);
    assert.match(text, /default-src 'none'/);
    assert.match(text, /window.exportScriptRan = true/);
    assert.ok(text.includes(`<base href="${origin}/fixture">`));
  } else if (format === "mhtml") {
    assert.match(text, /Content-Type: multipart\/related/);
    assert.match(text, /Content-Type: image\/svg\+xml/);
    assert.match(text, /Content-Type: text\/css/);
  } else {
    const entries = unzipSync(bytes);
    const manifest = JSON.parse(new TextDecoder().decode(entries["manifest.json"]));
    assert.deepEqual(manifest.files.map((file) => file.name).sort(), Object.keys(entries).filter((name) => name !== "manifest.json").sort());
    for (const file of manifest.files) assert.equal(entries[file.name].length, file.bytes);
    if (partial === "svg") assert.equal(entries["svg/svg-001.svg"], undefined);
    else {
      const svg = new TextDecoder().decode(entries["svg/svg-001.svg"]);
      assert.match(svg, /<svg[^>]+xmlns="http:\/\/www.w3.org\/2000\/svg"/);
      assert.match(svg, /<path[^>]+fill="#123456"/);
      assert.doesNotMatch(svg, /<script|onload=|svgScriptRan|svgEventRan/);
      assert.equal(await source.evaluate((svg) => new DOMParser().parseFromString(svg, "image/svg+xml").querySelector("parsererror")?.textContent, svg), undefined);
    }
    if (format === "bundle") {
      assert.equal(manifest.source, `${origin}/fixture`);
      for (const type of ["md", "json", "html", "mhtml"]) await verifyExport(context, source, Buffer.from(entries[`page.${type}`]), type, origin);
      assert.match(new TextDecoder().decode(entries["page.txt"]), /FINAL PIXEL/);
      assert.equal(Buffer.from(entries["page.pdf"]).subarray(0, 5).toString(), "%PDF-");
      if (["resize", "loading"].includes(partial)) {
        assert.ok(manifest.warnings.some((warning) => warning.format === "png" && (partial === "resize" ? /kept changing size/ : /images.*load/i).test(warning.reason)));
        assert.equal(entries["tiles.json"], undefined);
      } else {
        if (partial === "svg") assert.ok(manifest.warnings.some((warning) => warning.format === "svg" && /128/.test(warning.reason)));
        else assert.deepEqual(manifest.warnings, []);
        const {tiles} = JSON.parse(new TextDecoder().decode(entries["tiles.json"]));
        for (const tile of tiles) {
          assert.equal(Buffer.from(entries[tile.name]).readUInt32BE(16), tile.width);
          assert.equal(Buffer.from(entries[tile.name]).readUInt32BE(20), tile.height);
        }
      }
    }
  }
  if (filename && ["html", "mhtml"].includes(format)) {
    const offline = await context.newPage();
    try {
      if (format === "mhtml") await context.setOffline(true);
      await offline.goto(pathToFileURL(filename).href);
      assert.match(await offline.locator("body").innerText(), /FINAL PIXEL/);
      if (format === "html") assert.deepEqual(await offline.evaluate(() => [window.exportScriptRan, window.headOrderScriptRan, window.svgScriptRan, window.svgEventRan]), [undefined, undefined, undefined, undefined], "Saved HTML must not execute source scripts or handlers, including markup before <head>.");
      if (format === "mhtml") {
        assert.equal(await offline.locator("h2").evaluate((node) => getComputedStyle(node).color), "rgb(12, 34, 56)");
        assert.equal(await offline.locator("#lazy").evaluate((image) => image.complete && image.naturalWidth), 128);
      }
    } finally { await context.setOffline(false); await offline.close(); await source.bringToFront(); }
  }
}

async function assertNativePixels(page, outputs, tiles, tiled = false) {
  assert.ok(tiles.length > 0, "Compare against the actual PNGs returned by Chrome.");
  const mismatch = await page.evaluate(async ({outputs, tiles, tiled}) => {
    const decode = async (url) => {
      const blob = url ? await (await fetch(url)).blob() : await (await navigator.clipboard.read())[0].getType("image/png");
      const image = await createImageBitmap(blob);
      const canvas = new OffscreenCanvas(image.width, image.height);
      canvas.getContext("2d").drawImage(image, 0, 0);
      image.close();
      return canvas.getContext("2d");
    };
    for (const [index, output] of (outputs || [{x: 0, y: 0}]).entries()) {
      const actual = await decode(output.url);
      for (const tile of tiled ? [tiles[index]] : tiles) {
        const expected = await decode(`data:image/png;base64,${tile.data}`);
        const {x, y, width, height} = tile.destination;
        const before = expected.getImageData(0, 0, width, height).data;
        const after = actual.getImageData(x - output.x, y - output.y, width, height).data;
        const difference = before.findIndex((value, index) => value !== after[index]);
        if (difference !== -1) return {x, y, difference, expected: before[difference], actual: after[difference]};
      }
    }
    return null;
  }, {outputs, tiles, tiled});
  assert.equal(mismatch, null, `Every captured pixel, including seams and padding edges, must survive export: ${JSON.stringify(mismatch)}`);
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
  await waitFor(() => evaluate('document.readyState === "complete" && document.querySelectorAll(".actions > button").length === 3 && document.querySelector("#save-format").options.length === 10'), 5000);
  return {
    errors, evaluate,
    async click(action) {
      assert.ok(["copy", "save", "text"].includes(action));
      const point = await evaluate(`(() => {const button = document.querySelector("#${action}-button"); button.scrollIntoView({block: "center"}); const r = button.getBoundingClientRect(); return {x: r.x + r.width / 2, y: r.y + r.height / 2};})()`);
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

async function scenario(origin, {width = 1200, height = 9831, dpr = 1, zoom = 1, action = "copy", format = "png", noiseHeight = 0, closePopup = false, resize = false, headed = false, slowImage = false, navigate = false, malformedHead = false, excessSvg = false}) {
  let ratio = dpr * zoom;
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
    if (malformedHead) await source.evaluate(() => {
      const script = document.createElement("script");
      script.textContent = "window.headOrderScriptRan = true;";
      document.documentElement.insertBefore(script, document.head);
    });
    if (excessSvg) await source.evaluate(() => {
      for (let index = 0; index < 128; index++) document.body.append(document.createElementNS("http://www.w3.org/2000/svg", "svg"));
    });
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
    ratio = await source.evaluate(() => devicePixelRatio);
    const originalScroll = await source.evaluate(() => scrollY);
    const verifyPixels = !noiseHeight && !resize && !closePopup && !navigate && ["png", "zip"].includes(format);
    if (verifyPixels) await worker.evaluate(() => {
      const send = chrome.runtime.sendMessage.bind(chrome.runtime);
      globalThis.captureTiles = [];
      chrome.runtime.sendMessage = (message, ...args) => {
        if (message.target === "offscreen" && message.action === "start") globalThis.captureTiles = [];
        if (message.target === "offscreen" && message.action === "tile" && globalThis.captureTiles.length < 256) {
          globalThis.captureTiles.push({data: message.data, destination: message.destination});
        }
        return send(message, ...args);
      };
    });
    let expectedScroll = originalScroll;
    if (action === "save") {
      const protocol = await context.browser().newBrowserCDPSession();
      await protocol.send("Browser.setDownloadBehavior", {behavior: "allow", downloadPath: profile});
    }
    popup = await openPopup(context, source, extensionId);
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
    await popup.evaluate(`document.querySelector("#save-format").value = ${JSON.stringify(format)}; document.querySelector("#save-format").dispatchEvent(new Event("change"))`);
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
        const value = await popup.evaluate('({busy: document.querySelector("#save-button").disabled, status: document.querySelector("#status").textContent})');
        return !value.busy && value;
      });
      // Fractional display scales can make the viewport wider than the fixture body.
      const metricsSession = await context.newCDPSession(source);
      const {cssContentSize} = await metricsSession.send("Page.getLayoutMetrics");
      await metricsSession.detach();
      const expectedWidth = Math.ceil(cssContentSize.width * ratio);
      const expectedHeight = Math.ceil(cssContentSize.height * ratio);
      if (resize === "always" && format !== "bundle") {
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
        // Automated Windows downloads can use the equivalent MIME extension aliases.
        const extensions = format === "html" ? [".html", ".htm"] : format === "mhtml" ? [".mhtml", ".mht"] : [`.${FORMATS[format].extension}`];
        assert.ok(extensions.some((extension) => download.filename.endsWith(extension)), download.filename);
        if (format === "png") {
          if (noiseHeight) assert.ok(file.length > 2_000_000, "Verify the real download path with a large image.");
          assert.equal(file.readUInt32BE(16), expectedWidth);
          assert.equal(file.readUInt32BE(20), expectedHeight);
          if (verifyPixels) {
            const tiles = await worker.evaluate(() => globalThis.captureTiles);
            await assertNativePixels(source, [{x: 0, y: 0, url: `data:image/png;base64,${file.toString("base64")}`}], tiles);
          }
        } else if (format === "zip") {
          const entries = unzipSync(file);
          assert.match(new TextDecoder().decode(entries["page.txt"]), /Příliš žluťoučký kůň/);
          const manifest = JSON.parse(new TextDecoder().decode(entries["tiles.json"]));
          assert.equal(manifest.width, expectedWidth);
          assert.equal(manifest.height, expectedHeight);
          assert.equal(manifest.pixelRatio, ratio);
          for (const tile of manifest.tiles) {
            const png = Buffer.from(entries[tile.name]);
            assert.equal(png.readUInt32BE(16), tile.width);
            assert.equal(png.readUInt32BE(20), tile.height);
            assert.ok(tile.width <= 1536 && tile.height <= 1536);
          }
          const last = manifest.tiles.at(-1);
          assert.equal(last.y + last.height, expectedHeight);
          const tile = manifest.tiles.find((tile) => tile.x === 0 && tile.y <= 2040 * ratio && tile.y + tile.height >= 2104 * ratio);
          assert.ok(tile, "The overlap must keep the small text together in an AI tile.");
          const tiles = await worker.evaluate(() => globalThis.captureTiles);
          const outputs = manifest.tiles.map(({name, x, y}) => ({x, y, url: `data:image/png;base64,${Buffer.from(entries[name]).toString("base64")}`}));
          assert.equal(outputs.length, tiles.length);
          await assertNativePixels(source, outputs, tiles, true);
        } else if (["md", "json", "html", "mhtml", "svg", "bundle"].includes(format)) {
          await verifyExport(context, source, file, format, origin, resize === "always" ? "resize" : slowImage ? "loading" : excessSvg ? "svg" : undefined, download.filename);
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
      } else if (format !== "png") {
        assert.match(state.status, /Copied/);
        await context.grantPermissions(["clipboard-read"], {origin});
        await source.bringToFront();
        const text = await source.evaluate(() => navigator.clipboard.readText());
        if (format === "svg") {
          assert.match(text, /<svg[\s>]/);
          assert.doesNotMatch(text, /<script|onload=|svgScriptRan|svgEventRan/);
        }
        else await verifyExport(context, source, Buffer.from(text), format, origin);
      } else {
        assert.match(state.status, /Copied/);
        await context.grantPermissions(["clipboard-read"], {origin});
        await source.bringToFront();
        const image = await source.evaluate(async ({width, height, dpr}) => {
          const [item] = await navigator.clipboard.read();
          const bitmap = await createImageBitmap(await item.getType("image/png"));
          const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
          const drawing = canvas.getContext("2d");
          drawing.drawImage(bitmap, 0, 0);
          const pixel = (x, y) => [...drawing.getImageData(Math.floor(x * dpr), Math.floor(y * dpr), 1, 1).data].slice(0, 3);
          const text = drawing.getImageData(Math.round(20 * dpr), Math.round(2040 * dpr), Math.round(400 * dpr), Math.round(64 * dpr)).data;
          const headerX = Math.min(1100, window.innerWidth - 1);
          const result = {width: bitmap.width, height: bitmap.height, textInk: text.filter((value) => value < 128).length, top: pixel(headerX, 10), middle: pixel(110, 4010), lazy: pixel(310, 7010), last: pixel(width - 1, height - 1), seam: pixel(headerX, 2050)};
          bitmap.close();
          return result;
        }, {width, height, dpr: ratio});
        assert.equal(image.width, expectedWidth);
        assert.equal(image.height, expectedHeight);
        assert.ok(image.textInk > 100, "The nine-pixel text must be present.");
        if (verifyPixels) await assertNativePixels(source, null, await worker.evaluate(() => globalThis.captureTiles));
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
    } else if (request.url === "/fixture.css") {
      response.setHeader("Content-Type", "text/css");
      response.end("h2 { color: rgb(12, 34, 56); }");
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
  ["150% display scale preserves clipped edge pixels", {dpr: 1.5}],
  ["175% display scale saves PNG without losing pixels", {dpr: 1.75, action: "save"}],
  ["175% display scale and 90% zoom export exact AI tiles", {dpr: 1.75, zoom: 0.9, action: "save", format: "zip"}],
  ["browser page zoom preserves native text pixels", {zoom: 1.25}],
  ["50,000-pixel PNG refuses silent shrinking", {height: 50000}],
  ["50,000-pixel page exports native AI tiles and text", {height: 50000, action: "save", format: "zip"}],
  ["HiDPI AI tiles keep original text pixels", {dpr: 1.25, action: "save", format: "zip"}],
  ["copy text for AI preserves Czech and excludes hidden text", {action: "text"}],
  ["save UTF-8 page text", {action: "save", format: "txt"}],
  ["save Markdown with headings, code, absolute links, and tables", {action: "save", format: "md"}],
  ["copy Markdown code for AI", {format: "md"}],
  ["save structured JSON without hidden text", {action: "save", format: "json"}],
  ["copy structured JSON", {format: "json"}],
  ["save current HTML code with scripts blocked", {action: "save", format: "html"}],
  ["saved HTML blocks scripts inserted before the original head", {action: "save", format: "html", malformedHead: true}],
  ["copy current HTML code", {format: "html"}],
  ["save and reopen MHTML offline with its loaded resources", {action: "save", format: "mhtml"}],
  ["copy MHTML source text", {format: "mhtml"}],
  ["save native SVG graphics as a ZIP", {action: "save", format: "svg"}],
  ["copy native SVG code", {format: "svg"}],
  ["complete archive contains page representations and native visuals", {action: "save", format: "bundle"}],
  ["complete archive preserves other formats when screenshot resizing never stops", {action: "save", format: "bundle", resize: "always"}],
  ["complete archive retains other formats when SVG extraction exceeds its limit", {action: "save", format: "bundle", excessSvg: true}],
  ["complete archive retains other formats when images never finish loading", {action: "save", format: "bundle", slowImage: true}],
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
