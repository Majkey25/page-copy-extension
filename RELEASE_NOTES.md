# Page Copy 1.2.0

- Save a **Complete archive (ZIP)** with lossless PNG tiles, MHTML, PDF, current DOM HTML, Markdown, TXT, structured JSON, and sanitized inline SVG graphics where available. Its manifest lists files, byte sizes, and reasons for omitted exports.
- Copy or save **Markdown** for AI chats, **JSON** for structured extraction, **HTML** for page code, and **SVG** graphics. Copy writes source code as plain text. Save PDF and ZIP to attach them as files.
- Save **MHTML** to reopen the page and its loaded resources offline in Chrome or Edge. MHTML source can also be copied as text.
- Hover, focus, or click **i** beside the format selector for the best use and limitations of each format. Escape or clicking outside closes the explanation.
- Keep successful formats in the complete archive when screenshot resizing, image preparation, or another conversion fails. Navigation still aborts to avoid mixing different documents.
- Block scripts in saved HTML and sanitize exported SVGs with DOMPurify. Libraries and licenses are bundled locally. No new permissions, upload service, or tracking.
- Preserve the existing native-pixel PNG, AI tile, selectable PDF, and fast text workflows, including fractional display-scale capture and bounded resize retries.

For AI, use Markdown or TXT for text and the PNG tiles for small visual details. A receiving chat can still resize images. SVG export extracts inline vectors; it does not turn an arbitrary page into vectors. Offline snapshots do not reproduce servers, logins, or content that was never loaded. See the [researched format guide](https://github.com/Majkey25/page-copy-extension/blob/main/docs/export-formats.md) for comparisons and limits.

Download `page-copy-extension.zip`, extract it to a permanent folder, and load it through Developer mode in Chrome or Edge. To update, replace the installed files and click **Reload** on the extension card. This is an unpacked extension, not a Chrome Web Store listing.
