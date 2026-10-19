let canvas;
let context;

async function handle(message) {
  if (message.action === "start") {
    canvas = new OffscreenCanvas(message.width, message.height);
    context = canvas.getContext("2d", {alpha: false});
    if (!context) throw new Error("Not enough memory to create the screenshot.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    if (context.getImageData(canvas.width - 1, canvas.height - 1, 1, 1).data[3] !== 255) {
      throw new Error("Not enough memory to create the screenshot.");
    }
    return {ok: true};
  }
  if (!canvas || !context) throw new Error("Screenshot assembly was interrupted.");
  if (message.action === "tile") {
    const blob = await (await fetch(`data:image/png;base64,${message.data}`)).blob();
    const image = await createImageBitmap(blob);
    const {x, y, width, height} = message.destination;
    context.drawImage(image, x, y, width, height);
    image.close();
    return {ok: true};
  }
  if (message.action === "finish") {
    const blob = await canvas.convertToBlob({type: "image/png"});
    if (blob.size > 40_000_000) throw new Error("The PNG exceeds the browser's image transfer limit. Capture a shorter page.");
    const reader = new FileReader();
    const dataUrl = await new Promise((resolve, reject) => {
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    canvas.width = 1;
    canvas.height = 1;
    context = undefined;
    canvas = undefined;
    return {ok: true, dataUrl};
  }
  throw new Error("Unknown image operation.");
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.target !== "offscreen" || sender.id !== chrome.runtime.id) return;
  handle(message).then(respond).catch((error) => respond({ok: false, error: error.message}));
  return true;
});
