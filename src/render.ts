import MarkdownIt from "markdown-it";
import { App, TFile } from "obsidian";
import { stableHash } from "./hash";
import { escapeHtml, fileHref } from "./source-link";
import { isVisualCodeLanguage, type RenderedVisual, type VisualRenderer } from "./visual-renderer";

export interface MediaStore {
  storeMediaFile(filename: string, data: string): Promise<string>;
}

export interface RenderResult {
  html: string;
  warnings: string[];
}

export interface RenderLinkContext {
  vaultName: string;
  sourceHref: string;
}

const markdown = new MarkdownIt({ html: false, linkify: true, breaks: true });
const WIKI_EMBED_PATTERN = /!\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
const MARKDOWN_IMAGE_PATTERN = /!\[([^\]]*)\]\((?:<([^>]+)>|([^\s)]+))(?:\s+["'][^"']*["'])?\)/g;
const FENCED_BLOCK_PATTERN = /^(`{3,}|~{3,})\s*([^\n]*)\n[\s\S]*?^\1[ \t]*$/gm;
const DIRECT_IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"]);
const AUDIO_EXTENSIONS = new Set(["mp3", "ogg", "wav", "m4a", "flac", "opus", "aac"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "ogv", "mov", "m4v"]);

export async function renderForAnki(
  app: App,
  mediaStore: MediaStore,
  sourcePath: string,
  value: string,
  visualRenderer?: VisualRenderer,
  links?: RenderLinkContext
): Promise<RenderResult> {
  const warnings: string[] = [];
  const safeFragments = new Map<string, string>();
  const protectedBlocks = new Map<string, string>();
  let tokenOrdinal = 0;
  const token = (kind: "SAFE" | "BLOCK"): string =>
    `OAB${kind}${stableHash(`${sourcePath}\u241f${value}\u241f${tokenOrdinal++}`)}TOKEN`;
  const protect = (raw: string): string => {
    const key = token("BLOCK");
    protectedBlocks.set(key, raw);
    return key;
  };
  const inject = (html: string): string => {
    const key = token("SAFE");
    safeFragments.set(key, html);
    return key;
  };

  let prepared = await replaceMatches(value, FENCED_BLOCK_PATTERN, async (match) => {
    const language = (match[2] ?? "").trim().split(/\s+/, 1)[0] ?? "";
    if (!isVisualCodeLanguage(language)) {
      return protect(match[0]);
    }
    if (!visualRenderer) {
      warnings.push(`No visual renderer is available for the ${language} block.`);
      return protect(match[0]);
    }
    try {
      const rendered = await visualRenderer.renderMarkdown(match[0], sourcePath);
      if (!rendered) {
        warnings.push(`The ${language} block could not be rendered. Is the corresponding Obsidian plugin enabled?`);
        return protect(match[0]);
      }
      return inject(linkVisual(await storeVisual(mediaStore, rendered, language), links?.sourceHref));
    } catch (error) {
      warnings.push(`Could not render the ${language} block: ${errorMessage(error)}`);
      return protect(match[0]);
    }
  });

  prepared = await replaceMatches(prepared, WIKI_EMBED_PATTERN, async (match) => {
    const target = match[1] ?? "";
    const file = app.metadataCache.getFirstLinkpathDest(target, sourcePath);
    return inject(await renderEmbeddedFile(
      app,
      mediaStore,
      visualRenderer,
      file,
      match[0],
      sourcePath,
      target,
      warnings,
      links
    ));
  });

  prepared = await replaceMatches(prepared, MARKDOWN_IMAGE_PATTERN, async (match) => {
    const rawTarget = match[2] ?? match[3] ?? "";
    if (/^(?:https?:|data:)/i.test(rawTarget)) {
      return match[0];
    }
    let target = rawTarget;
    try {
      target = decodeURIComponent(rawTarget);
    } catch {
      // Keep the literal target if it is not valid URI encoding.
    }
    const file = app.metadataCache.getFirstLinkpathDest(target, sourcePath);
    return inject(await renderEmbeddedFile(
      app,
      mediaStore,
      visualRenderer,
      file,
      match[0],
      sourcePath,
      target,
      warnings,
      links,
      match[1]
    ));
  });

  for (const [key, raw] of protectedBlocks) {
    prepared = prepared.replaceAll(key, raw);
  }
  let html = markdown.render(prepared);
  for (const [key, fragment] of safeFragments) {
    html = html.replaceAll(`<p>${key}</p>\n`, `${fragment}\n`).replaceAll(key, fragment);
  }
  return { html, warnings };
}

async function renderEmbeddedFile(
  app: App,
  mediaStore: MediaStore,
  visualRenderer: VisualRenderer | undefined,
  file: TFile | null,
  originalEmbed: string,
  sourcePath: string,
  target: string,
  warnings: string[],
  links?: RenderLinkContext,
  requestedAlt?: string
): Promise<string> {
  if (!(file instanceof TFile)) {
    warnings.push(`Embedded file not found: ${target}`);
    return warningHtml(`Embedded file not found: ${target}`);
  }
  const extension = file.extension.toLowerCase();
  const alt = requestedAlt?.trim() || file.basename;
  const href = links ? fileHref(links.vaultName, file.path) : undefined;

  if (DIRECT_IMAGE_EXTENSIONS.has(extension)) {
    const stored = await storeBinaryFile(app, mediaStore, file, extension);
    return linkVisual(`<img class="oab-media" src="${escapeHtml(stored)}" alt="${escapeHtml(alt)}">`, href);
  }
  if (AUDIO_EXTENSIONS.has(extension)) {
    const stored = await storeBinaryFile(app, mediaStore, file, extension);
    return mediaWithCaption(`<audio class="oab-media" controls src="${escapeHtml(stored)}"></audio>`, href, file.basename);
  }
  if (VIDEO_EXTENSIONS.has(extension)) {
    const stored = await storeBinaryFile(app, mediaStore, file, extension);
    return mediaWithCaption(`<video class="oab-media" controls src="${escapeHtml(stored)}"></video>`, href, file.basename);
  }
  if (extension === "pdf") {
    const binary = await app.vault.readBinary(file);
    const encoded = arrayBufferToBase64(binary);
    const pdfFilename = `oab-${stableHash(encoded)}.pdf`;
    await mediaStore.storeMediaFile(pdfFilename, encoded);
    if (visualRenderer) {
      try {
        const preview = await visualRenderer.renderPdf(binary);
        const previewHtml = await storeVisual(mediaStore, preview, file.basename);
        return `<figure class="oab-document">${linkVisual(previewHtml, href)}<figcaption>${sourceFileLink(href, file.basename)} · <a href="${escapeHtml(pdfFilename)}">PDF</a></figcaption></figure>`;
      } catch (error) {
        warnings.push(`Could not render a preview of ${file.name}: ${errorMessage(error)}`);
      }
    }
    return href
      ? sourceFileLink(href, file.basename)
      : `<a href="${escapeHtml(pdfFilename)}">PDF: ${escapeHtml(file.basename)}</a>`;
  }
  if (extension === "canvas") {
    if (!visualRenderer) {
      warnings.push(`No visual renderer is available for ${file.name}.`);
      return warningHtml(`Canvas preview unavailable: ${file.name}`);
    }
    try {
      const rendered = visualRenderer.renderCanvas(await app.vault.read(file));
      return linkVisual(await storeVisual(mediaStore, rendered, file.basename), href);
    } catch (error) {
      warnings.push(`Could not render ${file.name}: ${errorMessage(error)}`);
      return warningHtml(`Canvas preview unavailable: ${file.name}`);
    }
  }

  if (visualRenderer) {
    try {
      const rendered = await visualRenderer.renderMarkdown(originalEmbed, sourcePath);
      if (rendered) {
        return linkVisual(await storeVisual(mediaStore, rendered, file.basename), href);
      }
    } catch (error) {
      warnings.push(`Could not render ${file.name}: ${errorMessage(error)}`);
      return warningHtml(`Preview unavailable: ${file.name}`);
    }
  }
  warnings.push(`Unsupported embedded format: ${file.name}`);
  return warningHtml(`Unsupported embedded format: ${file.name}`);
}

async function storeBinaryFile(
  app: App,
  mediaStore: MediaStore,
  file: TFile,
  extension: string
): Promise<string> {
  const binary = await app.vault.readBinary(file);
  const encoded = arrayBufferToBase64(binary);
  const filename = `oab-${stableHash(encoded)}.${extension}`;
  await mediaStore.storeMediaFile(filename, encoded);
  return filename;
}

async function storeVisual(mediaStore: MediaStore, rendered: RenderedVisual, label: string): Promise<string> {
  const filename = `oab-render-${stableHash(rendered.data)}.${rendered.extension}`;
  await mediaStore.storeMediaFile(filename, rendered.data);
  return `<img class="oab-rendered-visual" src="${escapeHtml(filename)}" alt="${escapeHtml(label)}">`;
}

function linkVisual(html: string, href: string | undefined): string {
  return href
    ? `<a class="oab-embedded-link" href="${escapeHtml(href)}">${html}</a>`
    : html;
}

function mediaWithCaption(html: string, href: string | undefined, label: string): string {
  return href
    ? `<figure class="oab-media-with-link">${html}<figcaption>${sourceFileLink(href, label)}</figcaption></figure>`
    : html;
}

function sourceFileLink(href: string | undefined, label: string): string {
  return href
    ? `<a class="oab-embedded-file" href="${escapeHtml(href)}">${escapeHtml(label)}</a>`
    : escapeHtml(label);
}

function warningHtml(message: string): string {
  return `<aside class="oab-warning">${escapeHtml(message)}</aside>`;
}

async function replaceMatches(
  input: string,
  pattern: RegExp,
  replacer: (match: RegExpMatchArray) => Promise<string>
): Promise<string> {
  const matches = [...input.matchAll(pattern)];
  if (matches.length === 0) {
    return input;
  }
  const replacements = await Promise.all(matches.map(replacer));
  let output = "";
  let cursor = 0;
  for (const [index, match] of matches.entries()) {
    const matchIndex = match.index ?? cursor;
    output += input.slice(cursor, matchIndex) + (replacements[index] ?? match[0]);
    cursor = matchIndex + match[0].length;
  }
  return output + input.slice(cursor);
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunks: string[] = [];
  for (let index = 0; index < bytes.length; index += 0x8000) {
    chunks.push(String.fromCharCode(...bytes.subarray(index, Math.min(index + 0x8000, bytes.length))));
  }
  return btoa(chunks.join(""));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
