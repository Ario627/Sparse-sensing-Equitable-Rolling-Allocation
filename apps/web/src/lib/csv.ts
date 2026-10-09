const QUOTE = '"';
const CRLF = "\r\n";
const BOM = "\uFEFF";
const DEFAULT_DELIMITER = ";";
const DOWNLOAD_REVOKE_DELAY_MS = 1_000;

function needsQuoting(field: string, delimiter: string): boolean {
  return (
    field.includes(delimiter) ||
    field.includes(QUOTE) ||
    field.includes("\n") ||
    field.includes("\r")
  );
}

function escapeField(field: string, delimiter: string): string {
  if (!needsQuoting(field, delimiter)) {
    return field;
  }
  return `${QUOTE}${field.split(QUOTE).join(QUOTE + QUOTE)}${QUOTE}`;
}

export function toCsv(
  rows: readonly (readonly string[])[],
  delimiter: string = DEFAULT_DELIMITER,
): string {
  if (rows.length === 0) {
    return "";
  }
  const encoded = rows.map((row) =>
    row.map((field) => escapeField(field, delimiter)).join(delimiter),
  );
  return `${encoded.join(CRLF)}${CRLF}`;
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, DOWNLOAD_REVOKE_DELAY_MS);
}

export function downloadCsv(
  filename: string,
  rows: readonly (readonly string[])[],
  delimiter: string = DEFAULT_DELIMITER,
): void {
  const payload = `${BOM}${toCsv(rows, delimiter)}`;
  downloadBlob(filename, new Blob([payload], { type: "text/csv;charset=utf-8" }));
}

const CR = "\r";

export function parseCsv(
  text: string,
  delimiter: string = DEFAULT_DELIMITER,
): readonly (readonly string[])[] {
  const source = text.startsWith(BOM) ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === QUOTE) {
        if (source[index + 1] === QUOTE) {
          field += QUOTE;
          index += 1;
          continue;
        }
        quoted = false;
        continue;
      }
      field += char;
      continue;
    }
    if (char === QUOTE) {
      quoted = true;
      continue;
    }
    if (char === delimiter) {
      row.push(field);
      field = "";
      continue;
    }
    if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    if (char === CR) {
      continue;
    }
    field += char;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
