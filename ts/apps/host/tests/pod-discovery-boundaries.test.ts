import * as fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Cause, Effect, Layer } from "effect";
import { expect, onTestFinished, test, vi } from "vite-plus/test";
import { mkdtemp, stateFixture } from "../../../tests/isolated-home/storage.ts";
import { capturePackage, listPackages, productPodsRoots } from "../src/packages.ts";
import { stopPackageDiscovery } from "../src/pod-capture.ts";
import { runPodScript } from "../src/operation-script.ts";
import { createPagesHandler } from "../src/pages-route.ts";
import {
  settleExit,
  callRouteOver,
  detachedBridge,
  journalAt,
  testHostInputs,
} from "./effect-test.ts";
import { serveRoutes } from "./real-server.ts";
import { actAs, contextHeaders, human, serviceHeaders } from "./callers.ts";

vi.mock("node:fs/promises", async (original) => ({
  ...(await original<typeof import("node:fs/promises")>()),
}));

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "pe-discovery-boundaries-"));
  const home = join(root, "home"),
    pods = join(home, "Pods"),
    directory = join(pods, "probe");
  vi.stubEnv("PE_TOOLS_PRODUCT_HOME", home);
  vi.stubEnv("PE_TOOLS_SHARED_ROOT", join(root, "no-firm"));
  onTestFinished(async () => {
    vi.restoreAllMocks();
    stopPackageDiscovery();
    vi.unstubAllEnvs();
    await fs.rm(root, { recursive: true, force: true });
  });
  await fs.mkdir(join(directory, "pages", "hello"), { recursive: true });
  await fs.writeFile(join(home, "pe-home.json"), '{"tier":"user"}');
  await fs.writeFile(
    join(directory, "pod.json"),
    JSON.stringify({ id: "probe", entrypoints: [{ sourcePath: "Run.csx", mode: "ReadOnly" }] }),
  );
  const script = join(directory, "Run.csx");
  await fs.writeFile(script, "Result(1);");
  await fs.writeFile(join(directory, "pages", "hello", "index.html"), "<title>Probe</title>");
  await listPackages();
  const sealed = await capturePackage("probe");
  const unavailable = async () => {
    await fs.writeFile(script, "Result(22);");
    const original = fs.open;
    vi.spyOn(fs, "open").mockImplementation(async (...args) => {
      if (String(args[0]) === script)
        throw Object.assign(Error("Editor holds this file"), { code: "EBUSY" });
      return original(...args);
    });
    expect(
      (await listPackages()).packages.find((pod) => pod.id === "probe")?.discoveryFailure,
    ).toContain("Editor holds");
  };
  return { root, pods, script, sealed, unavailable };
}

test("B13/B14: real /call preserves unavailable pod.capture as typed 503 without dispatch", async () => {
  const pod = await fixture();
  const invoke = vi.fn(() =>
    Effect.succeed({ value: { status: "Succeeded" }, target: { session: "s", document: null } }),
  );
  const bridge = detachedBridge({ invoke });
  const journal = journalAt(join(pod.root, "journal.jsonl"), Date.now);
  const server = await serveRoutes(
    callRouteOver(journal).pipe(Layer.provide(testHostInputs)),
    bridge,
  );
  try {
    const send = () =>
      fetch(`${server.base}/call`, {
        method: "POST",
        headers: { "content-type": "application/json", ...contextHeaders(), ...serviceHeaders() },
        body: JSON.stringify({ key: "pod.capture", request: { pod: "probe" } }),
      });
    const admitted = await send();
    expect(admitted.status, await admitted.clone().text()).toBe(200);
    expect(await admitted.json()).toMatchObject({ id: "probe" });
    await pod.unavailable();
    const refused = await send();
    expect(refused.status).toBe(503);
    expect(await refused.json()).toMatchObject({
      code: "pod.discovery.exceeded",
      notDispatched: true,
    });
    expect(invoke).not.toHaveBeenCalled();
  } finally {
    await server.close();
    await journal.close();
  }
});

test("B15: an earlier sealed scripting.execute bundle is refused before bridge dispatch", async () => {
  const pod = await fixture();
  await pod.unavailable();
  const invoke = vi.fn(() =>
    Effect.succeed({ value: { status: "Succeeded" }, target: { session: "s", document: null } }),
  );
  const exit = await settleExit(
    runPodScript(
      detachedBridge({ invoke }),
      { session: "s", openId: "d" },
      { sourcePath: "Run.csx", sourceBundle: pod.sealed.sourceBundle },
      "sealed-unavailable",
    ),
  );
  expect(invoke).not.toHaveBeenCalled();
  expect(exit._tag).toBe("Failure");
  if (exit._tag === "Failure")
    expect(Cause.squash(exit.cause)).toMatchObject({
      status: 503,
      refusal: { code: "pod.discovery.exceeded" },
    });
});

test("B16: a healthy Page's act route refuses an unavailable Pod's declared script key", async () => {
  const pod = await fixture();
  const controller = join(pod.pods, "controller", "pages", "hello");
  await fs.mkdir(controller, { recursive: true });
  await fs.writeFile(join(pod.pods, "controller", "pod.json"), '{"id":"controller"}');
  await fs.writeFile(join(controller, "index.html"), "<title>Controller</title>");
  const forward = vi.fn(async () => Response.json({ state: "running" }, { status: 202 }));
  const handler = createPagesHandler(
    [],
    productPodsRoots(),
    {
      sessions: async () => [
        {
          session: "s",
          documents: [
            {
              openId: "d",
              title: "Fixture",
              address: "C:\\fixture.rvt",
              isFamilyDocument: false,
              isActive: true,
            },
          ],
        },
      ],
      forward,
    },
    undefined,
    stateFixture(join(pod.root, "page-state")),
  );
  const bound = await actAs(human, () =>
    handler(
      new Request("http://host/pe/pages/controller--hello/binding", {
        method: "PUT",
        body: JSON.stringify({ kind: "pinned", ref: { session: "s", openId: "d" } }),
      }),
    ),
  );
  expect(bound.status, await bound.clone().text()).toBe(200);
  await pod.unavailable();
  const response = await actAs({ kind: "page", page: "page:@controller/pages/hello" }, () =>
    handler(
      new Request("http://host/pages/controller--hello/act", {
        method: "POST",
        body: JSON.stringify({ key: "script:@probe/Run.csx" }),
      }),
    ),
  );
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ code: "pod.discovery.exceeded" });
  expect(forward).not.toHaveBeenCalled();
});

test("B17: equal-length bytes with reported mtime held and ctime changed are reread", async () => {
  const pod = await fixture();
  const initial = await fs.lstat(pod.script),
    original = fs.lstat;
  let changed = false;
  // Control the metadata boundary precisely; the overwritten bytes and capture are real files.
  vi.spyOn(fs, "lstat").mockImplementation(async (...args) => {
    const info = await original(...args);
    if (String(args[0]) === pod.script) {
      info.mtimeMs = initial.mtimeMs;
      info.ctimeMs = initial.ctimeMs + (changed ? 1 : 0);
    }
    return info;
  });
  await listPackages();
  await fs.writeFile(pod.script, "Result(2);");
  changed = true;
  const next = (await listPackages()).packages.find((p) => p.id === "probe");
  expect(Buffer.from(next?.members.find((m) => m.path === "Run.csx")?.bytes ?? []).toString()).toBe(
    "Result(2);",
  );
});
