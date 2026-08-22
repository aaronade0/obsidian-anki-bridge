import process from "node:process";

const expression = process.argv[2];
if (!expression) throw new Error("Pass a JavaScript expression as the first argument.");
const port = process.env.OAB_OBSIDIAN_DEBUG_PORT ?? "9223";
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = targets.find((target) => target.type === "page" && target.url.startsWith("app://obsidian.md"));
if (!page?.webSocketDebuggerUrl) throw new Error("No Obsidian renderer target found.");
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
socket.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
const response = await new Promise((resolve) => socket.addEventListener("message", (event) => {
  const value = JSON.parse(event.data);
  if (value.id === 1) resolve(value);
}));
socket.close();
process.stdout.write(JSON.stringify(response, null, 2) + "\n");
