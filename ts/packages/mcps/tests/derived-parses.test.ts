/**
 * Homes slice 9 falsifier (ADR 0037 rule 6, JOURNEYS J2, end-gate targets 5 and 13): a parse is
 * stored once in the project home and a second person finds it by hash.
 *
 * Mutant that turns the first test red: in `src/shared/read-document.ts` replace
 * `readDerivedJson(store, key, parsedPagesSchema)` with `null` (person B then parses again, and a
 * hosted read holds again). Mutant for the second: in `host-contracts/src/store.ts` `readDerived`,
 * replace `name === derivedName(key, bytes)` with `true` (the forged file is then served).
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { readStoredNotices, storedNoticesFile } from "@pe/host-contracts/store";
import { withInvocationContext } from "@pe/runtime/context";
import { runtimeRoot } from "@pe/runtime/runtime-owner";
import { sendHeldParse, sha256Of } from "../src/shared/held-parse.ts";
import { runReadDocument } from "../src/shared/read-document.ts";

const parses = vi.hoisted(() => ({ count: 0 }));
vi.mock("@llamaindex/liteparse", async (importOriginal) => {
  const original = await importOriginal<typeof import("@llamaindex/liteparse")>();
  return {
    ...original,
    LiteParse: class extends original.LiteParse {
      override parse(...args: Parameters<InstanceType<typeof original.LiteParse>["parse"]>) {
        parses.count++;
        return super.parse(...args);
      }
    },
  };
});

function onePagePdf(line: string): Buffer {
  const content = `BT /F1 14 Tf 72 700 Td (${line}) Tj ET`;
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

let dir: string;
let derived: string;
let file: string;
/** A person is a user home; under the override the machine state root sits in its `.local-state`. */
const become = (person: "a" | "b") => vi.stubEnv("PE_TOOLS_PRODUCT_HOME", join(dir, person));
const read = (input: Parameters<typeof runReadDocument>[0]) =>
  withInvocationContext({ hostBaseUrl: "http://host.test" }, () => runReadDocument(input));
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
/** End-gate target 5: the files in a derived folder whose name does not match their bytes. */
const mismatched = (folder: string) =>
  readdirSync(folder).filter((name) => !/^[0-9a-f]{64}\.[0-9a-f]{64}$/.test(name) || name.split(".")[1] !== sha(readFileSync(join(folder, name))));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "derived-parses-"));
  const home = join(dir, "Project X", "Pe.Tools");
  mkdirSync(join(dir, "Project X", "Submittals"), { recursive: true });
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, "pe-home.json"), JSON.stringify({ tier: "project" }));
  derived = join(home, "Derived");
  file = join(dir, "Project X", "Submittals", "muas-1.pdf");
  writeFileSync(file, onePagePdf("MUAS-1 EXTERNAL STATIC 1.25 IN WG"));
  parses.count = 0;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
});

test("person A parses a document once; person B, same project home, parses nothing and a hosted hit never reaches the held-send door", async () => {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: Request | string | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : null;
      const url = new URL(request ? request.url : String(input));
      const method = init?.method ?? request?.method ?? "GET";
      calls.push(`${method} ${url.pathname}`);
      if (url.pathname === "/pe/outward/held") {
        const body = JSON.parse(String(init?.body ?? (await request?.text())));
        return Response.json({ held: { ...body, id: "h1", at: "2026-11-12T00:00:00.000Z", thread: "t1" }, message: "Held" });
      }
      if (method === "POST") return Response.json({ id: "job-1", project_id: "p", status: "PENDING" });
      return Response.json({
        job: { id: "job-1", project_id: "p", status: "COMPLETED" },
        markdown: { pages: [{ page_number: 1, success: true, markdown: "HOSTED 1.25 IN WG" }] },
      });
    }),
  );
  vi.stubEnv("LLAMA_CLOUD_API_KEY", "llx-test");
  const holds = () => calls.filter((call) => call === "POST /pe/outward/held").length;
  const uploads = () => calls.filter((call) => call.startsWith("POST /api/")).length;

  become("a");
  const rootA = runtimeRoot();
  const first = await read({ path: file, pages: "1" });
  expect(first.text).toContain("1.25 IN WG");
  expect(parses.count).toBe(1);
  // Re-parsing per call is gone for the same person too.
  await read({ path: file, pages: "1" });
  expect(parses.count).toBe(1);
  // A's hosted read is held; A's Confirm uploads once.
  expect((await read({ path: file, pages: "1", parser: "llamaparse" })).text).toMatch(/^Held, not done/);
  const sha256 = sha256Of(readFileSync(file));
  await sendHeldParse({ path: file, sha256, pages: "1" });
  expect([holds(), uploads()]).toEqual([1, 1]);

  become("b");
  expect(runtimeRoot()).not.toBe(rootA);
  const second = await read({ path: file, pages: "1" });
  expect(second.text).toBe(first.text);
  expect(parses.count).toBe(1);
  const hosted = await read({ path: file, pages: "1", parser: "llamaparse" });
  expect(hosted.text).toContain("--- page 1 ---\nHOSTED 1.25 IN WG");
  // The held-send door is never reached on a hit, and a stale Confirm of the same bytes sends nothing.
  await sendHeldParse({ path: file, sha256, pages: "1" });
  expect([holds(), uploads()]).toEqual([1, 1]);

  // Both parses sit in the project home, each named by its key and its own bytes; no person's root holds one.
  expect(readdirSync(derived)).toHaveLength(2);
  expect(mismatched(derived)).toEqual([]);
  for (const person of ["a", "b"])
    expect(existsSync(join(dir, person, ".local-state", "state", "Derived"))).toBe(false);
});

test("a derived file whose name does not match its bytes is refused and discarded with one notice", async () => {
  become("a");
  await read({ path: file, pages: "1" });
  const [name] = readdirSync(derived);
  const forged = JSON.stringify({ totalPages: 1, pages: [{ pageNum: 1, text: "FORGED 9.99 IN WG" }] });
  writeFileSync(join(derived, name!), forged);
  expect(mismatched(derived)).toEqual([name]);

  become("b");
  const again = await read({ path: file, pages: "1" });
  expect(again.text).not.toContain("FORGED");
  expect(again.text).toContain("1.25 IN WG");
  expect(parses.count).toBe(2);
  await read({ path: file, pages: "1" });
  expect(parses.count).toBe(2);
  const notices = readStoredNotices(storedNoticesFile(runtimeRoot()));
  expect(notices.map((n) => [n.class, n.path, n.sha256])).toEqual([["discard", join(derived, name!), sha(Buffer.from(forged))]]);
  expect(mismatched(derived)).toEqual([]);
});

test("with no project home the parse lands under the machine state root, never the user home or a temp folder", async () => {
  become("a");
  const loose = join(dir, "loose.pdf");
  writeFileSync(loose, onePagePdf("LOOSE SHEET"));
  await read({ path: loose, pages: "1" });
  await read({ path: loose, pages: "1" });
  expect(parses.count).toBe(1);
  const machine = join(runtimeRoot(), "state", "Derived");
  expect(machine.endsWith(join(".local-state", "state", "Derived"))).toBe(true);
  expect(mismatched(machine)).toEqual([]);
  expect(readdirSync(machine)).toHaveLength(1);
  // The user home holds its state root and nothing else; the project home holds no derived folder.
  expect(readdirSync(join(dir, "a"))).toEqual([".local-state"]);
  expect(existsSync(derived)).toBe(false);
  expect(machine.split(sep)).not.toContain("scratch");
});
