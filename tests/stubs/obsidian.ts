// Obsidian ships types only, so tests that exercise runtime code from the
// plugin need a minimal stand-in for the values they touch.

export class TFile {
  path: string;
  basename: string;
  extension: string;

  constructor(path: string) {
    this.path = path;
    const name = path.split("/").pop() ?? path;
    const dot = name.lastIndexOf(".");
    this.basename = dot > 0 ? name.slice(0, dot) : name;
    this.extension = dot > 0 ? name.slice(dot + 1) : "";
  }
}

export class TFolder {}
export class App {}
export class Notice {}
export class Plugin {}
export const Platform = { isMobile: false };
