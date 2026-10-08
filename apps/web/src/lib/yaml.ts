const INDENT = "  ";
const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export type YamlScalar = string | number | boolean;
export type YamlValue =
  | YamlScalar
  | readonly YamlValue[]
  | { readonly [key: string]: YamlValue };
export type YamlDocument = { readonly [key: string]: YamlValue };

function pad(level: number): string {
  return INDENT.repeat(level);
}

function quoteString(value: string): string {
  return `'${value.split("'").join("''")}'`;
}

function emitScalar(value: YamlScalar): string {
  if (typeof value === "string") {
    return quoteString(value);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (!Number.isFinite(value)) {
    throw new RangeError("yaml emitter only supports finite numbers");
  }
  return String(value);
}

function isScalar(value: YamlValue): value is YamlScalar {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function isPlainObject(
  value: YamlValue,
): value is { readonly [key: string]: YamlValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function emitArray(items: readonly YamlValue[], level: number): string[] {
  if (items.length === 0) {
    return [`${pad(level)}[]`];
  }
  const lines: string[] = [];
  for (const item of items) {
    const inner = emitValue(item, level + 1);
    const first = inner[0] ?? `${pad(level + 1)}`;
    lines.push(`${pad(level)}- ${first.slice(pad(level + 1).length)}`);
    lines.push(...inner.slice(1));
  }
  return lines;
}

function emitObject(
  entries: { readonly [key: string]: YamlValue },
  level: number,
): string[] {
  const keys = Object.keys(entries);
  if (keys.length === 0) {
    return [`${pad(level)}{}`];
  }
  const lines: string[] = [];
  for (const key of keys) {
    if (!KEY_PATTERN.test(key)) {
      throw new RangeError(`yaml key is not a plain identifier: ${key}`);
    }
    const value = entries[key];
    if (value === undefined) {
      continue;
    }
    if (isScalar(value)) {
      lines.push(`${pad(level)}${key}: ${emitScalar(value)}`);
      continue;
    }
    if (Array.isArray(value) && value.length === 0) {
      lines.push(`${pad(level)}${key}: []`);
      continue;
    }
    if (isPlainObject(value) && Object.keys(value).length === 0) {
      lines.push(`${pad(level)}${key}: {}`);
      continue;
    }
    lines.push(`${pad(level)}${key}:`);
    lines.push(...emitValue(value, level + 1));
  }
  return lines;
}

function emitValue(value: YamlValue, level: number): string[] {
  if (isScalar(value)) {
    return [`${pad(level)}${emitScalar(value)}`];
  }
  if (Array.isArray(value)) {
    return emitArray(value, level);
  }
  if (isPlainObject(value)) {
    return emitObject(value, level);
  }
  throw new TypeError("unsupported YAML value");
}

export function toYaml(document: YamlDocument): string {
  return `${emitObject(document, 0).join("\n")}\n`;
}
