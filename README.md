# Page Copy

Full-page screenshots with two buttons. Same black and white interface as [Tab Copy](https://github.com/Majkey25/tab-copy-extension).

- **Copy to clipboard** copies one PNG image, ready to paste.
- **Save as…** opens the browser's save dialog for one PNG file.

No account, server, tracking, settings, or runtime dependencies.

## Install

Requires Chrome 120+ or a current Chromium-based browser such as Edge.

1. Clone this repository or download and extract its source ZIP.
2. Open `chrome://extensions` or `edge://extensions`.
3. Enable **Developer mode**, click **Load unpacked**, and select the folder containing `manifest.json`.
4. Pin **Page Copy**, open a website, and click either button.

Keep the popup open until copying finishes. Saving opens the normal file picker. Opening DevTools on the source tab can interrupt capture, so close it first.

## Capture behavior

Page Copy automatically visits the page to trigger lazy-loaded content, captures small image tiles through Chrome's debugger API, and joins them locally. You do not need to scroll or stitch screenshots yourself. It restores the original scroll position after capture, including on errors. The capture continues to clean up if the popup closes.

Tiles avoid requesting a single oversized screenshot. The output uses one pixel per CSS pixel on ordinary pages. Very large pages are scaled to fit 64 million pixels and 32,767 pixels per side, preserving the full captured area. Preparation takes at most 20 seconds. Pages requiring more than 256 tiles or producing a PNG above 40 MB fail with an explicit error. No silent cropping.

Only the main document's scrollable area is captured. Independently scrolling panels, virtualized lists, infinite feeds, protected video, PDFs, browser pages, and restricted sites cannot be guaranteed as complete screenshots. Slow images and pages that keep changing report an error. Animations and video are live during capture. A screenshot is not an archival copy of the underlying page.

Chrome briefly shows its debugger permission banner during capture. The extension detaches after it finishes or fails. Page Copy uses the same rendering engine as DevTools, with bounded tiles and local image assembly; it cannot bypass browser or enterprise capture restrictions.

## Permissions and privacy

| Permission | Purpose |
| --- | --- |
| `activeTab` | Access the page you select by opening the extension. |
| `debugger` | Capture small regions beyond the visible viewport. |
| `scripting` | Trigger lazy content and restore the scroll position. |
| `clipboardWrite` | Write the PNG after you click Copy. Never reads your clipboard. |
| `downloads` | Open Save as for the PNG. |
| `offscreen` | Assemble tiles in a temporary hidden extension document. |

Screenshots stay on your device. Loading lazy content can contact the original website normally. See [PRIVACY.md](PRIVACY.md).

## Development

Node.js 22+ is needed only for development commands. Installation needs no build step.

```sh
npm test
npm run check
npm run package
```

`npm run package` creates `dist/page-copy-extension` containing only extension files. Load that folder unpacked or ZIP its contents for distribution.

## Verification

Verified on Windows in isolated Chromium 156.0.8078.4 with the real toolbar popup and native extension APIs:

- Clipboard PNG pixels matched the page header, middle, lazy-loaded image, and final row. Fixed headers did not repeat between tiles.
- A 50,000-pixel-tall page, a 4,301-pixel-wide page, and a device scale factor of 2 captured successfully.
- Save as produced a complete 12,800,348-byte PNG through Chromium's download system. The native OS file picker was bypassed by browser automation.
- Hidden lazy images did not block capture. Closing the popup mid-capture and exceeding the 40 MB PNG limit restored the page, closed the temporary document, and released the debugger.

Edge was not separately tested. Claude Opus 5.5 reviewed capture and cleanup paths; runtime checks independently verified the adopted fixes.

MIT license. Popup styling is adapted from Matěj Teplý's Tab Copy extension.
