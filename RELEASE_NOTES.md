# Page Copy 1.1.2

- Fix persistent "The screenshot pixel ratio changed" errors when Chrome rounds screenshot regions on scaled displays.
- Capture whole DIP dimensions and crop only surplus right/bottom pixels. Saved PNGs, clipboard PNGs, and AI ZIP tiles keep their original resolution without resampling.
- Check exported pixels directly against the PNG tiles returned by Chrome, including tile seams and the final row. Add 150% and 175% display-scale coverage with 90% page zoom.

- Keep original device pixels in saved and clipboard PNGs, including HiDPI screens and browser zoom. Large pages are no longer silently reduced.
- Use **Copy text for AI** or save UTF-8 TXT to preserve page text without image resizing or OCR.
- Save **AI tiles (ZIP)** with numbered lossless PNGs, page text, and tile coordinates. Tiles overlap by 64 pixels and are at most 1,536 × 1,536 device pixels.
- Export PDF through Chrome's print renderer with selectable text where the page provides it. Print styles and pagination may change the layout.
- Retry the complete screenshot up to three times when the page changes dimensions. A stalled screenshot command times out so cleanup can finish.
- Restore only the original document's scroll position, including when the tab navigates during capture.
- Keep text export available when page images are still loading. All processing remains local, with no new permissions or runtime dependencies.

Download `page-copy-extension.zip`, extract it to a permanent folder, and load it through Developer mode in Chrome or Edge. To update an existing installation, replace its extracted files and click **Reload** on the extension card. Keep the popup open until copying finishes. Close DevTools on the source tab before screenshot or PDF capture.

For long pages in an AI chat, copy the text or extract the AI ZIP and attach the numbered PNG tiles individually. The receiving chat can resize images; no clipboard image format can guarantee that an AI reads every small character. Text export is not OCR and excludes image/canvas text and embedded frames.

Single PNGs above the image limits now fail with an explicit alternative instead of losing detail. Infinite feeds, independently scrolling panels, virtualized lists, protected content, PDFs, and browser pages still have limitations. See the README for details.

CI checks lint, syntax, unit tests, dependency vulnerabilities, package contents, checksums, and real Chromium capture on Linux and Windows before publishing a stable release. This GitHub release is an unpacked extension, not a Chrome Web Store listing.
