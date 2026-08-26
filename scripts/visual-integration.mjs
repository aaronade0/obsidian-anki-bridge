import process from "node:process";

const debugPort = Number.parseInt(process.env.OAB_OBSIDIAN_DEBUG_PORT ?? "9223", 10);
const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
const page = targets.find((target) => target.type === "page" && target.url.startsWith("app://obsidian.md"));
if (!page?.webSocketDebuggerUrl) {
  throw new Error("No Obsidian renderer target found.");
}

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
let nextId = 1;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  message.error ? request.reject(new Error(JSON.stringify(message.error))) : request.resolve(message.result);
});

function command(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

await command("Runtime.enable");
const result = await command("Runtime.evaluate", {
  expression: `(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const visualPluginIds = ["obsidian-excalidraw-plugin", "obsidian-functionplot", "obsidian-chartsview-plugin"];
    const newlyEnabled = [];
    for (const pluginId of visualPluginIds) {
      if (!globalThis.app.plugins.manifests[pluginId]) {
        throw new Error("Required visual integration plugin is not installed: " + pluginId);
      }
      if (!globalThis.app.plugins.plugins[pluginId]) {
        await globalThis.app.plugins.enablePlugin(pluginId);
        newlyEnabled.push(pluginId);
      }
    }
    await sleep(250);
    await globalThis.app.plugins.disablePlugin("anki-bridge");
    await globalThis.app.plugins.enablePlugin("anki-bridge");
    const plugin = globalThis.app.plugins.plugins["anki-bridge"];
    if (!plugin) throw new Error("Bridge plugin was not reloaded.");
    const inputs = {
      excalidraw: "![[Visual Fixture.excalidraw]]",
      functionplot: ${JSON.stringify("```functionplot\n---\ntitle: Quadratic\nxLabel: x\nyLabel: y\nbounds: [-10,10,-10,10]\ndisableZoom: false\ngrid: true\n---\nf(x)=x^2\n```")},
      chartsview: ${JSON.stringify("```chartsview\ntype: Area\ndata:\n  - label: '1951'\n    value: 38\n  - label: '1952'\n    value: 52\n  - label: '1956'\n    value: 61\noptions:\n  xField: label\n  yField: value\n```")}
    };
    const inspect = async (rendered) => {
      const image = new Image();
      image.src = "data:image/" + (rendered.extension === "svg" ? "svg+xml" : "png") + ";base64," + rendered.data;
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error("Captured image could not be decoded."));
      });
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let nonWhite = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        if (pixels[index] < 248 || pixels[index + 1] < 248 || pixels[index + 2] < 248) nonWhite += 1;
      }
      return {
        extension: rendered.extension,
        width: canvas.width,
        height: canvas.height,
        bytes: rendered.data.length,
        nonWhiteRatio: nonWhite / Math.max(1, canvas.width * canvas.height)
      };
    };
    try {
      const captures = {};
      for (const [name, markdown] of Object.entries(inputs)) {
        const rendered = await plugin.visualRenderer.renderMarkdown(markdown, "Visual Integration.md");
        if (!rendered) throw new Error(name + " did not produce a visual.");
        captures[name] = await inspect(rendered);
      }
      return captures;
    } finally {
      for (const pluginId of newlyEnabled.reverse()) {
        await globalThis.app.plugins.disablePlugin(pluginId);
      }
    }
  })()`,
  awaitPromise: true,
  returnByValue: true
});
socket.close();
if (result.exceptionDetails) {
  throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
}
const captures = result.result?.value;
for (const [name, capture] of Object.entries(captures ?? {})) {
  if (!capture || capture.width < 10 || capture.height < 10 || capture.nonWhiteRatio < 0.001) {
    throw new Error(`${name} capture is blank or invalid: ${JSON.stringify(capture)}`);
  }
}
if (Object.keys(captures ?? {}).length !== 3) {
  throw new Error(`Expected three plugin visual captures: ${JSON.stringify(captures)}`);
}
process.stdout.write(JSON.stringify({ ok: true, captures }) + "\n");
