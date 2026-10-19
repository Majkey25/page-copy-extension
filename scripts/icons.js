import {readFile, writeFile} from "node:fs/promises";
import {chromium} from "playwright";

const svg = await readFile(new URL("../icons/icon.svg", import.meta.url), "utf8");
const browser = await chromium.launch({channel: "chromium", headless: true});
try {
  const page = await browser.newPage();
  for (const size of [16, 32, 48, 128]) {
    const dataUrl = await page.evaluate(async ({svg, size}) => {
      const image = new Image();
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      canvas.getContext("2d").drawImage(image, 0, 0, size, size);
      return canvas.toDataURL("image/png");
    }, {svg, size});
    await writeFile(new URL(`../icons/icon-${size}.png`, import.meta.url), Buffer.from(dataUrl.split(",")[1], "base64"));
  }
} finally {
  await browser.close();
}
