import { describe, it, expect } from "vitest";
import mbCsvHeaderLines from "../src/mb-csv-header-lines.json";
import {
  findCanonicalHeaderLineInText,
  normalizeCsvHeaderLine,
  maybePrependCsvHeader,
} from "../src/index.js";

async function gzipText(text) {
  const uint8 = new TextEncoder().encode(text);
  const cs = new CompressionStream("gzip");
  const stream = new Blob([uint8]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzipText(u8) {
  const ds = new DecompressionStream("gzip");
  const stream = new Blob([u8]).stream().pipeThrough(ds);
  return await new Response(stream).text();
}

describe("normalizeCsvHeaderLine", () => {
  it("trims cells and strips BOM", () => {
    expect(normalizeCsvHeaderLine("\uFEFFtime(UTC)\terror\t")).toBe("time(UTC)\terror");
    expect(normalizeCsvHeaderLine("  a  \t  b  ")).toBe("a\tb");
  });
});

describe("findCanonicalHeaderLineInText", () => {
  const canonical = mbCsvHeaderLines["001"];

  it("finds match on first line", () => {
    expect(findCanonicalHeaderLineInText(`${canonical}\ndata`, canonical)).toBe(0);
  });

  it("finds match after a junk first line", () => {
    const text = `# comment\n${canonical}\n2025-01-01\t0\t0`;
    expect(findCanonicalHeaderLineInText(text, canonical)).toBe(1);
  });

  it("returns null when header is missing", () => {
    expect(findCanonicalHeaderLineInText("only\tdata\nrows", canonical)).toBe(null);
  });

  it("treats normalized tabs as equal to canonical", () => {
    const spaced = canonical.split("\t").map((c) => ` ${c} `).join("\t");
    expect(findCanonicalHeaderLineInText(spaced, canonical)).toBe(0);
  });
});

describe("maybePrependCsvHeader", () => {
  const canonical = mbCsvHeaderLines["001"];

  it("sets csv_header_matched when gzip already contains canonical header", async () => {
    const inner = `${canonical}\n2025-01-01T00:00:00\t0\t0`;
    const gz = await gzipText(inner);
    const out = await maybePrependCsvHeader(gz, "device-mb-001-foo.log.gz", mbCsvHeaderLines, {});
    expect(out.meta.csv_header_matched).toBe("true");
    expect(out.meta.csv_header_prepended).toBeUndefined();
    expect(out.bytes).toEqual(gz);
  });

  it("prepends canonical header when body has only data rows", async () => {
    const inner = "2025-01-01T00:00:00\t0\t0\t1";
    const gz = await gzipText(inner);
    const out = await maybePrependCsvHeader(gz, "mb-001.log.gz", mbCsvHeaderLines, {});
    expect(out.meta.csv_header_prepended).toBe("true");
    expect(out.meta.csv_header_matched).toBeUndefined();
    const roundTrip = await gunzipText(out.bytes);
    expect(roundTrip.startsWith("time(UTC)\t")).toBe(true);
    expect(roundTrip).toContain(inner);
  });

  it("does nothing when filename has no mb code", async () => {
    const gz = await gzipText("plain");
    const out = await maybePrependCsvHeader(gz, "unknown.log.gz", mbCsvHeaderLines, {});
    expect(out.meta).toEqual({});
    expect(out.bytes).toEqual(gz);
  });

  it("uses DEFAULT_CSV_HEADER_MB when filename has no mb pattern", async () => {
    const inner = "2025-01-01T00:00:00\t0\t0";
    const gz = await gzipText(inner);
    const out = await maybePrependCsvHeader(gz, "acq_123.log.gz", mbCsvHeaderLines, {
      DEFAULT_CSV_HEADER_MB: "1",
    });
    expect(out.meta.csv_header_prepended).toBe("true");
    expect(out.meta.csv_header_mb).toBe("001");
    const roundTrip = await gunzipText(out.bytes);
    expect(roundTrip.startsWith("time(UTC)\t")).toBe(true);
  });
});
