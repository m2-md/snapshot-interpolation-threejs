// src/hud.ts — labels are written in uppercase in source.
export const MEASURED_LABELS = [
  "SNAPSHOTS RECEIVED",
  "DROPPED",
  "OUT OF ORDER",
  "BUFFER SIZE",
  "MIN BUFFER SIZE",
  "STARVED FRAMES",
  "STARVED RATIO",
  "LONGEST STARVE",
  "CURRENT ALPHA",
] as const;

export const MODEL_LABELS = [
  "SNAPSHOT RATE",
  "INTERPOLATION DELAY",
  "RECOMMENDED DELAY",
  "LATENCY",
  "JITTER",
  "LOSS RATE",
] as const;

export type MeasuredLabel = (typeof MEASURED_LABELS)[number];
export type ModelLabel = (typeof MODEL_LABELS)[number];

/**
 * Two-block diagnostic panel.
 *
 * MEASURED = actual counted values for this run (transport counters, buffer
 * size, starvation statistics, final alpha).
 * MODEL    = structural settings from sliders; not measurements.
 *
 * The separation is not cosmetic: if a measured count and a model constant
 * were shown side-by-side in the same list, the reader could mistake both for measurements.
 */
export class Hud {
  private readonly cells = new Map<string, HTMLElement>();

  constructor(root: HTMLElement) {
    root.appendChild(this.block("MEASURED", "measured", MEASURED_LABELS));
    root.appendChild(this.block("MODEL", "settings", MODEL_LABELS));
  }

  private block(title: string, subtitle: string, labels: readonly string[]): HTMLElement {
    const section = document.createElement("section");
    section.className = `hud-block hud-${title.toLowerCase()}`;

    const heading = document.createElement("h2");
    heading.textContent = title;
    const note = document.createElement("span");
    note.className = "hud-note";
    note.textContent = subtitle;
    heading.appendChild(note);
    section.appendChild(heading);

    for (const label of labels) {
      const row = document.createElement("div");
      row.className = "hud-row";

      const key = document.createElement("span");
      key.className = "hud-key";
      key.textContent = label;

      const value = document.createElement("span");
      value.className = "hud-value";
      value.textContent = "—";

      row.appendChild(key);
      row.appendChild(value);
      section.appendChild(row);
      this.cells.set(label, value);
    }
    return section;
  }

  set(label: MeasuredLabel | ModelLabel, value: string): void {
    const cell = this.cells.get(label);
    if (cell) cell.textContent = value;
  }
}
