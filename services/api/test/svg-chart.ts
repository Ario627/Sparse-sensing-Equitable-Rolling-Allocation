/**
 * Pembuat chart SVG minimal tanpa dependensi tambahan.
 *
 * Dipakai test backend untuk menulis artefak chart. Hanya mendukung bar chart
 * horizontal berkelompok — cukup untuk menampilkan hasil pemrosesan data, dan
 * tidak menambah paket produksi apa pun ke services/api.
 */

export interface BarGroup {
  readonly label: string;
  readonly segments: readonly BarSegment[];
}

export interface BarSegment {
  readonly label: string;
  readonly value: number;
  readonly color: string;
}

export interface ChartOptions {
  readonly title: string;
  readonly subtitle?: string;
  readonly width?: number;
  readonly rowHeight?: number;
}

const FONT = "font-family=\"-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif\"";
const PADDING_LEFT = 190;
const PADDING_RIGHT = 110;
const PADDING_TOP = 64;
const PADDING_BOTTOM = 48;

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function legend(segments: readonly BarSegment[], width: number): string {
  const unique = new Map<string, string>();
  for (const segment of segments) {
    if (!unique.has(segment.label)) {
      unique.set(segment.label, segment.color);
    }
  }
  const items = [...unique.entries()];
  const itemWidth = 150;
  const totalWidth = items.length * itemWidth;
  const startX = Math.max(12, (width - totalWidth) / 2);
  return items
    .map(([label, color], index) => {
      const x = startX + index * itemWidth;
      return [
        `<rect x="${x}" y="34" width="12" height="12" rx="2" fill="${color}" />`,
        `<text x="${x + 18}" y="45" font-size="12" fill="#343a40" ${FONT}>${escapeXml(label)}</text>`,
      ].join("");
    })
    .join("");
}

export function renderStackedBarChart(
  groups: readonly BarGroup[],
  options: ChartOptions,
): string {
  const width = options.width ?? 860;
  const rowHeight = options.rowHeight ?? 46;
  const barHeight = 26;
  const plotWidth = width - PADDING_LEFT - PADDING_RIGHT;
  const height = PADDING_TOP + PADDING_BOTTOM + groups.length * rowHeight;
  const totals = groups.map((group) =>
    group.segments.reduce((sum, segment) => sum + segment.value, 0),
  );
  const maxTotal = Math.max(1, ...totals);
  const allSegments = groups.flatMap((group) => group.segments);

  const rows = groups
    .map((group, rowIndex) => {
      const y = PADDING_TOP + rowIndex * rowHeight;
      const total = totals[rowIndex] ?? 0;
      let offsetX = PADDING_LEFT;
      const bars = group.segments
        .map((segment) => {
          const barWidth = (segment.value / maxTotal) * plotWidth;
          const rect =
            barWidth <= 0
              ? ""
              : `<rect x="${offsetX.toFixed(2)}" y="${y}" width="${barWidth.toFixed(2)}" ` +
                `height="${barHeight}" fill="${segment.color}"><title>${escapeXml(
                  `${segment.label}: ${segment.value}`,
                )}</title></rect>`;
          offsetX += barWidth;
          return rect;
        })
        .join("");
      const totalText = `${total}`;
      return [
        `<text x="12" y="${y + barHeight / 2 + 4}" font-size="12" fill="#212529" ${FONT}>${escapeXml(
          group.label,
        )}</text>`,
        bars,
        `<text x="${(offsetX + 8).toFixed(2)}" y="${y + barHeight / 2 + 4}" font-size="12" fill="#495057" ${FONT}>${totalText}</text>`,
      ].join("");
    })
    .join("");

  const subtitle = options.subtitle
    ? `<text x="12" y="54" font-size="11" fill="#6c757d" ${FONT}>${escapeXml(options.subtitle)}</text>`
    : "";

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">`,
    `<rect width="${width}" height="${height}" fill="#ffffff" />`,
    `<text x="12" y="22" font-size="16" font-weight="600" fill="#212529" ${FONT}>${escapeXml(
      options.title,
    )}</text>`,
    subtitle,
    legend(allSegments, width),
    `<line x1="${PADDING_LEFT}" y1="${PADDING_TOP - 8}" x2="${PADDING_LEFT}" y2="${height - PADDING_BOTTOM + 8}" stroke="#dee2e6" />`,
    rows,
    "</svg>",
  ].join("\n");
}
