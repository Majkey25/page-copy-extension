const status = document.querySelector("#status");
const buttons = [...document.querySelectorAll("button")];
const saveFormat = document.querySelector("#save-format");

chrome.runtime.onMessage.addListener((message) => {
  if (message.target === "popup" && message.status) status.textContent = message.status;
});

async function capture(action, format) {
  buttons.forEach((button) => { button.disabled = true; });
  saveFormat.disabled = true;
  status.dataset.error = "false";
  status.textContent = "Preparing page… Keep this popup open.";
  try {
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    const result = await chrome.runtime.sendMessage({target: "background", action, format, tabId: tab?.id});
    if (!result?.ok) throw new Error(result?.error || "Capture failed. Please try again.");
    if (action === "copy" && format === "txt") {
      await navigator.clipboard.writeText(result.text);
      status.textContent = "Copied page text. Paste into your AI chat. Image/canvas text is not included.";
    } else if (action === "copy") {
      const blob = await (await fetch(result.dataUrl)).blob();
      await navigator.clipboard.write([new ClipboardItem({"image/png": blob})]);
      status.textContent = "Copied lossless PNG. The receiving chat may resize it. Use text or AI tiles for long pages.";
    } else {
      status.textContent = "Save dialog opened.";
    }
  } catch (error) {
    status.dataset.error = "true";
    status.textContent = error instanceof Error ? error.message : "Capture failed. Please try again.";
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
    saveFormat.disabled = false;
  }
}

document.querySelector("#copy-button").addEventListener("click", () => capture("copy", "png"));
document.querySelector("#text-button").addEventListener("click", () => capture("copy", "txt"));
document.querySelector("#save-button").addEventListener("click", () => capture("save", saveFormat.value));
