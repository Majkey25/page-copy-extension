# Privacy

Page Copy captures the page only after you click **Copy**, **Copy text for AI**, or **Save as…**.

Images and page data are processed in memory on your device. Copy writes PNG or textual source code to your clipboard. Save writes the selected format or archive to the location you choose. Exports can include rendered text, current DOM HTML, loaded resources in MHTML, PDF, Markdown, JSON metadata, sanitized inline SVG markup, and native PNG tiles. Source metadata includes the page title and URL. The extension does not read the clipboard, send exports to a server, collect analytics, or store browsing history. Conversion and sanitization libraries are bundled locally.

Full DOM HTML, SVG source, and offline archives can include hidden markup and private page data that rendered-text exports omit. Check files before sharing them. Snapshots do not export browser cookies or storage through separate APIs, but sensitive values already present in the page's markup or resources can be included.

The extension temporarily scrolls the selected page to load content and restores its position after capture. The website may receive its usual requests when lazy content loads. Chrome's debugger attaches only for capture and detaches afterward.

Temporary image assembly documents are closed after the operation. Your saved files and clipboard contents remain until you delete or replace them. Uninstalling the extension removes the extension, but does not delete files you saved or clear your clipboard.

Notices from the last save are kept in that tab's extension tooltip and shown when the popup reopens. The next save replaces the notice, and Chrome removes tab-specific action state when the tab closes. No page content is stored there.

Source and contact: https://github.com/Majkey25/page-copy-extension
