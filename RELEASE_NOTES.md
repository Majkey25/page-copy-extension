# Page Copy 1.2.1

- Fix MHTML export aborting on growing news feeds such as Seznam. Lazy-content preparation visits the initial page area once and reports loading limits instead of blocking the export.
- Keep Save and Copy available when images or fonts stall. Saved-export notices survive closing and reopening the popup, without new permissions.
- Preserve the final measured screenshot area with an explicit notice if vertical growth continues after three attempts. AI ZIPs record notices in `tiles.json`; PNG pixels remain at native resolution.
- Deduplicate identical sanitized SVGs before applying the 128-asset limit, fixing SVG extraction on icon-heavy news and GitHub pages.
- Expand browser regressions to stalled images/fonts, finite long and wide documents, continuous growth/shrinkage, native capture failure and retry, repeated icons, and notices after popup closure. Test public Seznam, GitHub home/repository, and Wikipedia exports separately from deterministic fixtures.

For AI, use Markdown or TXT for text and the PNG tiles for small visual details. A receiving chat can still resize images. SVG export extracts inline vectors; it does not turn an arbitrary page into vectors. Offline snapshots do not reproduce servers, logins, or content that was never loaded. See the [researched format guide](https://github.com/Majkey25/page-copy-extension/blob/main/docs/export-formats.md) for comparisons and limits.

Download `page-copy-extension.zip`, extract it to a permanent folder, and load it through Developer mode in Chrome or Edge. To update, replace the installed files and click **Reload** on the extension card. This is an unpacked extension, not a Chrome Web Store listing.
