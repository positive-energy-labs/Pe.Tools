import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vite-plus/test";
import { servePeRoute } from "@pe/agent-contracts/pe-api";
import { createHash } from "node:crypto";
import { Context, Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/unstable/http";
import { CaptureStore, capturesRoute } from "../src/captures-route.ts";
import { ActionJournal } from "../src/action-journal.ts";
import { RunConsents } from "../src/run-consent.ts";
import { bindControl } from "../src/control.ts";
import {
  commitPagePublication,
  pageVersion,
  pagePublicationExecutor,
} from "../src/page-publication.ts";
import { createPagesHandler, pageLibrary } from "../src/pages-route.ts";
import { asCaller, human, pea } from "./callers.ts";
import type { Caller } from "@pe/agent-contracts";

const homes: string[] = [];
afterEach(async () => {
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true });
});
async function fixture(caller: Caller = human) {
  const home = await mkdtemp(join(tmpdir(), "pe-publish-"));
  homes.push(home);
  const root = join(home, "Pages");
  await mkdir(join(root, "flow", ".state"), { recursive: true });
  await writeFile(join(root, "flow", "index.html"), "old");
  await writeFile(join(root, "flow", ".state", "binding.json"), "binding retained");
  const captures = new CaptureStore(join(home, "captures"));
  const journal = new ActionJournal(join(home, "actions.json"));
  const executor = pagePublicationExecutor(root, "http://fixture", pageLibrary, captures);
  journal.bindCommands({
    resolve: () => executor,
    probe: async (dependency) => {
      if (dependency.kind !== "file") throw Error("Unexpected Page source");
      return pageVersion(root, "flow");
    },
  });
  const handle = asCaller(caller, createPagesHandler(root, join(home, "Pods"), undefined, journal));
  const publish = (body: unknown, id?: string) =>
    servePeRoute(
      new Request("http://fixture/pe/pages/publish", {
        method: "POST",
        headers: { "content-type": "application/json", ...(id ? { "x-pe-command-id": id } : {}) },
        body: JSON.stringify(body),
      }),
      handle,
    );
  return { home, root, publish, captures, journal };
}
const page = {
  kind: "page" as const,
  slug: "flow",
  title: "Flow",
  html: "<!doctype html><html><head><title>Flow</title></head><body><h1>Flow</h1></body></html>",
};
it("refuses traversal and broken inline JavaScript without touching the prior Page", async () => {
  const { root, publish } = await fixture();
  expect((await publish({ ...page, slug: "../outside" })).status).toBe(400);
  expect((await publish({ ...page, slug: "pe.js" })).status).toBe(400);
  const broken = await publish({ ...page, html: "<!doctype html><script>const = ;</script>" });
  expect(broken.status).toBe(422);
  expect(await broken.text()).toContain("JavaScript");
  expect((await publish({ ...page, html: "<!doctype html><div a='1' a='2'></div>" })).status).toBe(
    422,
  );
  expect(
    (
      await publish({
        ...page,
        html: "<!doctype html><script>const client = /*pe:new*/ null;</script>",
      })
    ).status,
  ).toBe(422);
  expect(await readFile(join(root, "flow", "index.html"), "utf8")).toBe("old");
});
it("refuses a symlink folder and foreign publication principals", async () => {
  const { home, root, publish } = await fixture();
  const outside = join(home, "outside");
  await mkdir(outside);
  await symlink(outside, join(root, "linked"), "junction");
  expect((await publish({ ...page, slug: "linked" })).status).toBe(422);
  for (const caller of [
    { kind: "anonymous" },
    { kind: "external-mcp", context: "fixture", label: "fixture" },
    { kind: "service", service: "fixture" },
    { kind: "page", page: "page:@pages/flow" },
  ] as Caller[]) {
    const foreign = await fixture(caller);
    expect((await foreign.publish(page)).status).toBe(403);
  }
});
it("captures through real Edge, publishes only on success, and preserves authored state", async () => {
  const { root, publish, captures } = await fixture(human);
  const response = await publish(page);
  expect(response.status, await response.clone().text()).toBe(201);
  const result = await response.json();
  const expected = Buffer.from(result.capture.data, "base64");
  expect(result.capture.sha256).toBe(createHash("sha256").update(expected).digest("hex"));
  expect(result.capture.url).toBe(`http://fixture/captures/${result.capture.sha256}.png`);
  expect(await captures.blob(result.capture.sha256)).toEqual(expected);
  const assets = HttpRouter.toWebHandler(
    capturesRoute(
      () => Effect.succeed(HttpServerResponse.text("spa")),
      () => captures,
    ),
    { disableLogger: true },
  );
  try {
    const image = await assets.handler(new Request(result.capture.url), Context.empty() as never);
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toContain("image/png");
    expect(Buffer.from(await image.arrayBuffer())).toEqual(expected);
  } finally {
    await assets.dispose();
  }
  expect(result).toMatchObject({
    ok: true,
    key: "page:@pages/flow",
    openUrl: "http://fixture/pages/flow/",
    capture: { mimeType: "image/png", width: 1000 },
  });
  expect(Buffer.from(result.capture.data, "base64").subarray(0, 8).toString("hex")).toBe(
    "89504e470d0a1a0a",
  );
  const evidence = fileURLToPath(
    new URL("../../../../.artifacts/runs/page-capture-cdp-20261026/", import.meta.url),
  );
  await mkdir(evidence, { recursive: true });
  await writeFile(join(evidence, "native-capture.png"), Buffer.from(result.capture.data, "base64"));
  await writeFile(join(evidence, "native-input.html"), page.html);
  await writeFile(
    join(evidence, "native-result.json"),
    JSON.stringify({ ...result, capture: { ...result.capture, data: undefined } }, null, 2),
  );
  expect(await readFile(join(root, "flow", "index.html"), "utf8")).toContain("<h1>Flow</h1>");
  expect(await readFile(join(root, "flow", ".state", "binding.json"), "utf8")).toBe(
    "binding retained",
  );
  const failure = await publish({
    ...page,
    html: "<!doctype html><title>Bad</title><script>throw Error('capture refused')</script>",
  });
  expect(failure.status).toBe(422);
  expect(await failure.text()).toContain("capture refused");
  expect(await readFile(join(root, "flow", "index.html"), "utf8")).toContain("<h1>Flow</h1>");
}, 45000);

it("records publication before waiting and Stop leaves the existing source untouched", async () => {
  const ref = { thread: "publication", turn: "one" };
  const events: Array<{ kind: string; requestId?: string }> = [];
  const runs = new RunConsents((_run, event) => events.push(event));
  bindControl({ runs });
  runs.open(ref);
  try {
    const fixtureValue = await fixture({
      kind: "pea",
      context: "publication",
      thread: ref.thread,
      run: ref,
      root: ref,
    });
    const pending = fixtureValue.publish(page, "publish-once");
    await expect
      .poll(async () => (await fixtureValue.journal.list(undefined, "publish-once"))[0]?.state)
      .toBe("waiting");
    const row = (await fixtureValue.journal.list(undefined, "publish-once"))[0]!;
    expect(row).toMatchObject({
      state: "waiting",
      input: page,
      prepared: { state: "unprepared" },
      effects: [{ kind: "publication", page: "page:@pages/flow" }],
    });
    expect(await readFile(join(fixtureValue.root, "flow", "index.html"), "utf8")).toBe("old");
    const ask = events.find((event) => event.kind === "permission_request")!;
    expect(runs.decide(ref.thread, ask.requestId!, "stop_writes")).toBe(true);
    expect((await pending).status).toBe(409);
    expect((await fixtureValue.journal.list(undefined, "publish-once"))[0]?.state).toBe(
      "cancelled",
    );
    expect((await fixtureValue.publish(page, "publish-once")).status).toBe(409);
    expect(await readFile(join(fixtureValue.root, "flow", "index.html"), "utf8")).toBe("old");
  } finally {
    runs.closeAll();
    bindControl({ runs: undefined });
  }
});
it("refuses an unscoped Pea publication instead of borrowing a current turn", async () => {
  const { publish, root } = await fixture(pea());
  const result = await publish(page);
  expect(result.status).toBe(422);
  expect(await result.text()).toContain("run.none");
  expect(await readFile(join(root, "flow", "index.html"), "utf8")).toBe("old");
});
it("revalidates source bytes at the publication effect boundary", async () => {
  const { root } = await fixture(human);
  const version = await pageVersion(root, page.slug);
  await writeFile(join(root, "flow", "index.html"), "a concurrent human edit");
  await expect(
    commitPagePublication(
      root,
      { input: page, origin: "http://fixture", capture: {} as never },
      version,
    ),
  ).rejects.toThrow("Page changed after submission");
  expect(await readFile(join(root, "flow", "index.html"), "utf8")).toBe("a concurrent human edit");
});
