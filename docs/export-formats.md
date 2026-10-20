# Choosing an export format

Research checked against browser and library documentation on 20 October 2026.

Use **Complete archive (ZIP)** to keep available representations together, **Markdown** for an AI chat, and **MHTML** to reopen a loaded page offline.

| Format | Best use | What it preserves | Main limit |
| --- | --- | --- | --- |
| Complete archive, ZIP | Research handoff and backups | MHTML, PDF, DOM HTML, Markdown, TXT, JSON, inline SVGs, PNG tiles, coordinates, and an inventory | `manifest.json` records omitted exports and their reasons. Snapshots are taken in sequence. |
| Markdown | AI input, notes, documentation | Headings, lists, links, code blocks, supported tables | A readable conversion, not a visual copy or OCR. |
| JSON | Agents, scripts, content comparison | Rendered text, headings, links, image descriptions, table rows, URL, time, viewport | Main-document data, without a working app or all embedded content. |
| MHTML | Offline viewing in Chrome or Edge | The page and loaded resources in one browser-generated file | Open it from disk. Missing resources and server behavior cannot be reconstructed. |
| HTML code | Markup inspection and coding agents | Current document DOM, base URL, and a script-blocking policy | External resources can require the website. This is not the original HTTP response, shadow DOM, or source repository. |
| PDF | Sharing, printing, scalable text | Print output, selectable text and vector content where provided | Print CSS and pagination can change layout. Raster images stay raster images. |
| PNG | Visual evidence | Native display pixels, lossless encoding | A receiving chat can resize it. Single-image limits apply. |
| AI PNG tiles, ZIP | Small visual details on long pages | Native PNG pixels, 64-pixel overlap, page text, coordinates | Extract and attach tiles separately if the receiving tool cannot unpack ZIPs. |
| TXT | Universal text copying | Rendered main-document text, title, URL | No layout, structured fields, OCR, or embedded frame text. |
| SVG assets, ZIP | Vector charts, diagrams, logos, icons | Sanitized inline SVG markup | Scripts, handlers, and unsafe markup are removed. External styles or definitions may be needed. Arbitrary HTML is not converted into vectors. |

## Offline archives

[Chrome's pageCapture documentation](https://developer.chrome.com/docs/extensions/reference/api/pageCapture) describes MHTML as a page-and-resources archive opened from the filesystem. Page Copy uses its existing debugger permission instead of adding `pageCapture`. The [Page.captureSnapshot protocol](https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-captureSnapshot) documents MHTML serialization of frames, shadow DOM, external resources, and inline styles.

A DOM HTML dump preserves markup, but referenced CSS, images, fonts, and frames are not automatically bundled. [SingleFile](https://github.com/gildas-lormeau/SingleFile) is a dedicated option when resource-inlined HTML is the primary requirement. Page Copy uses native MHTML for the offline representation and keeps HTML code as a separate artifact.

Neither representation backs up a server, authenticated sessions, a source repository, or content that was never loaded. Archives and source code can contain private page data. Check their contents before sharing. Open source files only from pages you trust.

## Copying

[The Clipboard API](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/write) commonly supports plain text, HTML, and PNG. Arbitrary file formats and application-specific clipboard types are not portable between browsers and receiving apps.

Page Copy writes PNG as `image/png`. Markdown, JSON, HTML, TXT, MHTML source, and SVG code use plain text so the receiver gets the source characters. HTML copying pastes code rather than rich text. Save PDF and ZIP to attach them as real files. A PDF's base64 text is not a pasted PDF file, and changing a PNG's extension cannot recover detail after resizing.

## Markdown and vectors

[Turndown](https://github.com/mixmark-io/turndown) converts an inert DOM copy into Markdown. Its [GFM plugin](https://github.com/mixmark-io/turndown-plugin-gfm) adds table, strikethrough, and task-list rules. Both libraries and their MIT licenses are packaged locally from pinned npm versions. No conversion service is used.

SVG export keeps native inline graphics and sanitizes them with locally bundled [DOMPurify](https://github.com/cure53/DOMPurify), using its SVG profile. Identical sanitized SVGs are included once, so repeated navigation icons do not exhaust the unique-asset limit. Scripts, event handlers, and unsafe markup are removed; source bytes and interactive behavior can change. Its license is included in the package. A screenshot inside an SVG wrapper remains a raster image. HTML embedded through [`foreignObject`](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Element/foreignObject) depends on an HTML renderer. PDF is the browser's page-document format for scalable text and vector content.

## Limits and inventory

Structured exports are bounded to 100,000 DOM elements and 8 MB of UTF-8 output, shared by TXT, Markdown, JSON, HTML, and SVGs in a complete archive. Export individual formats to give each the full text budget. Archives stay below the existing 40 MB transfer limit, with at most 256 screenshot tiles and 128 unique inline SVGs. A complete archive retains other representations when one conversion or screenshot capture fails; omissions appear in its status message and `manifest.json`. Preparation scans the initial page area once, with a 20-second scan budget and a separate 3-second image/font wait. Loading limits produce notices and permit export. A page that keeps growing vertically after three screenshot attempts exports the final attempt's measured area with a notice. AI tile archives retain notices in `tiles.json`. Native MHTML and PDF have their own transfer checks. Navigation still aborts the export to avoid mixing pages.

Representations are independent snapshots, not an atomic transaction. Read `page.txt` for rendered text, `page.md` for structure, and native PNG tiles for visual details. A destination chat can still resize uploaded images.
