// @vitest-environment node
/*
 * The /family doc-lab chain (routes MAP row 10, "/family acceptance") through the real action doors:
 * capture, save, attach, a cited value staged by Pea. Substituted: the native socket (it answers
 * `family.capture` with the a-box fixture, padded to a field family's size) and the PDF parser (the
 * in-process LlamaCloud parser). Work, the journal, the run registry, Pod files and the PDF bytes are real.
 */
import { afterEach, expect, test, vi } from "vite-plus/test";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { appendFile, copyFile, mkdir, mkdtemp, readFile, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { address, bindWork, familyDraftRouteState, type Caller } from "@pe/agent-contracts";
import * as actionClient from "../../../packages/mcps/src/shared/takeoff-action-client.ts";
import { nativeFixture } from "./fans-work-fixture.ts";
import { heldSends, releaseSend } from "../src/guards.ts";
import { noticeRows } from "../src/notice-feed.ts";
import { actAs, contextHeaders, serviceHeaders } from "./callers.ts";
import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { requestIdentityLayer } from "../src/request-identity.ts";
import { familySpecAsset } from "../src/family-spec.ts";
import { peRoutes } from "@pe/agent-contracts/pe-api";

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
  vi.unstubAllEnvs();
  for (const send of heldSends()) releaseSend(send.id);
  for (const close of closes.splice(0).reverse()) await close();
});

async function lab(beforeParse?: (file: File) => Promise<void>) {
  vi.stubEnv("LLAMA_CLOUD_API_KEY", "fixture-key");
  const pods = await mkdtemp(join(tmpdir(), "pe-doc-lab-"));
  closes.push(() => rm(pods, { recursive: true, force: true }));
  await mkdir(join(pods, "lab"), { recursive: true });
  await writeFile(join(pods, "lab", "pod.json"), JSON.stringify({ id: "lab" }));
  // The Pods folder is its own project home here, so each fixture has its own derived store.
  await writeFile(join(pods, "pe-home.json"), JSON.stringify({ tier: "project" }));
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aSacAAAAASUVORK5CYII=", "base64");
  let renderFetches = 0;
  const renders = createServer((_request, response) => {
    renderFetches++;
    response.writeHead(200, { "content-type": "image/png" });
    response.end(png);
  });
  await new Promise<void>((resolve) => renders.listen(0, "127.0.0.1", resolve));
  closes.push(() => new Promise((resolve) => { renders.closeAllConnections(); renders.close(resolve); }));
  const screenshotUrl = `http://127.0.0.1:${(renders.address() as { port: number }).port}/page.png`;
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
      parsePdf: async ({ sender, file, apiKey }) => {
        expect(sender).toBe("person");
        expect(apiKey).toBe("fixture-key");
        await beforeParse?.(file);
        const bytes = Buffer.from(await file.arrayBuffer());
        if (bytes.subarray(0, 5).toString() !== "%PDF-") throw Error("The parser was not handed a PDF");
        parsed.push({ name: file.name, bytes: bytes.length });
        return { jobId: "acme", fileName: file.name, pages: [{ page: 1, width: 1, height: 1, screenshotUrl, markdown: "sheet" }], blocks: [block], images: [] };
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
    expect(response.status, await response.clone().text()).toBe(202);
    const receipt = await response.json() as { id: string };
    return f.journal.wait(receipt.id);
  };
  return { f, pods, pea, parsed, png, renderFetches: () => renderFetches, handle, doc, act, stage, save, confirm, outward };
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
  const { pods, parsed, png, renderFetches, act, handle, doc } = await lab();
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
  let fetched = 0;
  const server = createServer((_request, response) => {
    fetched++;
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
  // Homes slice 9: the same bytes were parsed by the path attach, so the parser is not called
  // again, and a second attach of the URL fetches no vendor file again (JOURNEYS target 13).
  // Mutant: in family-spec.ts replace `keptFamilyParse(store, pdf) ??` with nothing.
  expect(parsed).toHaveLength(1);
  const again = await act("family.attach-spec", host, { member, source: { url }, work: await handle() });
  expect(again.state, JSON.stringify(again).slice(0, 2000)).toBe("succeeded");
  expect([parsed.length, fetched]).toEqual([1, 1]);
  const derived = readdirSync(join(pods, "Derived"));
  expect(derived).toHaveLength(3);
  expect(renderFetches()).toBe(1);
  for (const name of derived)
    expect(name.split(".")[1]).toBe(createHash("sha256").update(readFileSync(join(pods, "Derived", name))).digest("hex"));
  expect((await doc()).spec).toMatchObject({ member, doc: { blocks: [block] } });
  // The original PDF is a portable member asset beside the family.
  const sidecar = JSON.parse(
    await readFile(join(pods, "lab", `${member.path}.spec.json`), "utf8"),
  ) as { path: string };
  const folder = join(pods, "lab", sidecar.path.replace(/\.json$/, ""));
  expect((await readFile(join(folder, "source.pdf"))).length).toBe(pdfSize);
  expect(await readFile(join(folder, "page-1.png"))).toEqual(png);
  // M12: a view without its render must be reparsed, never accepted as a complete hit.
  const render = derived.find((name) => readFileSync(join(pods, "Derived", name)).equals(png))!;
  await rm(join(pods, "Derived", render));
  const recovered = await act("family.attach-spec", host, { member, source: { url }, work: await handle() });
  expect(recovered.state, JSON.stringify(recovered)).toBe("succeeded");
  expect(parsed).toHaveLength(2);
  expect(renderFetches()).toBe(2);
  expect(await readFile(join(folder, "page-1.png"))).toEqual(png);
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
async function boxed(beforeParse?: (file: File) => Promise<void>) {
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
    const { f, pods, pea, attach, parsed, serve, confirm, doc, outward } = await boxed();
    let reads = 0;
    const source = kind === "path" ? { path: join(pods, "not-yet-created.pdf") } : {
      url: `${await serve((_request, response) => { reads++; response.end(readFileSync(pdf)); })}/acme.pdf`,
    };
    expect(await attach(source, pea)).toContain("Held, not done");
    expect(parsed).toEqual([]);
    expect(reads).toBe(0);
    const send = heldSends().find(row => row.thread === pea.thread)!;
    expect(send).toBeDefined();
    // The same attach asked again is the same hold, and the message says where it waits.
    const again = await attach(source, pea);
    expect(again).toContain("waits in the person's notices for their Confirm");
    expect(again).not.toContain("themselves from the web app");
    expect(heldSends().filter(row => row.thread === pea.thread)).toEqual([send]);
    // Mutant: project a send-outward held receipt in receiptRow. Sentinel: the journal holds the
    // held receipts this feed is built from, so the one row is not an empty scan.
    const receipts = (await f.journal.list()).map(action => ({ revision: 1, action }));
    expect(receipts.filter(({ action }) => action.refusal?.kind === "held")).toHaveLength(2);
    const rows = noticeRows({ threads: [], receipts, works: [], machine: null, stored: [], held: heldSends() }, Date.now())
      .filter(row => row.group === "waits");
    expect(rows).toMatchObject([{ what: Object.values(source)[0], where: "lab: settings/family/box.json", says: expect.stringContaining("LlamaCloud"),
      act: { kind: "confirm-send", id: send.id, to: "LlamaCloud", detail: "for lab: settings/family/box.json" } }]);
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

// A consumed hold never admits again, even after failure; retry requires a new held request.
test("narrow 4: a failed confirmed attach is receipted, and a new hold runs as its confirming person", async () => {
  let calls = 0;
  const { f, pea, attach, parsed, outward } = await boxed(async () => {
    if (++calls === 1) throw Error("LlamaCloud 503");
  });
  const person: Caller = { kind: "human", via: "tailnet", login: "kai@tailnet", device: "laptop" };
  expect(await attach({ path: pdf }, pea)).toContain("Held, not done");
  const send = heldSends().find((row) => row.thread === pea.thread)!;
  const accepted = await outward(send.id, person);
  expect(accepted.status).toBe(202);
  const first = (await accepted.json()) as { id: string };
  const failed = await f.journal.wait(first.id);
  expect(failed.state).toBe("failed");
  expect("error" in failed && failed.error).toContain("LlamaCloud 503");
  expect(heldSends()).toEqual([]);
  expect((await outward(send.id, person)).status).toBe(404);
  expect(calls).toBe(1);
  expect(await attach({ path: pdf }, pea)).toContain("Held, not done");
  const retry = heldSends().find((row) => row.thread === pea.thread)!;
  expect(retry.id).not.toBe(send.id);
  const response = await outward(retry.id, person);
  expect(response.status).toBe(202);
  const next = (await response.json()) as { id: string };
  const receipt = await f.journal.wait(next.id);
  expect(receipt.state).toBe("succeeded");
  expect(receipt.caller).toEqual(person);
  expect(calls).toBe(2);
  expect(parsed).toHaveLength(1);
  expect(heldSends()).toEqual([]);
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

test("an injected parser failure fails the attach without any network request", async () => {
  const { save, act, handle } = await lab(async () => { throw Error("Parser failed"); });
  const { member } = (await save("human")).result;
  const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(Error("Unexpected network request"));
  try {
    const attached = await act("family.attach-spec", host, {
      member: { pod: member.pod, path: member.path },
      source: { path: pdf },
      work: await handle(),
    });
    expect(attached.state).toBe("failed");
    expect(attached.error).toContain("Parser failed");
    expect(network).not.toHaveBeenCalled();
  } finally {
    network.mockRestore();
  }
}, 60_000);

// Mutant: await the confirmed action's settlement before answering Confirm.
test("Confirm admits over HTTP before a two-second parse finishes, uploads once and leaves a succeeded receipt", async () => {
  let uploads = 0;
  let parseFinished = false;
  let uploadUrl = "";
  const { f, pea, attach, serve } = await boxed(async (file) => {
    await fetch(uploadUrl, { method: "POST", body: file });
    await new Promise((resolve) => setTimeout(resolve, 2000));
    parseFinished = true;
  });
  uploadUrl = await serve((request, response) => {
    if (request.method === "POST") uploads++;
    request.resume();
    response.end("uploaded");
  });
  expect(await attach({ path: pdf }, pea)).toContain("Held, not done");
  const send = heldSends().find((row) => row.thread === pea.thread)!;
  let base = "";
  const identity = requestIdentityLayer({
    port: () => Number(new URL(base).port),
    frontendOrigin: Effect.succeed(undefined),
    share: {
      read: async () => {
        throw Error("local only");
      },
      observe: () => {},
    },
  });
  const web = HttpRouter.toWebHandler(
    HttpRouter.add(
      "POST",
      "/pe/outward/held/:id/confirm",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        return HttpServerResponse.fromWeb(
          yield* Effect.promise(() =>
            f.api.fetch(new Request(new URL(request.url, base), { method: "POST" })),
          ),
        );
      }),
    ).pipe(Layer.provide(identity)),
    { disableLogger: true },
  );
  closes.push(() => web.dispose());
  base = await serve(async (request, response) => {
    const answer = await web.handler(
      new Request(new URL(request.url!, base), {
        method: request.method,
        headers: request.headers as Record<string, string>,
      }),
    );
    response.writeHead(answer.status, Object.fromEntries(answer.headers));
    response.end(Buffer.from(await answer.arrayBuffer()));
  });
  const confirm = (headers = contextHeaders()) =>
    fetch(`${base}/pe/outward/held/${send.id}/confirm`, {
      method: "POST",
      headers: { ...serviceHeaders(), ...headers },
    });
  expect((await confirm(contextHeaders({ kind: "pea", thread: pea.thread }))).status).toBe(403);
  expect(uploads).toBe(0);
  const start = performance.now();
  const response = await confirm();
  const elapsed = performance.now() - start;
  expect(elapsed, "Confirm must answer before the two-second parse").toBeLessThan(1500);
  expect(parseFinished).toBe(false);
  expect(response.status).toBe(202);
  const accepted = (await response.json()) as { ok: true; id: string };
  // The production door (`servePeRoute`) refuses a body its route output does not decode; the fixture skips it.
  expect(peRoutes["outward.confirm"].output.safeParse(accepted).success).toBe(true);
  expect(accepted.id).toBeTruthy();
  expect(
    noticeRows(
      {
        threads: [],
        receipts: (await f.journal.list()).map((action) => ({ revision: 1, action })),
        works: [],
        machine: null,
        stored: [],
        held: heldSends(),
      },
      Date.now(),
    ),
  ).toContainEqual(expect.objectContaining({ key: `action:${accepted.id}`, group: "working" }));
  expect((await confirm()).status).toBe(404);
  const receipt = await f.journal.wait(accepted.id);
  expect(receipt.state).toBe("succeeded");
  expect(receipt.caller).toMatchObject({ kind: "human", via: "cli" });
  expect(parseFinished).toBe(true);
  expect(uploads).toBe(1);
  expect((await confirm()).status).toBe(404);
  expect(uploads).toBe(1);
  expect(
    noticeRows(
      {
        threads: [],
        receipts: (await f.journal.list()).map((action) => ({ revision: 1, action })),
        works: [],
        machine: null,
        stored: [],
        held: heldSends(),
      },
      Date.now(),
    ).some(
      (row) => row.verb === "held" && row.act?.kind === "confirm-send" && row.act.id === send.id,
    ),
  ).toBe(false);
}, 60_000);

// ADR 0038 guard 3: Confirm is the only way a held send runs. `outward.send` is human-only
// (`outward-send.ts` `principal`), so Pea posting it straight to /actions is refused before dispatch.
test("Pea cannot run outward.send directly; the hold stays for the person", async () => {
  const { f, pea, attach, parsed } = await boxed();
  expect(await attach({ path: pdf }, pea)).toContain("Held, not done");
  const send = heldSends().find((row) => row.thread === pea.thread)!;
  const { id: _id, at: _at, thread: _thread, ...input } = send;
  const response = await f.post("/actions", { id: "pea-direct-send", key: "outward.send", target: { kind: "host" }, input }, pea);
  const receipt = response.ok ? await f.journal.wait("pea-direct-send") : null;
  const text = receipt ? JSON.stringify(receipt) : await response.text();
  expect(text).toContain("caller.ineligible");
  if (receipt) expect(receipt).toMatchObject({ state: "failed", notDispatched: true });
  expect(parsed).toEqual([]);
  expect(heldSends().map((row) => row.id)).toContain(send.id);
}, 60_000);
