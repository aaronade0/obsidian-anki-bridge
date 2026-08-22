const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const UINT64_MASK = 0xffffffffffffffffn;

export function stableHash(value: string): string {
  let hash = FNV_OFFSET;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = (hash * FNV_PRIME) & UINT64_MASK;
  }
  return hash.toString(16).padStart(16, "0");
}

export function normalizeForFingerprint(value: string): string {
  return value.replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").trim();
}

export function createKey(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) {
    return `${prefix}_${uuid}`;
  }

  const entropy = `${Date.now()}_${Math.random()}_${Math.random()}`;
  return `${prefix}_${stableHash(entropy)}_${stableHash(entropy.split("").reverse().join(""))}`;
}
