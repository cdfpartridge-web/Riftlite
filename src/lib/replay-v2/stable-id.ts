import { canonicalStringify } from "@/lib/replay-v2/json";

export function stableId(namespace: string, ...parts: unknown[]): string {
  const input = `${namespace}\u001f${parts.map(canonicalStringify).join("\u001f")}`;
  const left = fnv1a32(input, 0x811c9dc5);
  const right = fnv1a32(input, 0x9e3779b1);
  return `${safeNamespace(namespace)}_${hex(left)}${hex(right)}`;
}

export function stableDigest(value: unknown): string {
  const input = canonicalStringify(value);
  return `${hex(fnv1a32(input, 0x811c9dc5))}${hex(fnv1a32(input, 0x9e3779b1))}`;
}

function fnv1a32(value: string, seed: number): number {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function safeNamespace(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return normalized || "id";
}

function hex(value: number): string {
  return value.toString(16).padStart(8, "0");
}
