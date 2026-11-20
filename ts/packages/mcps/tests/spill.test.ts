import { mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { RESULT_CAP_CHARS, capResultText } from "../src/shared/spill.ts";
import { toContent } from "../src/server.ts";
import { peDo } from "../src/pea/capability-tools.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pe-spill-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

// The shape that broke a real turn: one script result whose `data` is 200 KB on one compact line.
const big = {
  ok: true,
  key: "op:scripting.execute",
  result: {
    response: {
      status: "Succeeded",
      data: { rows: Array.from({ length: 4000 }, (_, i) => ({ i, name: `Unit ${i}` })) },
    },
  },
};

test("a result under the cap is returned untouched and writes nothing", () => {
  const text = JSON.stringify({ ok: true });
  expect(capResultText("pe_do", { ok: true }, text, dir)).toBe(text);
  expect(readdirSync(dir)).toEqual([]);
});

test("a result over the cap becomes a pointer whose file is the whole result, one value per line", () => {
  const text = JSON.stringify(big);
  expect(text.length).toBeGreaterThan(RESULT_CAP_CHARS);
  const pointer = JSON.parse(capResultText("pe_do", big, text, dir));
  expect(JSON.stringify(pointer).length).toBeLessThan(RESULT_CAP_CHARS / 4);
  expect(pointer).toMatchObject({ spilled: true });
  const file = readFileSync(pointer.path, "utf8");
  expect(JSON.parse(file)).toEqual(big);
  expect(file.split("\n").length).toBe(pointer.lines);
  expect(pointer.lines).toBeGreaterThan(8000); // pretty, so Grep -n and Read offset/limit have lines to address
  expect(Math.max(...file.split("\n").map((line) => line.length))).toBeLessThan(200);
  expect(Buffer.byteLength(file)).toBe(pointer.bytes);
  expect(pointer.head.startsWith('{\n  "ok": true')).toBe(true);
  expect(pointer.head.length).toBeLessThanOrEqual(1_500);
});

test("a long multi-line text value inside the result is written one line per array element", () => {
  const output = Array.from({ length: 3000 }, (_, i) => `row ${i} padding padding padding`).join(
    "\n",
  );
  const result = { ok: true, result: { response: { status: "Succeeded", output } } };
  const pointer = JSON.parse(capResultText("pe_do", result, JSON.stringify(result), dir));
  const file = JSON.parse(readFileSync(pointer.path, "utf8"));
  expect(file.result.response.output).toEqual(output.split("\n"));
  expect(pointer.lines).toBeGreaterThan(3000);
});

test("a string result keeps its own lines in a .txt file", () => {
  const text = Array.from({ length: 3000 }, (_, i) => `line ${i}`).join("\n");
  const pointer = JSON.parse(capResultText("pe_read", text, text, dir));
  expect(pointer.path.endsWith(".txt")).toBe(true);
  expect(readFileSync(pointer.path, "utf8")).toBe(text);
  expect(pointer.lines).toBe(3000);
});

test("spilled files past three days are pruned by the next spill", () => {
  const old = join(dir, "pe_do-old.json");
  writeFileSync(old, "{}");
  const longAgo = new Date(Date.now() - 4 * 24 * 3_600_000);
  utimesSync(old, longAgo, longAgo);
  capResultText("pe_do", big, JSON.stringify(big), dir);
  expect(readdirSync(dir).includes("pe_do-old.json")).toBe(false);
});

test("an unwritable scratch leaves the result as it was", () => {
  const blocker = join(dir, "file");
  writeFileSync(blocker, "x");
  const text = JSON.stringify(big);
  expect(capResultText("pe_do", big, text, join(blocker, "nested"))).toBe(text);
});

test("the MCP server answers an oversize pe_do result with the pointer, under the product scratch folder", () => {
  vi.stubEnv("PE_TOOLS_PRODUCT_HOME", dir);
  try {
    const content = toContent(peDo, big).content;
    const pointer = JSON.parse((content[0] as { text: string }).text);
    expect(pointer.spilled).toBe(true);
    expect(pointer.path.startsWith(join(dir, ".local-state", "scratch", "tool-output"))).toBe(true);
    expect(JSON.parse(readFileSync(pointer.path, "utf8"))).toEqual(big);
  } finally {
    vi.unstubAllEnvs();
  }
});
