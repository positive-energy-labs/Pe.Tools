import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PNG } from "pngjs";
import { expect, test } from "vite-plus/test";
import { runReadDocument } from "../src/shared/read-document.ts";

/** One 612x792 page with a schedule row near the top and a footer note near the bottom, offsets exact. */
function schedulePdf(): Buffer {
  const content = [
    "BT /F1 14 Tf 72 700 Td (TAG AHU-1 SUPPLY 6000 CFM) Tj ET",
    "BT /F1 14 Tf 72 90 Td (NOTE FOOTER-ONLY-TEXT) Tj ET",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((body, index) => {
    const at = pdf.length;
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const at of offsets) pdf += `${String(at).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

test("read_document returns located text and a page render, and a crop narrows both", async () => {
  const dir = mkdtempSync(join(tmpdir(), "read-document-test-"));
  const scratch = new Set<string>();
  try {
    const file = join(dir, "schedule.pdf");
    writeFileSync(file, schedulePdf());

    const whole = await runReadDocument({ path: file, pages: "1", image: true });
    expect(whole.text).toContain("1 page(s) in the document");
    expect(whole.text).toContain("6000 CFM");
    expect(whole.text).toContain("FOOTER-ONLY-TEXT");
    scratch.add(dirname(whole.images[0]!.path));
    const fullPng = PNG.sync.read(Buffer.from(whole.images[0]!.data, "base64"));
    expect(fullPng.height).toBeGreaterThan(fullPng.width);

    // Keep only the band that holds the footer: the schedule row leaves both the text and the render.
    const cropped = await runReadDocument({
      path: file,
      pages: "1",
      image: true,
      crop: { top: 0.8 },
    });
    scratch.add(dirname(cropped.images[0]!.path));
    expect(cropped.text).toContain("FOOTER-ONLY-TEXT");
    expect(cropped.text).not.toContain("AHU-1");
    const cropPng = PNG.sync.read(Buffer.from(cropped.images[0]!.data, "base64"));
    // 200 dpi vs 150 dpi: compare the aspect, which only the crop changes.
    expect(cropPng.width / cropPng.height).toBeGreaterThan(fullPng.width / fullPng.height);
    expect(cropped.images[0]!.path).toContain("read-document");
    expect(cropped.images[0]!.path).not.toContain(dir);
  } finally {
    // The renders live in the tool's product scratch folder, outside `dir`.
    for (const folder of scratch) rmSync(folder, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

test("read_document refuses a missing file and an unsupported one with a clear message", async () => {
  const dir = mkdtempSync(join(tmpdir(), "read-document-test-"));
  try {
    await expect(runReadDocument({ path: join(dir, "absent.pdf") })).rejects.toThrow(
      /read_document: not a file/,
    );
    const odd = join(dir, "notes.bin");
    writeFileSync(odd, "x");
    await expect(runReadDocument({ path: odd })).rejects.toThrow(/read_document: .*unsupported/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
