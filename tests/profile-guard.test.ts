import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
let activeProfile: string | null = "Me";
let supportsActiveProfile = true;

vi.mock("obsidian", async () => {
  const stub = await vi.importActual<Record<string, unknown>>("./stubs/obsidian");
  return {
    ...stub,
    requestUrl: async ({ body }: { body: string }) => {
      const { action } = JSON.parse(body) as { action: string };
      calls.push(action);
      if (action === "getActiveProfile") {
        return supportsActiveProfile
          ? { status: 200, json: { result: activeProfile, error: null } }
          : { status: 200, json: { result: null, error: "unsupported action" } };
      }
      if (action === "getProfiles") {
        return { status: 200, json: { result: ["Me", "Child"], error: null } };
      }
      if (action === "version") {
        return { status: 200, json: { result: 6, error: null } };
      }
      return { status: 200, json: { result: [], error: null } };
    }
  };
});

const {
  AnkiConnectClient,
  AnkiProfileMismatchError,
  AnkiUnreachableError,
  PROFILE_CHECK_TTL_MS
} = await import("../src/anki-connect");
type Status = import("../src/anki-connect").AnkiProfileStatus;

function client(requiredProfile: string, now = () => 1_000_000, cache = {}, statuses: Array<Status | undefined> = []) {
  return new AnkiConnectClient("http://127.0.0.1:18765", "", undefined, {
    requiredProfile,
    cache,
    now,
    onStatus: (status) => statuses.push(status)
  });
}

beforeEach(() => {
  calls.length = 0;
  activeProfile = "Me";
  supportsActiveProfile = true;
});

describe("required Anki profile", () => {
  it("does not check the profile when no profile is required", async () => {
    await client("").invoke("findNotes", { query: "x" });
    expect(calls).toEqual(["findNotes"]);
  });

  it("checks the profile before collection access and proceeds when it matches", async () => {
    await client("  Me ").invoke("findNotes", { query: "x" });
    expect(calls).toEqual(["getActiveProfile", "findNotes"]);
  });

  it("blocks collection access when another profile is open", async () => {
    activeProfile = "Child";
    const statuses: Array<Status | undefined> = [];
    const promise = client("Me", undefined, {}, statuses).invoke("addNote", {});
    await expect(promise).rejects.toBeInstanceOf(AnkiProfileMismatchError);
    await expect(promise).rejects.toBeInstanceOf(AnkiUnreachableError);
    await expect(promise).rejects.toThrow("Anki profile “Child” is open; waiting for “Me”.");
    expect(calls).not.toContain("addNote");
    expect(statuses.at(-1)).toMatchObject({ requiredProfile: "Me", activeProfile: "Child", matches: false });
  });

  it("fails safe when AnkiConnect cannot report the open profile", async () => {
    supportsActiveProfile = false;
    const promise = client("Me").invoke("deleteNotes", { notes: [1] });
    await expect(promise).rejects.toBeInstanceOf(AnkiProfileMismatchError);
    await expect(promise).rejects.toThrow(/cannot report the open profile/);
    expect(calls).not.toContain("deleteNotes");
  });

  it("fails safe when no profile is loaded", async () => {
    activeProfile = null;
    await expect(client("Me").invoke("findNotes", {})).rejects.toBeInstanceOf(AnkiProfileMismatchError);
    expect(calls).not.toContain("findNotes");
  });

  it("lets profile-independent actions through without a check", async () => {
    activeProfile = "Child";
    const c = client("Me");
    await expect(c.ping()).resolves.toBe(6);
    await expect(c.getProfiles()).resolves.toEqual(["Me", "Child"]);
    expect(calls).toEqual(["version", "getProfiles"]);
  });

  it("reuses a matching check only briefly and never caches a mismatch", async () => {
    let now = 1_000_000;
    const cache = {};
    const c = client("Me", () => now, cache);
    await c.invoke("findNotes", {});
    await c.invoke("notesInfo", {});
    expect(calls.filter((action) => action === "getActiveProfile")).toHaveLength(1);

    now += PROFILE_CHECK_TTL_MS;
    activeProfile = "Child";
    await expect(c.invoke("findNotes", {})).rejects.toBeInstanceOf(AnkiProfileMismatchError);
    await expect(c.invoke("findNotes", {})).rejects.toBeInstanceOf(AnkiProfileMismatchError);
    expect(calls.filter((action) => action === "getActiveProfile")).toHaveLength(3);
  });

  it("does not reuse a cached match after the required profile changes", async () => {
    const cache = {};
    await client("Me", undefined, cache).invoke("findNotes", {});
    activeProfile = "Me";
    await expect(client("Child", undefined, cache).invoke("findNotes", {})).rejects.toBeInstanceOf(AnkiProfileMismatchError);
  });

  it("re-checks on demand regardless of the cache", async () => {
    const cache = {};
    const c = client("Me", undefined, cache);
    await c.assertRequiredProfile();
    activeProfile = "Child";
    await expect(c.assertRequiredProfile(true)).rejects.toBeInstanceOf(AnkiProfileMismatchError);
  });
});
