import { Component, MarkdownRenderer, type App } from "obsidian";
import { toPng } from "html-to-image";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import "pdfjs-dist/legacy/build/pdf.worker.mjs";

export interface RenderedVisual {
  data: string;
  extension: "png" | "svg";
}

export interface VisualRenderer {
  renderMarkdown(markdown: string, sourcePath: string): Promise<RenderedVisual | undefined>;
  renderPdf(data: ArrayBuffer): Promise<RenderedVisual>;
  renderCanvas(source: string): RenderedVisual;
}

const CAPTURE_WIDTH = 760;
const CAPTURE_TIMEOUT_MS = 4_000;

export class ObsidianVisualRenderer implements VisualRenderer {
  constructor(private readonly app: App) {}

  async renderMarkdown(markdown: string, sourcePath: string): Promise<RenderedVisual | undefined> {
    const component = new Component();
    const container = document.body.createDiv({ cls: "markdown-rendered oab-visual-capture" });
    container.setCssStyles({
      width: `${CAPTURE_WIDTH}px`,
      position: "fixed",
      left: "-10000px",
      top: "0",
      padding: "24px",
      background: "#ffffff",
      color: "#202020",
      zIndex: "-1"
    });
    component.load();
    try {
      await MarkdownRenderer.render(this.app, markdown, container, sourcePath, component);
      await waitForRenderedVisual(container);
      if (!containsRenderedVisual(container)) {
        return undefined;
      }
      const directCapture = captureRenderedVisual(container);
      if (directCapture) {
        return directCapture;
      }
      const dataUrl = await toPng(container, {
        backgroundColor: "#ffffff",
        cacheBust: false,
        pixelRatio: 1.5,
        skipFonts: true,
        width: Math.max(CAPTURE_WIDTH, container.scrollWidth),
        height: Math.max(1, container.scrollHeight)
      });
      return { data: dataUrl.slice(dataUrl.indexOf(",") + 1), extension: "png" };
    } finally {
      component.unload();
      container.remove();
    }
  }

  async renderPdf(data: ArrayBuffer): Promise<RenderedVisual> {
    const task = getDocument({
      data: new Uint8Array(data),
      isEvalSupported: false,
      useSystemFonts: true
    });
    try {
      const document = await task.promise;
      const page = await document.getPage(1);
      const initial = page.getViewport({ scale: 1 });
      const scale = Math.min(2, 1200 / Math.max(1, initial.width));
      const viewport = page.getViewport({ scale });
      const canvas = createEl("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) {
        throw new Error("Canvas rendering is unavailable.");
      }
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      const dataUrl = canvas.toDataURL("image/png");
      page.cleanup();
      await document.destroy();
      return { data: dataUrl.slice(dataUrl.indexOf(",") + 1), extension: "png" };
    } finally {
      await task.destroy();
    }
  }

  renderCanvas(source: string): RenderedVisual {
    const canvas = JSON.parse(source) as CanvasData;
    const nodes = Array.isArray(canvas.nodes) ? canvas.nodes.filter(isCanvasNode) : [];
    const edges = Array.isArray(canvas.edges) ? canvas.edges.filter(isCanvasEdge) : [];
    if (nodes.length === 0) {
      throw new Error("The Canvas contains no renderable nodes.");
    }
    const padding = 48;
    const minX = Math.min(...nodes.map((node) => node.x)) - padding;
    const minY = Math.min(...nodes.map((node) => node.y)) - padding;
    const maxX = Math.max(...nodes.map((node) => node.x + node.width)) + padding;
    const maxY = Math.max(...nodes.map((node) => node.y + node.height)) + padding;
    const width = Math.max(1, maxX - minX);
    const height = Math.max(1, maxY - minY);
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const groups = nodes.filter((node) => node.type === "group");
    const regularNodes = nodes.filter((node) => node.type !== "group");
    const svg = [
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${width} ${height}" role="img">`,
      "<defs><marker id=\"arrow\" markerWidth=\"10\" markerHeight=\"10\" refX=\"9\" refY=\"3\" orient=\"auto\"><path d=\"M0,0 L0,6 L9,3 z\" fill=\"#64748b\"/></marker></defs>",
      `<rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="#f8fafc"/>`,
      ...groups.map(renderGroup),
      ...edges.map((edge) => renderEdge(edge, byId)),
      ...regularNodes.map(renderNode),
      "</svg>"
    ].join("");
    return { data: utf8ToBase64(svg), extension: "svg" };
  }
}

interface CanvasData {
  nodes?: unknown[];
  edges?: unknown[];
}

interface CanvasNode {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  label?: string;
  file?: string;
  url?: string;
  color?: string;
}

interface CanvasEdge {
  fromNode: string;
  toNode: string;
  label?: string;
  toEnd?: string;
}

function isCanvasNode(value: unknown): value is CanvasNode {
  if (!value || typeof value !== "object") {
    return false;
  }
  const node = value as Partial<CanvasNode>;
  return typeof node.id === "string" && typeof node.type === "string" &&
    [node.x, node.y, node.width, node.height].every((entry) => typeof entry === "number" && Number.isFinite(entry));
}

function isCanvasEdge(value: unknown): value is CanvasEdge {
  if (!value || typeof value !== "object") {
    return false;
  }
  const edge = value as Partial<CanvasEdge>;
  return typeof edge.fromNode === "string" && typeof edge.toNode === "string";
}

function renderGroup(node: CanvasNode): string {
  const color = canvasColor(node.color, true);
  return `<g><rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="16" fill="${color.fill}" stroke="${color.stroke}" stroke-width="3" stroke-dasharray="10 7"/>${renderText(node.label ?? "", node.x + 16, node.y + 28, node.width - 32, "#334155", 18, "600")}</g>`;
}

function renderNode(node: CanvasNode): string {
  const color = canvasColor(node.color, false);
  const rawText = node.text ?? node.label ?? node.file ?? node.url ?? node.type;
  const text = simplifyMarkdown(rawText);
  return `<g><rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="12" fill="${color.fill}" stroke="${color.stroke}" stroke-width="2"/>${renderText(text, node.x + 14, node.y + 30, node.width - 28, "#172033", 17, "500")}</g>`;
}

function renderEdge(edge: CanvasEdge, byId: Map<string, CanvasNode>): string {
  const from = byId.get(edge.fromNode);
  const to = byId.get(edge.toNode);
  if (!from || !to) {
    return "";
  }
  const x1 = from.x + from.width / 2;
  const y1 = from.y + from.height / 2;
  const x2 = to.x + to.width / 2;
  const y2 = to.y + to.height / 2;
  const marker = edge.toEnd === "none" ? "" : ' marker-end="url(#arrow)"';
  const label = edge.label
    ? `<text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 8}" text-anchor="middle" fill="#475569" font-family="sans-serif" font-size="15">${escapeXml(edge.label)}</text>`
    : "";
  return `<g><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#64748b" stroke-width="2.5"${marker}/>${label}</g>`;
}

function renderText(
  value: string,
  x: number,
  y: number,
  width: number,
  color: string,
  fontSize: number,
  weight: string
): string {
  const maxCharacters = Math.max(8, Math.floor(width / (fontSize * 0.56)));
  const lines = wrapText(value, maxCharacters).slice(0, 10);
  const spans = lines.map((line, index) =>
    `<tspan x="${x}" dy="${index === 0 ? 0 : fontSize * 1.35}">${escapeXml(line)}</tspan>`
  ).join("");
  return `<text x="${x}" y="${y}" fill="${color}" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" font-size="${fontSize}" font-weight="${weight}">${spans}</text>`;
}

function wrapText(value: string, maxCharacters: number): string[] {
  const lines: string[] = [];
  for (const paragraph of value.split(/\r?\n/)) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    let line = "";
    for (const word of words) {
      if (line && `${line} ${word}`.length > maxCharacters) {
        lines.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    if (line) {
      lines.push(line);
    }
  }
  return lines.length > 0 ? lines : [""];
}

function simplifyMarkdown(value: string): string {
  return value
    .replace(/!\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, "$1")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/[*_`>#~-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canvasColor(color: string | undefined, group: boolean): { fill: string; stroke: string } {
  const palette: Record<string, { fill: string; stroke: string }> = {
    "1": { fill: "#fee2e2", stroke: "#ef4444" },
    "2": { fill: "#ffedd5", stroke: "#f97316" },
    "3": { fill: "#fef3c7", stroke: "#d97706" },
    "4": { fill: "#dcfce7", stroke: "#22c55e" },
    "5": { fill: "#dbeafe", stroke: "#3b82f6" },
    "6": { fill: "#ede9fe", stroke: "#8b5cf6" }
  };
  return palette[color ?? ""] ?? (group
    ? { fill: "#f1f5f9", stroke: "#94a3b8" }
    : { fill: "#ffffff", stroke: "#94a3b8" });
}

function containsRenderedVisual(container: HTMLElement): boolean {
  return container.querySelector("svg, canvas, img, video, iframe, .excalidraw-embedded") !== null;
}

function captureRenderedVisual(container: HTMLElement): RenderedVisual | undefined {
  const candidates = [...container.querySelectorAll<SVGSVGElement | HTMLCanvasElement | HTMLImageElement>("svg, canvas, img")]
    .filter((element) => visualDimensions(element).width > 1 && visualDimensions(element).height > 1)
    .sort((left, right) => visualArea(right) - visualArea(left));
  for (const candidate of candidates) {
    try {
      if (candidate.instanceOf(HTMLCanvasElement)) {
        return captureCanvas(candidate);
      }
      if (candidate.instanceOf(SVGSVGElement)) {
        return captureSvg(candidate);
      }
      if (candidate.instanceOf(HTMLImageElement) && candidate.complete && candidate.naturalWidth > 0) {
        return captureImage(candidate);
      }
    } catch {
      // Try the next rendered element before falling back to a full DOM capture.
    }
  }
  return undefined;
}

function captureCanvas(source: HTMLCanvasElement): RenderedVisual {
  const width = Math.max(1, source.width);
  const height = Math.max(1, source.height);
  const target = createEl("canvas");
  target.width = width;
  target.height = height;
  const context = target.getContext("2d", { alpha: false });
  if (!context) {
    throw new Error("Canvas rendering is unavailable.");
  }
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(source, 0, 0, width, height);
  return dataUrlVisual(target.toDataURL("image/png"), "png");
}

function captureImage(source: HTMLImageElement): RenderedVisual {
  const width = Math.max(1, source.naturalWidth);
  const height = Math.max(1, source.naturalHeight);
  const target = createEl("canvas");
  target.width = width;
  target.height = height;
  const context = target.getContext("2d", { alpha: false });
  if (!context) {
    throw new Error("Canvas rendering is unavailable.");
  }
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(source, 0, 0, width, height);
  return dataUrlVisual(target.toDataURL("image/png"), "png");
}

function captureSvg(source: SVGSVGElement): RenderedVisual {
  const dimensions = visualDimensions(source);
  const clone = source.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
  clone.setAttribute("width", String(dimensions.width));
  clone.setAttribute("height", String(dimensions.height));
  if (!clone.hasAttribute("viewBox")) {
    clone.setAttribute("viewBox", `0 0 ${dimensions.width} ${dimensions.height}`);
  }
  inlineSvgStyles(source, clone);
  clone.querySelectorAll("script").forEach((element) => element.remove());
  clone.querySelectorAll("*").forEach((element) => {
    for (const attribute of [...element.attributes]) {
      if (attribute.name.toLowerCase().startsWith("on")) {
        element.removeAttribute(attribute.name);
      }
    }
  });
  const viewBox = clone.viewBox.baseVal;
  const background = createSvg("rect");
  background.setAttribute("x", String(viewBox?.x ?? 0));
  background.setAttribute("y", String(viewBox?.y ?? 0));
  background.setAttribute("width", String(viewBox?.width || dimensions.width));
  background.setAttribute("height", String(viewBox?.height || dimensions.height));
  background.setAttribute("fill", "#ffffff");
  clone.insertBefore(background, clone.firstChild);
  return { data: utf8ToBase64(new XMLSerializer().serializeToString(clone)), extension: "svg" };
}

const SVG_STYLE_PROPERTIES = [
  "color",
  "fill",
  "fill-opacity",
  "fill-rule",
  "stroke",
  "stroke-opacity",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-dasharray",
  "stroke-dashoffset",
  "opacity",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "letter-spacing",
  "text-anchor",
  "dominant-baseline",
  "paint-order",
  "visibility",
  "display"
] as const;

function inlineSvgStyles(source: SVGSVGElement, clone: SVGSVGElement): void {
  const sources = [source, ...source.querySelectorAll<SVGElement>("*")];
  const clones = [clone, ...clone.querySelectorAll<SVGElement>("*")];
  for (const [index, sourceElement] of sources.entries()) {
    const cloneElement = clones[index];
    if (!cloneElement) {
      continue;
    }
    const computed = window.getComputedStyle(sourceElement);
    const declarations = SVG_STYLE_PROPERTIES
      .map((property) => {
        const value = computed.getPropertyValue(property);
        return value ? `${property}:${value}` : "";
      })
      .filter(Boolean)
      .join(";");
    if (declarations) {
      cloneElement.setAttribute("style", declarations);
    }
  }
}

function dataUrlVisual(dataUrl: string, extension: "png" | "svg"): RenderedVisual {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) {
    throw new Error("The rendered visual did not produce a valid data URL.");
  }
  return { data: dataUrl.slice(comma + 1), extension };
}

function visualArea(element: SVGSVGElement | HTMLCanvasElement | HTMLImageElement): number {
  const dimensions = visualDimensions(element);
  return dimensions.width * dimensions.height;
}

function visualDimensions(element: SVGSVGElement | HTMLCanvasElement | HTMLImageElement): { width: number; height: number } {
  if (element.instanceOf(HTMLCanvasElement)) {
    return { width: element.width, height: element.height };
  }
  if (element.instanceOf(HTMLImageElement) && element.naturalWidth > 0 && element.naturalHeight > 0) {
    return { width: element.naturalWidth, height: element.naturalHeight };
  }
  const bounds = element.getBoundingClientRect();
  if (bounds.width > 1 && bounds.height > 1) {
    return { width: Math.ceil(bounds.width), height: Math.ceil(bounds.height) };
  }
  if (element.instanceOf(SVGSVGElement) && element.viewBox.baseVal.width > 0 && element.viewBox.baseVal.height > 0) {
    return { width: element.viewBox.baseVal.width, height: element.viewBox.baseVal.height };
  }
  return { width: 0, height: 0 };
}

async function waitForRenderedVisual(container: HTMLElement): Promise<void> {
  const startedAt = Date.now();
  let lastMutationAt = startedAt;
  const observer = new MutationObserver(() => {
    lastMutationAt = Date.now();
  });
  observer.observe(container, { childList: true, subtree: true, attributes: true });
  try {
    while (Date.now() - startedAt < CAPTURE_TIMEOUT_MS) {
      await delay(100);
      const hasVisual = containsRenderedVisual(container);
      const quiet = Date.now() - lastMutationAt >= 350;
      const imagesReady = [...container.querySelectorAll("img")].every((image) => image.complete && image.naturalWidth > 0);
      if (hasVisual && quiet && imagesReady) {
        await delay(500);
        return;
      }
    }
  } finally {
    observer.disconnect();
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function utf8ToBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  const chunks: string[] = [];
  for (let index = 0; index < bytes.length; index += 0x8000) {
    chunks.push(String.fromCharCode(...bytes.subarray(index, Math.min(index + 0x8000, bytes.length))));
  }
  return btoa(chunks.join(""));
}

function escapeXml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&apos;",
    '"': "&quot;"
  })[character] ?? character);
}

export function isVisualCodeLanguage(language: string): boolean {
  return new Set(["chartsview", "functionplot"]).has(language.toLowerCase());
}
