import { writeFile } from "node:fs/promises";
import process from "node:process";

const output = process.argv[2] ?? "/tmp/oab-obsidian-smoke.png";
const port = process.env.OAB_OBSIDIAN_DEBUG_PORT ?? "9223";
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = targets.find((target) => target.type === "page" && target.url.startsWith("app://obsidian.md"));
if (!page?.webSocketDebuggerUrl) throw new Error("No Obsidian renderer target found.");
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
socket.send(JSON.stringify({ id: 1, method: "Page.captureScreenshot", params: { format: "png", fromSurface: true } }));
const response = await new Promise((resolve) => socket.addEventListener("message", (event) => {
  const value = JSON.parse(event.data);
  if (value.id === 1) resolve(value);
}));
socket.close();
if (!response.result?.data) throw new Error(JSON.stringify(response));
await writeFile(output, Buffer.from(response.result.data, "base64"));
process.stdout.write(`${output}\n`);
