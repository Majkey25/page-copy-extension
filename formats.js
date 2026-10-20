export const EXPORT_LIMIT = 40_000_000;

export function textDataUrl(text, mime) {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > EXPORT_LIMIT) throw new Error("The export exceeds the browser's 40 MB transfer limit.");
  const parts = [];
  for (let index = 0; index < bytes.length; index += 32768) parts.push(String.fromCharCode(...bytes.subarray(index, index + 32768)));
  return `data:${mime};charset=utf-8;base64,${btoa(parts.join(""))}`;
}

export const FORMATS = {
  png: {label: "PNG · original pixels", extension: "png", mime: "image/png", copy: true, use: "Screenshots, visual evidence, and exact screen pixels.", detail: "Lossless at the current display scale. Chats can still shrink pasted images. Use AI tiles for long pages. If a feed keeps growing after retries, the image keeps the final attempt's measured area and reports a notice."},
  bundle: {label: "Complete archive (ZIP) · recommended", extension: "zip", mime: "application/zip", copy: false, use: "Keep an offline copy and give an AI both the page content and visual details.", detail: "Includes MHTML, PDF, HTML code, Markdown, TXT, structured JSON, native SVGs, and lossless PNG tiles where available. manifest.json lists missing exports and their reasons."},
  md: {label: "Markdown · best for AI", extension: "md", mime: "text/markdown", copy: true, use: "AI chats, research notes, documentation, and readable source text.", detail: "Preserves headings, links, lists, code, and supported tables. Copies Markdown code as plain text. Images, canvas text, and embedded frames are not OCR."},
  json: {label: "JSON · structured page data", extension: "json", mime: "application/json", copy: true, use: "Agents, data extraction, scripts, and comparing page content.", detail: "Includes page text, headings, links, image descriptions, tables, URL, time, and viewport metadata. Copies JSON code as plain text."},
  html: {label: "HTML · current DOM code", extension: "html", mime: "text/html", copy: true, use: "Inspect markup, give an agent the current page structure, or reuse HTML code.", detail: "Copies HTML code as plain text. This is the current DOM, not the original server response or the app's source repository. Saved scripts are blocked; external styles and images may still need the website. Use MHTML offline."},
  mhtml: {label: "MHTML · offline page + resources", extension: "mhtml", mime: "multipart/related", copy: true, use: "Reopen a saved page offline in Chrome or Edge.", detail: "Chrome packages the page and loaded resources in one file. Save it, then open it from disk. Copy writes MHTML source text, which is large and less useful for AI than Markdown. This is a snapshot, not a working backend."},
  zip: {label: "AI tiles (ZIP) · PNGs + text", extension: "zip", mime: "application/zip", copy: false, use: "Give an AI small visual details from a very long page.", detail: "Numbered PNGs keep native pixels, with 64-pixel overlap, plus exact page text and tile coordinates. Extract and attach tiles individually if your chat cannot open ZIPs."},
  pdf: {label: "PDF · selectable print document", extension: "pdf", mime: "application/pdf", copy: false, use: "Printing, sharing documents, and reading selectable text at any zoom.", detail: "Uses the browser's print layout. Text and vector content stay scalable where the page provides them; images remain raster images. Print styles and page breaks can change the appearance. Save and attach the PDF."},
  txt: {label: "TXT · exact rendered text", extension: "txt", mime: "text/plain", copy: true, use: "Paste page text into any chat or editor without image compression.", detail: "Fastest text export. Includes title and URL. Formatting is removed. No OCR, embedded frame content, or virtualized content absent from the DOM."},
  svg: {label: "SVG assets (ZIP) · native vectors", extension: "zip", mime: "application/zip", copy: true, use: "Extract native vector charts, diagrams, logos, and icons.", detail: "Saves unique inline SVGs in a ZIP, or copies SVG code as plain text. Repeated icons are included once. Sanitization removes scripts and unsafe markup; external styles or definitions may still be needed. It does not convert HTML or PNG into vectors. Use PDF for a scalable page document."},
};
