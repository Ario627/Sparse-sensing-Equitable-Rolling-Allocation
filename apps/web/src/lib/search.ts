export function readSearchString(search: unknown, key: string): string | null {
  if (typeof search !== "object" || search === null) {
    return null;
  }
  for (const [entryKey, value] of Object.entries(search)) {
    if (entryKey === key && typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return null;
}

export function buildSearch(
  entries: Readonly<Record<string, string | null>>,
): Record<string, string> {
  const search: Record<string, string> = {};
  for (const [key, value] of Object.entries(entries)) {
    if (value !== null && value.length > 0) {
      search[key] = value;
    }
  }
  return search;
}

export function asSearchRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}
