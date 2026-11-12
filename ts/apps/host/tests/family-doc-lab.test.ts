// @vitest-environment node
/*
 * The /family doc-lab chain (routes MAP row 10, "/family acceptance") through the real action doors:
 * capture, save, attach, a cited value staged by Pea. Substituted: the native socket (it answers
 * `family.capture` with the a-box fixture, padded to a field family's size) and the PDF parser (the
 * in-process LlamaCloud parser). Work, the journal, consent, Pod files and the PDF bytes are real.
 */
import { afterEach, expect, test, vi } from "vite-plus/test";
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { appendFile, copyFile, mkdir, mkdtemp, readFile, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { address, bindWork, familyDraftRouteState, type Caller } from "@pe/agent-contracts";
import * as actionClient from "../../../packages/mcps/src/shared/takeoff-action-client.ts";
import { nativeFixture } from "./fans-work-fixture.ts";
import { heldSends, releaseSend } from "../src/guards.ts";
import { noticeRows } from "../src/notice-feed.ts";
import { actAs } from "./callers.ts";
import { familySpecAsset } from "../src/family-spec.ts";

const pdf = fileURLToPath(new URL("../../web/public/acme-fcu400-submittal.pdf", import.meta.url));
const aBox = JSON.parse(
  readFileSync(
    new URL("../../../../dotnet/Pe.Revit.Tests/Fixtures/FamilyModel/a-box.json", import.meta.url),
    "utf8",
  ),
);
// A field capture (HCB) answers about 300 KB; the unmodeled facts are most of it.
const modelJson = JSON.stringify({
  ...aBox,
  unmodeled: [{ kind: "PlaneNotNamed", bulk: "x".repeat(300_000) }],
});
const block = { id: "p4-b2", page: 4, kind: "table", md: "| Nominal Airflow | 1200 CFM |", bboxes: [] };
const familyAddress = address("C:/PE Box.rfa");
const host = { kind: "host" } as const;
const pdfSize = readFileSync(pdf).length;

const closes: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const send of heldSends()) releaseSend(send.id);
  for (const close of closes.splice(0).reverse()) await close();
});

async function lab(beforeParse?: () => Promise<void>) {
  const pods = await mkdtemp(join(tmpdir(), "pe-doc-lab-"));
  closes.push(() => rm(pods, { recursive: true, force: true }));
  await mkdir(join(pods, "lab"), { recursive: true });
  await writeFile(join(pods, "lab", "pod.json"), JSON.stringify({ id: "lab" }));
  const parsed: { name: string; bytes: number }[] = [];
  const f = await nativeFixture("real", undefined, null, {
    state: {
      activeDocumentIsFamilyDocument: true,
      activeDocumentPath: "C:/PE Box.rfa",
      openDocuments: [
        {
          openId: "selected-open",
          title: "PE Box",
          address: familyAddress,
          isActive: true,
          isFamilyDocument: true,
          projectHome: null,
        },
      ],
    },
    deps: {
      podsRoot: pods,
      parsePdf: async (file) => {
        await beforeParse?.();
        const bytes = Buffer.from(await file.arrayBuffer());
        if (bytes.subarray(0, 5).toString() !== "%PDF-") throw Error("The parser was not handed a PDF");
        parsed.push({ name: file.name, bytes: bytes.length });
        return { jobId: "acme", fileName: file.name, pages: [], blocks: [block], images: [] };
      },
    },
    native: (key) =>
      key === "family.capture"
        ? {
            observedAt: "2026-11-11T00:00:00Z",
            familyName: "PE Box",
            modelJson,
            unmodeledCount: 1,
            coverage: {},
            issues: [],
            parameterUnits: {},
          }
        : undefined,
  });
  closes.push(() => f.close());
  const key = bindWork("family", familyAddress, undefined, f.target.ref);
  const started = await f.saved.start(key, {}, "human");
  if (!started.ok) throw Error(JSON.stringify(started));
  const run = { thread: "doc-lab", turn: "one" };
  f.runs.open(run);
  const pea: Caller = { kind: "pea", context: "fixture-minted", thread: run.thread, run, root: run };
  const handle = async () => ({ key, revision: (await f.saved.view(key, "family"))!.revision });
  const doc = async () =>
    familyDraftRouteState.schema.parse((await f.saved.view(key, "family"))!.doc);
  let n = 0;
  /** One action through `POST /actions`: its settled receipt, or the admission's refusal text. */
  const act = async (
    name: string,
    target: unknown,
    input: Record<string, unknown>,
    caller?: Caller,
  ): Promise<{ id?: string; state: string; error?: string | null; result?: unknown }> => {
    const id = `lab-${++n}`;
    const response = await f.post("/actions", { id, key: name, target, input }, caller);
    if (!response.ok) return { state: "refused", error: await response.text() };
    return f.journal.wait(id);
  };
  const stage = async (by: "human" | "pea", path: (string | number)[], value: unknown) => {
    const written = await f.saved.apply(key, "family", by, [{ path, value }], (await handle()).revision);
    if (!written.ok) throw Error(JSON.stringify(written));
  };
  /** Save the open family into the lab Pod, as the page's "Save family to pod" and Pea both do. */
  const save = async (by: "human" | "pea") => {
    await stage(by, ["writeIntent", "family.capture", "edit"], { value: { pod: "lab" } });
    const receipt = await act(
      "family.capture",
      f.target,
      { work: await handle() },
      by === "pea" ? pea : undefined,
    );
    expect(receipt.state, JSON.stringify(receipt).slice(0, 2000)).toBe("succeeded");
    return receipt as typeof receipt & {
      result: { member: { pod: string; path: string; sha256: string } };
    };
  };
  const outward = (id: string, caller: Caller = { kind: "human", via: "local" }) => actAs(caller, () =>
    f.api.fetch(new Request(`http://fixture/pe/outward/held/${id}/confirm`, { method: "POST" })));
  const confirm = async () => {
    const send = heldSends().find((send) => send.thread === run.thread);
    expect(send).toBeDefined();
    const response = await outward(send!.id);
    expect(response.status, await response.clone().text()).toBe(200);
    return f.journal.wait(`${(await f.journal.list()).find(row => row.key === "family.attach-spec" && row.refusal?.kind === "held")!.id}:confirmed`);
  };
  return { f, pods, pea, parsed, handle, doc, act, stage, save, confirm, outward };
}

test("blocker 3: a capture refused for its keys tells Pea where the input goes", async () => {
  const { f, pea, act, handle } = await lab();
  const refused = await act(
    "family.capture",
    f.target,
    { pod: "lab", path: "x.json", work: await handle() },
    pea,
  );
  expect(refused.state).toBe("refused");
  expect(refused.error).toContain("writeIntent");
  expect(refused.error).toContain("family.capture");
  expect(refused.error).toMatch(/pod/);
}, 60_000);

test("blocker 3: a saved capture answers a member handle Pea can relay", async () => {
  const { save } = await lab();
  const receipt = await save("pea");
  expect(receipt.result.member).toMatchObject({
    pod: "lab",
    sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  expect(JSON.stringify(receipt.result).length).toBeLessThan(4_000);
  // The journal keeps the native bytes; Pea is handed the result and the receipt's facts.
  expect(JSON.stringify(receipt).length).toBeGreaterThan(300_000);
  const relayed = (actionClient as { receiptForModel?: (row: unknown) => unknown }).receiptForModel?.(
    receipt,
  );
  expect(relayed, "the Pea relay bounds a receipt").toBeDefined();
  expect(JSON.stringify(relayed).length).toBeLessThan(16_000);
  expect(relayed).toMatchObject({
    id: receipt.id,
    state: "succeeded",
    result: { member: receipt.result.member },
  });
}, 60_000);

test("blocker 2: the page's own save is a member attach accepts", async () => {
  const { f, pods, save, act, handle } = await lab();
  const { member } = (await save("human")).result;
  expect(existsSync(join(pods, "lab", member.path))).toBe(true);
  const upload = await (
    await f.post("/actions/blobs", {
      fileName: "acme.pdf",
      base64: readFileSync(pdf).toString("base64"),
    })
  ).json();
  const attached = await act("family.attach-spec", host, {
    member: { pod: member.pod, path: member.path },
    source: upload,
    work: await handle(),
  });
  expect(attached.state, JSON.stringify(attached).slice(0, 2000)).toBe("succeeded");
  expect(heldSends()).toEqual([]);
}, 60_000);

test("blocker 1: attach takes a path and a URL as well as an upload", async () => {
  const { pods, parsed, act, handle, doc } = await lab();
  // A member where attach has always looked, so this test is red for the source alone.
  const member = { pod: "lab", path: "settings/family/box.json" };
  await mkdir(join(pods, "lab", "settings/family"), { recursive: true });
  await writeFile(join(pods, "lab", member.path), JSON.stringify(aBox));
  const byPath = await act("family.attach-spec", host, {
    member,
    source: { path: pdf },
    work: await handle(),
  });
  expect(byPath.state, JSON.stringify(byPath).slice(0, 2000)).toBe("succeeded");
  expect(parsed).toEqual([{ name: "acme-fcu400-submittal.pdf", bytes: pdfSize }]);
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/pdf" });
    response.end(readFileSync(pdf));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  closes.push(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/sheets/acme-by-url.pdf`;
  const byUrl = await act("family.attach-spec", host, {
    member,
    source: { url },
    work: await handle(),
  });
  expect(byUrl.state, JSON.stringify(byUrl).slice(0, 2000)).toBe("succeeded");
  expect(parsed[1]).toEqual({ name: "acme-by-url.pdf", bytes: pdfSize });
  expect((await doc()).spec).toMatchObject({ member, doc: { blocks: [block] } });
  // The original PDF is a portable member asset beside the family.
  const sidecar = JSON.parse(
    await readFile(join(pods, "lab", `${member.path}.spec.json`), "utf8"),
  ) as { path: string };
  const folder = join(pods, "lab", sidecar.path.replace(/\.json$/, ""));
  expect((await readFile(join(folder, "source.pdf"))).length).toBe(pdfSize);
}, 60_000);

test("an attach refusal names what to do, without the repo's source", async () => {
  const { pods, act, handle } = await lab();
  await mkdir(join(pods, "lab", "captures"), { recursive: true });
  await writeFile(
    join(pods, "lab", "captures", "old.json"),
    JSON.stringify({ family: { name: "Old" } }),
  );
  const elsewhere = await act("family.attach-spec", host, {
    member: { pod: "lab", path: "captures/old.json" },
    source: { path: pdf },
    work: await handle(),
  });
  expect(elsewhere.state).not.toBe("succeeded");
  expect(JSON.stringify(elsewhere)).toMatch(/settings\/family\//);
  expect(JSON.stringify(elsewhere)).toMatch(/family\.capture/);
  const missing = await act("family.attach-spec", host, {
    member: { pod: "lab", path: "settings/family/none.json" },
    source: { path: pdf },
    work: await handle(),
  });
  expect(missing.state).not.toBe("succeeded");
  expect(JSON.stringify(missing)).toMatch(/family\.capture/);
}, 60_000);

test("the chain: Pea captures and saves a family, attaches its sheet by path, and stages a cited value on a cell", async () => {
  const { f, pods, pea, save, act, stage, handle, doc, confirm } = await lab();
  const { member: saved } = (await save("pea")).result;
  const member = { pod: saved.pod, path: saved.path };
  expect(JSON.parse(await readFile(join(pods, "lab", member.path), "utf8"))).toMatchObject({
    family: { name: "PE Box" },
  });
  const attached = await act(
    "family.attach-spec",
    host,
    { member, source: { path: pdf }, work: await handle() },
    pea,
  );
  expect(attached.error).toContain("Held, not done");
  const confirmed = await confirm();
  expect(confirmed.state).toBe("succeeded");
  expect("result" in confirmed && confirmed.result).toMatchObject({ member, blocks: 1 });
  const cell = "/parameters/Width/value";
  await stage("pea", ["cells", cell, "edit"], {
    value: "30in",
    sources: [{ blockId: block.id, rowIdx: 0, colIdx: 1 }],
  });
  const work = await doc();
  expect(work.cells[cell]?.edit).toMatchObject({
    value: "30in",
    by: "pea",
    sources: [{ blockId: block.id }],
  });
  // The citation resolves in the sheet attached to this same Work: a real region, not a free string.
  expect(work.spec?.doc.blocks.map((b) => b.id)).toContain(
    work.cells[cell]!.edit!.sources![0]!.blockId,
  );
  expect(work.spec?.member).toEqual(member);
  expect(f.dispatched.map((call) => call.key)).toEqual(["family.capture"]);
}, 60_000);

/** A member where attach looks, so each narrowing test is red for its source alone. */
async function boxed(beforeParse?: () => Promise<void>) {
  const l = await lab(beforeParse);
  const member = { pod: "lab", path: "settings/family/box.json" };
  await mkdir(join(l.pods, "lab", "settings/family"), { recursive: true });
  await writeFile(join(l.pods, "lab", member.path), JSON.stringify(aBox));
  const attach = async (source: unknown, caller?: Caller) =>
    JSON.stringify(
      await l.act("family.attach-spec", host, { member, source, work: await l.handle() }, caller),
    );
  const serve = async (handler: Parameters<typeof createServer>[1]) => {
    const server = createServer(handler);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    closes.push(
      () =>
        new Promise((resolve) => {
          server.closeAllConnections();
          server.close(resolve);
        }),
    );
    return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  };
  return { ...l, member, attach, serve };
}

test("narrow 1: a path source is an absolute local regular PDF under the cap", async () => {
  const { pods, attach, parsed } = await boxed();
  // The refusal's own sentence: the unreadable-file refusal also says "absolute path", and passed for it.
  expect(await attach({ path: "sheets/acme.pdf" })).toMatch(/'sheets\/acme\.pdf' is not an absolute path/);
  // A relative path that does resolve, against the host's working directory, is refused the same.
  expect(await attach({ path: "package.json" })).toMatch(/'package\.json' is not an absolute path/);
  expect(await attach({ path: "\\\\server\\share\\acme.pdf" })).toMatch(/network or device path/);
  expect(await attach({ path: "\\\\?\\C:\\acme.pdf" })).toMatch(/network or device path/);
  expect(await attach({ path: pods })).toMatch(/not a regular file/);
  const big = join(pods, "big.pdf");
  await writeFile(big, "%PDF-");
  await truncate(big, 64 * 1024 * 1024 + 1);
  expect(await attach({ path: big })).toMatch(/over the 64 MB/);
  const text = join(pods, "notes.pdf");
  await writeFile(text, "not a pdf at all");
  expect(await attach({ path: text })).toMatch(/Export or print it to PDF/);
  expect(parsed).toEqual([]);
}, 60_000);

test("narrow 2: a URL source is http(s), unredirected, timed and capped", async () => {
  const { attach, serve, parsed } = await boxed();
  expect(await attach({ url: "file:///C:/Windows/win.ini" })).toMatch(/Only http and https/);
  const origin = await serve((request, response) => {
    if (request.url === "/hop") return void response.writeHead(302, { location: "/sheet.pdf" }).end();
    if (request.url === "/slow") return;
    response.writeHead(200, { "content-type": "application/pdf" });
    if (request.url === "/huge") {
      const chunk = Buffer.alloc(1024 * 1024, "%");
      let sent = 0;
      const more = () => {
        while (sent++ <= 65) if (!response.write(chunk)) return void response.once("drain", more);
        response.end();
      };
      response.on("error", () => {});
      return more();
    }
    response.end(readFileSync(pdf));
  });
  expect(await attach({ url: `${origin}/hop` })).toMatch(/redirect/);
  expect(await attach({ url: `${origin}/huge` })).toMatch(/over the 64 MB/);
  const real = AbortSignal.timeout.bind(AbortSignal);
  const timeout = vi
    .spyOn(AbortSignal, "timeout")
    .mockImplementation((ms) => real(ms === 30_000 ? 200 : ms));
  try {
    expect(await attach({ url: `${origin}/slow` })).toMatch(/within 30 s/);
    expect(timeout).toHaveBeenCalledWith(30_000);
  } finally {
    timeout.mockRestore();
  }
  expect(parsed).toEqual([]);
}, 120_000);

// Mutant: remove the held-command continuation in ActionJournal.invoke. The missing path and URL
// request counter are sentinels: a bind that reads early fails before the person creates the source.
test("narrow 3: Pea attach is held before source reads; the notice Confirm attaches once", async () => {
  for (const kind of ["path", "url"] as const) {
    const { pods, pea, attach, parsed, serve, confirm, doc, outward } = await boxed();
    let reads = 0;
    const source = kind === "path" ? { path: join(pods, "not-yet-created.pdf") } : {
      url: `${await serve((_request, response) => { reads++; response.end(readFileSync(pdf)); })}/acme.pdf`,
    };
    expect(await attach(source, pea)).toContain("Held, not done");
    expect(parsed).toEqual([]);
    expect(reads).toBe(0);
    const send = heldSends().find(row => row.thread === pea.thread)!;
    expect(send).toBeDefined();
    const rows = noticeRows({ threads: [], receipts: [], works: [], machine: null, stored: [], held: [send] }, Date.now());
    expect(rows).toMatchObject([{ what: Object.values(source)[0], says: expect.stringContaining("LlamaCloud"), act: { kind: "confirm-send", id: send.id } }]);
    await expect(outward(send.id, pea)).rejects.toThrow(/human.only/);
    expect(parsed).toEqual([]);
    if ("path" in source) await copyFile(pdf, source.path!);
    expect((await confirm()).state).toBe("succeeded");
    expect(parsed).toHaveLength(1);
    expect((await doc()).spec?.doc.blocks).toEqual([block]);
    expect((await outward(send.id)).status).toBe(404);
    expect(parsed).toHaveLength(1);
  }
}, 60_000);

// Mutant: family-spec re-reads source.path when retaining source.pdf instead of using admitted bytes.
test("narrow 5: a PDF edited after admission attaches the bytes the admission retained", async () => {
  let sheet: string;
  const { pods, member, attach, parsed } = await boxed(async () => {
    await appendFile(sheet, "\n% edited after admission\n");
  });
  sheet = join(pods, "sheet.pdf");
  await copyFile(pdf, sheet);
  expect(await attach({ path: sheet })).toMatch(/"state":"succeeded"/);
  expect(parsed).toEqual([{ name: "sheet.pdf", bytes: pdfSize }]);
  const sidecar = JSON.parse(await readFile(join(pods, "lab", `${member.path}.spec.json`), "utf8"));
  const kept = await readFile(join(pods, "lab", sidecar.path.replace(/\.json$/, ""), "source.pdf"));
  expect(kept).toEqual(readFileSync(pdf));
  expect((await readFile(sheet)).length).toBeGreaterThan(pdfSize);
}, 60_000);

test("narrow 6: the spec asset door serves only what normalizes under the family folder", async () => {
  const { pods, member } = await boxed();
  const ask = (path: string) =>
    familySpecAsset(
      new URL(`http://host/family/spec?${new URLSearchParams({ pod: "lab", path })}`),
      pods,
    );
  expect((await ask(member.path)).status).toBe(200);
  expect((await ask("settings/family/../../pod.json")).status).toBe(404);
  expect((await ask("settings/family/..\\..\\pod.json")).status).toBe(404);
}, 60_000);
