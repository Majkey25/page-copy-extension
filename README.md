<p align="center">
  <img src="icons/icon.svg" width="72" height="72" alt="Page Copy screenshot camera icon">
</p>

<h1 align="center">Page Copy</h1>

<p align="center">
  Capture the whole page without shrinking its pixels.<br>
  Copy PNG or text. Save PNG, AI tiles, PDF, or TXT.
</p>

<p align="center">
  <a href="https://github.com/Majkey25/page-copy-extension/actions/workflows/ci.yml"><img src="https://github.com/Majkey25/page-copy-extension/actions/workflows/ci.yml/badge.svg" alt="CI checks"></a>
  <a href="https://github.com/Majkey25/page-copy-extension/releases/latest"><img src="https://img.shields.io/github/v/release/Majkey25/page-copy-extension?style=flat-square&color=black" alt="Latest stable release"></a>
  <a href="https://github.com/Majkey25/page-copy-extension/releases"><img src="https://img.shields.io/github/downloads/Majkey25/page-copy-extension/total?style=flat-square&color=black" alt="Release downloads"></a>
  <img src="https://img.shields.io/badge/Manifest-V3-black?style=flat-square" alt="Manifest V3">
  <img src="https://img.shields.io/badge/Chrome-120%2B-black?style=flat-square&logo=googlechrome&logoColor=white" alt="Requires Chrome 120 or later">
  <a href="LICENSE"><img src="https://img.shields.io/github/license/Majkey25/page-copy-extension?style=flat-square&color=black" alt="MIT license"></a>
</p>

<p align="center">
  <a href="https://github.com/Majkey25/page-copy-extension/releases/latest/download/page-copy-extension.zip"><img src="https://img.shields.io/badge/DOWNLOAD-LATEST_ZIP-black?style=for-the-badge&logo=github&logoColor=white" alt="Download the latest Page Copy ZIP"></a>
</p>

<p align="center">
  <a href="#features">Features</a> ·
  <a href="#install">Install</a> ·
  <a href="#usage">Usage</a> ·
  <a href="#capture-limits">Capture limits</a> ·
  <a href="#development">Development</a> ·
  <a href="PRIVACY.md">Privacy</a>
</p>

## Features

- Capture the full document without scrolling or stitching screenshots yourself.
- Copy a lossless PNG at the page's device pixel ratio, including HiDPI.
- Copy page text directly into an AI chat without image resizing or OCR.
- Save PNG, overlapping PNG tiles with text in a ZIP, PDF, or UTF-8 TXT.
- Automatically visit the page to trigger lazy-loaded images.
- Restore the original scroll position after capture, including on errors.
- Use the minimal black and white interface from [Tab Copy](https://github.com/Majkey25/tab-copy-extension).
- Process images locally with no account, server, tracking, or runtime dependencies.

## Download

**[Download the latest installable ZIP](https://github.com/Majkey25/page-copy-extension/releases/latest/download/page-copy-extension.zip)**

Each [stable release](https://github.com/Majkey25/page-copy-extension/releases/latest) includes `page-copy-extension.zip` and `SHA256SUMS.txt`.

> Extract the ZIP before installation. Chrome and Edge cannot install an unsigned ZIP directly.

## Install

1. Download the latest ZIP and extract it to a permanent folder.
2. Open `chrome://extensions` in Chrome or `edge://extensions` in Edge.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the extracted folder that directly contains `manifest.json`.
6. Pin **Page Copy** from the Extensions menu.

To update, replace the extracted files with the newest release, then click **Reload** on the extension card. Keep the installation folder in place.

| Browser | Compatibility |
| --- | --- |
| Chrome 120+ and current Chromium | Uses Chromium Manifest V3 APIs. Automated capture tests run in Chromium on Linux and Windows. |
| Microsoft Edge | Expected to work with the same APIs. Edge is not separately tested. |
| Firefox and Safari | Not supported. |

## Usage

Open a normal website and click the extension icon. Choose one action:

| Button | Result |
| --- | --- |
| **COPY PNG** | Copy a full-page lossless `image/png` without reducing pixels. |
| **COPY TEXT FOR AI** | Copy the page's rendered text, title, and URL as plain text. |
| **SAVE AS…** | Save the selected format through the browser's save dialog. |

For a long page in an AI chat, use **COPY TEXT FOR AI** for exact text. For visual details, save **AI tiles (ZIP)**, extract it, and attach the numbered PNGs individually in order. Each tile is at most 1,536 × 1,536 device pixels, with 64 pixels of overlap so text at a boundary remains visible. The archive includes `page.txt` and `tiles.json` with tile positions and pixel ratio. A chat must support ZIP extraction to read the archive directly.

PNG compression is lossless, but a receiving chat can still resize any pasted or uploaded image. The extension cannot control that processing or guarantee that every AI model reads the smallest text. Changing an image's file extension does not prevent resizing. Plain text avoids this image-processing step.

PDF uses Chrome's print renderer and keeps selectable text where the page provides it. Print styles and pagination can change the layout. TXT and text copying use the main document's rendered text. They do not perform OCR or extract text from images, canvas, embedded frames, or content absent from the DOM. Keep the PNG tiles for those visual details.

Text copying and TXT export read the current document immediately without scrolling or waiting for images. Screenshot and PDF exports prepare lazy content first.

Keep the popup open until copying finishes. Close DevTools on the source tab before capture. Chrome briefly displays its debugger banner while Page Copy works.

## How capture works

Page Copy visits the page automatically and captures small PNG regions through Chrome's debugger API. It joins them without resampling for a single PNG, or stores the original tile bytes in an AI ZIP. Small tiles avoid requesting a single oversized screenshot. If the document changes dimensions, the extension discards the incomplete image and retries the whole capture, up to three attempts. It restores your scroll position and detaches the debugger after completion or failure. Cleanup continues if you close the popup.

The extension uses the same rendering engine as DevTools. It cannot bypass browser restrictions or enterprise capture policies.

## Capture limits

Images retain the original device pixels at the current page zoom. Large pages are never silently scaled down. Use AI tiles, PDF, or text when a single PNG exceeds its limits.

| Limit | Behavior |
| --- | --- |
| Single PNG | At most 64 million pixels and 32,767 pixels per side; larger captures fail with alternatives. |
| Preparation | Up to 20 seconds of automatic page traversal, then bounded image loading waits. |
| Capture size | Up to 256 tiles. |
| Screenshot command | Up to 30 seconds per tile, then an error and cleanup if Chrome stops responding. |
| PNG, ZIP, or PDF transfer | Up to 40 MB per export. Larger files fail with an explicit error. |
| Page text | Up to 8 million characters. Larger text fails explicitly. |

Only the main document's scrollable area is captured. Independently scrolling panels, virtualized lists, infinite feeds, protected video, PDFs, browser pages, and restricted sites cannot be guaranteed as complete screenshots. Slow images and pages that continue changing size after three capture attempts can report an error. Animations and video remain live during capture.

## Privacy and permissions

Screenshots and exported page text stay on your device. Page Copy never reads your clipboard, sends exports to a server, or stores browsing history. Loading lazy content can contact the original website normally. Saved files and clipboard contents remain until you delete or replace them. Read the [privacy policy](PRIVACY.md).

| Permission | Purpose |
| --- | --- |
| `activeTab` | Access the page you select by opening the extension. |
| `debugger` | Capture regions beyond the visible viewport. |
| `scripting` | Trigger lazy content and restore the scroll position. |
| `clipboardWrite` | Write PNG or page text after you click Copy. |
| `downloads` | Open Save as for the selected format. |
| `offscreen` | Assemble tiles in a temporary hidden document. |

## Development

Requires Node.js 22.13+ and npm. The installed extension has no runtime dependencies or build requirement.

```sh
npm ci --ignore-scripts
npm run lint
npm run check
npm test
npm run package
npm run verify:package
npm run unpack:package
npx playwright install --with-deps --no-shell chromium
npm run test:browser
```

Packaging produces the unpacked extension in `dist/page-copy-extension`, an installable `dist/page-copy-extension.zip`, and `dist/SHA256SUMS.txt`. The archive contains only extension files, with fixed timestamps for reproducible builds. Browser tests load the packaged extension and use its real toolbar popup and native Chrome APIs.

The camera icon has a vector source at `icons/icon.svg`. After editing it, run `npm run icons` to regenerate the 16, 32, 48, and 128 pixel PNGs. This command uses the installed Playwright Chromium browser.

## CI and releases

[CI](https://github.com/Majkey25/page-copy-extension/actions/workflows/ci.yml) runs on pull requests and pushes to `main`. It checks ESLint, JavaScript syntax, unit tests, dependency vulnerabilities, archive contents, source bytes, and checksums. Real Chromium tests run on Linux and Windows.

Browser checks cover exact small-text pixels in clipboard PNG and AI tiles, lazy content, hidden images and text, fixed headers, HiDPI and fractional pixel ratios, a 50,000-pixel-tall page, resize retries, text copying, all save formats, horizontal overflow, Save as above 2 MB, oversized PNG errors, and cleanup after closing the popup. The Windows PDF scenario uses a headed browser. Automation bypasses the native OS file picker when verifying downloads.

Push a stable tag matching `manifest.json` and `package.json`, such as `v1.0.0`, to run the release workflow. It repeats the checks against the exact release ZIP and publishes a normal GitHub Release. Publication requires all checks to pass and the remote tag to match the tested commit. Only newer versions become the latest release. Third-party Actions are pinned to full commit SHAs, and repository write access is limited to the publish job.

See [release notes](RELEASE_NOTES.md) and [published releases](https://github.com/Majkey25/page-copy-extension/releases). GitHub Releases provide unpacked installation files. Page Copy is not listed in the Chrome Web Store.

## Support

Report installation or capture problems in [GitHub Issues](https://github.com/Majkey25/page-copy-extension/issues). Include your browser version, operating system, error message, and a public page that reproduces the problem. Do not attach private screenshots or sensitive page content.

## License

[MIT](LICENSE) © Matěj Teplý / Majkey25. Popup styling is adapted from Tab Copy. Page Copy uses its own camera icon.
