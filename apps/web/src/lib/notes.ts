const MAX_NOTES = 6;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function readReasonNotes(value: unknown): readonly string[] {
  if (Array.isArray(value)) {
    return value.filter(isNonEmptyString).slice(0, MAX_NOTES);
  }
  if (typeof value === "object" && value !== null) {
    const notes: string[] = [];
    for (const [key, entry] of Object.entries(value)) {
      if (isNonEmptyString(entry)) {
        notes.push(`${key}: ${entry}`);
      }
    }
    return notes.slice(0, MAX_NOTES);
  }
  return [];
}
