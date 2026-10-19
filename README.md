<p align="center">
  <img src="icons/icon.svg" width="72" height="72" alt="Page Copy screenshot camera icon">
</p>

<h1 align="center">Page Copy</h1>

<p align="center">
  Capture the whole page as one image.<br>
  Two buttons. Copy to clipboard or save as PNG.
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
- Copy one PNG to the clipboard or open **Save as…** for a file.
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
| **COPY TO CLIPBOARD** | Copy the full-page PNG, then paste it into an app that accepts images. |
| **SAVE AS…** | Choose a filename and location in the browser's save dialog. |

Keep the popup open until copying finishes. Close DevTools on the source tab before capture. Chrome briefly displays its debugger banner while Page Copy works.

## How capture works

Page Copy visits the page automatically, captures small regions through Chrome's debugger API, and joins them into one PNG. Small tiles avoid requesting a single oversized screenshot. The extension restores your scroll position and detaches the debugger after completion or failure. Cleanup continues if you close the popup.

The extension uses the same rendering engine as DevTools. It cannot bypass browser restrictions or enterprise capture policies.

## Capture limits

Ordinary pages use one output pixel per CSS pixel. Very large pages are scaled to fit the full captured area within the image limits.

| Limit | Behavior |
| --- | --- |
| Output size | At most 64 million pixels and 32,767 pixels per side. |
| Preparation | Up to 20 seconds of automatic page traversal, then bounded image loading waits. |
| Capture size | Up to 256 tiles. |
| PNG transfer | Up to 40 MB. Larger images fail with an explicit error. |

Only the main document's scrollable area is captured. Independently scrolling panels, virtualized lists, infinite feeds, protected video, PDFs, browser pages, and restricted sites cannot be guaranteed as complete screenshots. Slow images and pages that change size can report an error. Animations and video remain live during capture.

## Privacy and permissions

Screenshots stay on your device. Page Copy never reads your clipboard, sends screenshots to a server, or stores browsing history. Loading lazy content can contact the original website normally. Saved files and clipboard contents remain until you delete or replace them. Read the [privacy policy](PRIVACY.md).

| Permission | Purpose |
| --- | --- |
| `activeTab` | Access the page you select by opening the extension. |
| `debugger` | Capture regions beyond the visible viewport. |
| `scripting` | Trigger lazy content and restore the scroll position. |
| `clipboardWrite` | Write the PNG after you click Copy. |
| `downloads` | Open Save as for the PNG. |
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

Browser checks cover clipboard image pixels, lazy content, hidden images, fixed headers, HiDPI, a 50,000-pixel-tall page, horizontal overflow, Save as above 2 MB, oversized PNG errors, and cleanup after closing the popup. Automation bypasses the native OS file picker when verifying downloads.

Push a stable tag matching `manifest.json` and `package.json`, such as `v1.0.0`, to run the release workflow. It repeats the checks against the exact release ZIP and publishes a normal GitHub Release. Publication requires all checks to pass and the remote tag to match the tested commit. Only newer versions become the latest release. Third-party Actions are pinned to full commit SHAs, and repository write access is limited to the publish job.

See [release notes](RELEASE_NOTES.md) and [published releases](https://github.com/Majkey25/page-copy-extension/releases). GitHub Releases provide unpacked installation files. Page Copy is not listed in the Chrome Web Store.

## Support

Report installation or capture problems in [GitHub Issues](https://github.com/Majkey25/page-copy-extension/issues). Include your browser version, operating system, error message, and a public page that reproduces the problem. Do not attach private screenshots or sensitive page content.

## License

[MIT](LICENSE) © Matěj Teplý / Majkey25. Popup styling is adapted from Tab Copy. Page Copy uses its own camera icon.
