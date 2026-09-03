import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith(".ts")) out.push(full);
  }
  return out;
}

/** Yorumları at: "Math.random() yasak" yazan bir açıklama ihlal değildir. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

describe("determinizm sözleşmesi", () => {
  it("src/ ve scripts/ altında Math.random( geçmiyor", () => {
    const files = [...walk(join(root, "src")), ...walk(join(root, "scripts"))];
    expect(files.length).toBeGreaterThan(5);

    const offenders = files.filter((f) =>
      stripComments(readFileSync(f, "utf8")).includes("Math.random("),
    );
    expect(offenders).toEqual([]);
  });
});
