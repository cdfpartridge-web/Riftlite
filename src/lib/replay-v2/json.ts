import type { JsonObject, JsonValue } from "@/lib/replay-v2/types";

const SECRET_KEY = /^(?:.*authorization|authentication|auth|(?:(?:.*(?:access|refresh|identity|id|api|bearer|session|auth|csrf))[_-]?)?token|(?:(?:.*(?:session|auth|csrf))[_-]?)?cookies?|.*password(?:[_-]?hash)?|(?:(?:.*(?:client|private|api))[_-]?)?secret(?:[_-]?key)?|api[_-]?key|.*credentials?)$/i;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function integerValue(value: unknown): number | undefined {
  const number = finiteNumber(value);
  return number !== undefined && Number.isInteger(number) ? number : undefined;
}

export function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export function toJsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (Array.isArray(value)) {
    return value.map(toJsonValue);
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined && typeof entry !== "function" && typeof entry !== "symbol")
        .map(([key, entry]) => [key, toJsonValue(entry)]),
    );
  }
  return null;
}

export function toJsonObject(value: unknown): JsonObject {
  const normalized = toJsonValue(value);
  return isJsonObject(normalized) ? normalized : {};
}

export function cloneJson<T extends JsonValue>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneJson(entry)) as T;
  }
  if (isJsonObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneJson(entry)])) as T;
  }
  return value;
}

export function redactSecrets(value: unknown): JsonValue {
  if (Array.isArray(value)) {
    return value.map(redactSecrets);
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, entry]) =>
        SECRET_KEY.test(key) ? [] : [[key, redactSecrets(entry)] as const],
      ),
    );
  }
  return toJsonValue(value);
}

export function redactRawText(value: string): string {
  return value.replace(
    /("([^"]+)"\s*:\s*)"(?:\\.|[^"\\])*"/g,
    (match, prefix: string, key: string) => (SECRET_KEY.test(key) ? `${prefix}"[redacted]"` : match),
  );
}

export function canonicalStringify(value: unknown): string {
  return JSON.stringify(sortJson(toJsonValue(value)));
}

function sortJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!isJsonObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortJson(value[key])]),
  );
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
