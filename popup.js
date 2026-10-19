const status = document.querySelector("#status");
const buttons = [...document.querySelectorAll("button")];

chrome.runtime.onMessage.addListener((message) => {
  if (message.target === "popup" && message.status) status.textContent = message.status;
});

async function capture(action) {
  buttons.forEach((button) => { button.disabled = true; });
  status.dataset.error = "false";
  status.textContent = "Preparing page… Keep this popup open.";
  try {
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    const result = await chrome.runtime.sendMessage({target: "background", action, tabId: tab?.id});
    if (!result?.ok) throw new Error(result?.error || "Capture failed. Please try again.");
    if (action === "copy") {
      const blob = await (await fetch(result.dataUrl)).blob();
      await navigator.clipboard.write([new ClipboardItem({"image/png": blob})]);
      status.textContent = "Copied. Paste your image anywhere.";
    } else {
      status.textContent = "Save dialog opened.";
    }
  } catch (error) {
    status.dataset.error = "true";
    status.textContent = error instanceof Error ? error.message : "Capture failed. Please try again.";
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
  }
}

document.querySelector("#copy-button").addEventListener("click", () => capture("copy"));
document.querySelector("#save-button").addEventListener("click", () => capture("save"));
