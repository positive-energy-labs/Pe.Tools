import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { crc32, deflateRawSync } from "node:zlib";
import { PNG } from "pngjs";
import http from "node:http";
import https from "node:https";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { withInvocationContext } from "@pe/runtime/context";
import { sendHeldParse, sha256Of } from "../src/shared/held-parse.ts";
import { runReadDocument } from "../src/shared/read-document.ts";

const liteParseOptions = vi.hoisted(() => [] as Array<{ ocrEnabled?: boolean }>);
vi.mock("@llamaindex/liteparse", async (importOriginal) => {
  const original = await importOriginal<typeof import("@llamaindex/liteparse")>();
  return {
    ...original,
    LiteParse: class extends original.LiteParse {
      constructor(options: ConstructorParameters<typeof original.LiteParse>[0]) {
        super(options);
        liteParseOptions.push(options ?? {});
      }
    },
  };
});

/** One 612x792 page with a schedule row near the top and a footer note near the bottom, offsets exact. */
function schedulePdf(withText = true): Buffer {
  const content = withText
    ? [
        "BT /F1 14 Tf 72 700 Td (TAG AHU-1 SUPPLY 6000 CFM) Tj ET",
        "BT /F1 14 Tf 72 90 Td (NOTE FOOTER-ONLY-TEXT) Tj ET",
      ].join("\n")
    : "0 0 100 100 re f";
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

test("read_document returns text and renders with network requests blocked, and a crop narrows both", async () => {
  const blocked = vi.fn(() => {
    throw new Error("Local parser attempted a network request");
  });
  vi.stubGlobal("fetch", blocked);
  const requests = ["get", "request"] as const;
  for (const module of [http, https])
    for (const method of requests) vi.spyOn(module, method).mockImplementation(blocked);
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
    expect(whole.warnings).toBeUndefined();
    for (const options of liteParseOptions) expect(options.ocrEnabled).toBe(false);
    expect(liteParseOptions.length).toBeGreaterThan(0);
    expect(blocked).not.toHaveBeenCalled();
  } finally {
    // The renders live in the tool's product scratch folder, outside `dir`.
    for (const folder of scratch) rmSync(folder, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a page without a text layer reports a typed warning and still renders locally", async () => {
  const dir = mkdtempSync(join(tmpdir(), "read-document-no-text-"));
  let scratch: string | undefined;
  const blocked = vi.fn(() => {
    throw new Error("Unexpected network request");
  });
  vi.stubGlobal("fetch", blocked);
  try {
    const file = join(dir, "scan.pdf");
    writeFileSync(file, schedulePdf(false));
    const result = await runReadDocument({ path: file, pages: "1", image: true });
    scratch = dirname(result.images[0]!.path);
    expect(result.warnings).toEqual([{ code: "no-text-layer", page: 1 }]);
    expect(result.text).toContain("No text layer was extracted");
    expect(result.text).toContain("Local OCR is disabled");
    expect(result.images).toHaveLength(1);
    expect(blocked).not.toHaveBeenCalled();
  } finally {
    if (scratch) rmSync(scratch, { recursive: true, force: true });
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

/** A zip with one deflated entry per file, enough for the Office parts these tests need. */
function zip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = deflateRawSync(Buffer.from(text));
    const n = Buffer.from(name);
    const crc = crc32(text);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(text.length, 22);
    local.writeUInt16LE(n.length, 26);
    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0);
    head.writeUInt16LE(8, 10);
    head.writeUInt32LE(crc, 16);
    head.writeUInt32LE(data.length, 20);
    head.writeUInt32LE(text.length, 24);
    head.writeUInt16LE(n.length, 28);
    head.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([head, n]));
    locals.push(local, n, data);
    offset += 30 + n.length + data.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(central.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

test("read_document reads an xlsx and a docx from their XML, with cell refs and review comments", async () => {
  const dir = mkdtempSync(join(tmpdir(), "read-document-test-"));
  try {
    const xlsx = join(dir, "schedule.xlsx");
    writeFileSync(
      xlsx,
      zip({
        "xl/workbook.xml":
          '<workbook><sheets><sheet name="ERV &amp; FCU" sheetId="1" r:id="rId1"/></sheets></workbook>',
        "xl/_rels/workbook.xml.rels":
          '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
        "xl/sharedStrings.xml":
          "<sst><si><t>Tag</t></si><si><r><t>ERV</t></r><r><t>-1</t></r></si></sst>",
        "xl/worksheets/sheet1.xml":
          '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>CFM</t></is></c></row><row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>1200</v></c><c r="C2" s="1"/></row></sheetData></worksheet>',
      }),
    );
    const sheet = (await runReadDocument({ path: xlsx })).text;
    expect(sheet).toContain('--- sheet "ERV & FCU" ---');
    expect(sheet).toContain("A1=Tag | B1=CFM");
    expect(sheet).toContain("A2=ERV-1 | B2=1200");

    const docx = join(dir, "notes.docx");
    writeFileSync(
      docx,
      zip({
        "word/document.xml":
          '<w:document><w:body><w:p><w:r><w:t>Fresh air </w:t></w:r><w:commentRangeStart w:id="0"/><w:r><w:t>taps the return</w:t></w:r><w:commentRangeEnd w:id="0"/></w:p><w:p/><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Unit</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>ERV-1</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>',
        "word/comments.xml":
          '<w:comments><w:comment w:id="0" w:author="Hap" w:date="2026-11-03"><w:p><w:r><w:t>Tapping into the return air</w:t></w:r></w:p></w:comment></w:comments>',
      }),
    );
    const doc = (await runReadDocument({ path: docx })).text;
    expect(doc).toContain("Fresh air taps the return");
    expect(doc).toContain("Unit | ERV-1");
    expect(doc).toContain(
      '[comment 0] Hap 2026-11-03 on "taps the return": Tapping into the return air',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

test("a failed Confirm uploads once and surfaces the error; a later Confirm can retry", async () => {
  const dir = mkdtempSync(join(tmpdir(), "held-upload-failure-"));
  try {
    const path = join(dir, "schedule.pdf");
    const bytes = schedulePdf();
    writeFileSync(path, bytes);
    vi.stubEnv("LLAMA_CLOUD_API_KEY", "fixture-key");
    let uploads = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: Request | string | URL) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        if (url.pathname !== "/api/v2/parse/upload")
          throw Error("Unexpected polling after failed upload");
        uploads++;
        return Response.json({ detail: "Upload failed" }, { status: 500 });
      }),
    );
    const request = { path, sha256: sha256Of(bytes), pages: "1" };
    await expect(sendHeldParse(request)).rejects.toThrow(/500/);
    expect(uploads).toBe(1);
    await expect(sendHeldParse(request)).rejects.toThrow(/500/);
    expect(uploads).toBe(2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Guard 3 (ADR 0038; homes MAP R2/R3): Pea's read never sends a file outward. Mutant that turns
// this red: in `src/shared/llama-parse.ts` replace `request.sender !== "person"` with `false`
// (the upload POST then appears on Pea's own call).
test("parser llamaparse is held at once for Pea and sends nothing; the person's confirm sends, and the next read finds the kept result", async () => {
  const dir = mkdtempSync(join(tmpdir(), "read-document-llama-"));
  try {
    const file = join(dir, "schedule.pdf");
    writeFileSync(file, schedulePdf());
    const secret = "llx-test-key-never-printed";
    const calls: string[] = [];
    const heldPosts: unknown[] = [];
    let sentKey = false;
    // Only the network is mocked: the host's hold door, and LlamaCloud's upload and poll routes.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: Request | string | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : null;
        const url = new URL(request ? request.url : String(input));
        const method = init?.method ?? request?.method ?? "GET";
        calls.push(`${method} ${url.pathname}${url.search}`);
        if (url.pathname === "/pe/outward/held") {
          const body = JSON.parse(String(init?.body ?? (await request?.text())));
          heldPosts.push(body);
          return Response.json({
            held: { ...body, id: "h1", at: "2026-11-11T00:00:00.000Z", thread: "t1" },
            message: "Held",
          });
        }
        if (method === "POST") {
          sentKey = new Headers(init?.headers).get("authorization") === `Bearer ${secret}`;
          return Response.json({ id: "job-1", project_id: "p", status: "PENDING" });
        }
        return Response.json({
          job: { id: "job-1", project_id: "p", status: "COMPLETED" },
          markdown: {
            pages: [{ page_number: 1, success: true, markdown: "TAG AHU-1 SUPPLY 6000 CFM" }],
          },
        });
      }),
    );
    // The kept result lands under this runtime's scratch root; keep it inside the test directory.
    vi.stubEnv("LOCALAPPDATA", dir);
    vi.stubEnv("LLAMA_CLOUD_API_KEY", secret);
    const uploads = () => calls.filter((call) => call.startsWith("POST /api/"));
    const read = (input: Parameters<typeof runReadDocument>[0]) =>
      withInvocationContext({ hostBaseUrl: "http://host.test" }, () => runReadDocument(input));

    await expect(
      read({ path: file, pages: "1", parser: "llamaparse", crop: { top: 0.5 } }),
    ).rejects.toThrow(/crop is not available/);

    // Pea's call: held in the tool result, one notice posted to the host, no byte sent, key unread.
    const heldRead = await read({ path: file, pages: "1", parser: "llamaparse" });
    expect(heldRead.text).toMatch(/^Held, not done/);
    expect(heldRead.text).not.toMatch(/refus|reject|declin|denied/i);
    expect(heldRead.text).not.toContain(secret);
    expect(heldRead.images).toEqual([]);
    const sha256 = sha256Of(schedulePdf());
    expect(heldPosts).toEqual([{ service: "llamaparse", path: file, sha256, pages: "1" }]);
    expect(uploads()).toEqual([]);
    expect(sentKey).toBe(false);

    // A file that changed since Pea asked is not sent on a stale confirm.
    await expect(sendHeldParse({ path: file, sha256: "0".repeat(64), pages: "1" })).rejects.toThrow(
      /changed since/,
    );
    expect(uploads()).toEqual([]);

    // The person's Confirm (the host runs this) sends the held bytes through the one upload path.
    await sendHeldParse({ path: file, sha256, pages: "1" });
    expect(uploads().some((call) => call.startsWith("POST /api/v2/parse/upload"))).toBe(true);
    expect(calls.some((call) => call.includes("expand=markdown"))).toBe(true);
    expect(sentKey).toBe(true);
    const sent = uploads().length;

    // Pea's next read of the same bytes and pages finds the kept result and sends nothing again.
    const lite = await read({ path: file, pages: "1" });
    const llama = await read({ path: file, pages: "1", parser: "llamaparse" });
    expect(uploads()).toHaveLength(sent);
    // Same page block shape, so two runs diff line for line.
    expect(llama.text).toContain("--- page 1 ---\nTAG AHU-1 SUPPLY 6000 CFM");
    expect(lite.text).toContain("--- page 1 ---");
    expect(llama.text).toContain("parsed by LlamaParse (agentic_plus, markdown)");
    expect(llama.text).not.toContain(secret);
    expect(llama.images).toEqual([]);
    // Other pages of the same file were never confirmed: held again.
    expect((await read({ path: file, pages: "2", parser: "llamaparse" })).text).toMatch(
      /^Held, not done/,
    );
    expect(uploads()).toHaveLength(sent);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
