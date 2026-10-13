import { machineFixture } from "../../../packages/agent-contracts/tests/machine-fixture.ts";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createNodeServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Deferred, Effect, Layer } from "effect";
import { expect, test, vi } from "vite-plus/test";
import { documentsRootEnvVar } from "@pe/host-contracts/product-paths";
import type { ServiceHostHandle } from "@pe/host-contracts/pe-service-host";
import { readServiceFile } from "@pe/host-contracts/pe-service";
import { hostContextTokenPath } from "@pe/host-contracts/service-identity";
import { makeHttpLive } from "../src/app.ts";
import { createContributionContent, createPeRoutes } from "../src/pe-routes.ts";
import { listPackages } from "../src/packages.ts";
import { buildCapabilities } from "@pe/mcps";
import { findCapabilities } from "@pe/agent-contracts";
import { hostOwnership, productRoot } from "../src/host-ownership.ts";

vi.mock("../src/machine.ts", async (original) => {
  const real = await original<typeof import("../src/machine.ts")>();
  return {
    ...real,
    machineSources: (...args: Parameters<typeof real.machineSources>) => {
      const sources = real.machineSources(...args);
      const value = machineFixture();
      return {
        ...sources,
        host: async () => {
          throw Error("fixture has no host record");
        },
        peers: async () => [],
        sessions: async () => [],
        years: async () => [],
        attachments: async () => [],
        documents: async () => ({ state: "ok", documents: [] }),
        update: {
          current: () => value.update,
          refresh: async () => value.update,
          automaticPending: () => false,
          apply: async () => value.update,
        },
      };
    },
  };
});

/**
 * Host boundary: on a no-Revit host, the one capability catalog answers
 * in under 3 s, names the sources that did not answer, and still lists every route row and skill
 * row; route Work, Readings and the thread head answer from the host itself.
 */
test("the host-owned /pe surface answers without Revit", async () => {
  const localAppData = mkdtempSync(join(tmpdir(), "pe-caps-"));
  const previousLocalAppData = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = localAppData;
  vi.stubEnv(documentsRootEnvVar, join(localAppData, "Documents"));
  const appBase = productRoot();
  const nodeServer = createNodeServer();
  const program = Effect.scoped(
    Effect.gen(function* () {
      const latch = yield* Deferred.make<void>();
      const handle = yield* Deferred.make<ServiceHostHandle>();
      yield* Effect.raceFirst(
        Layer.launch(
          makeHttpLive({
            capabilities: { revit: false },
            lifecycle: { handle, latch },
            nodeServer,
            port: 0,
            webRoot: null,
          }),
        ),
        Deferred.await(latch),
      );
    }),
  );
  const done = Effect.runPromise(program);
  try {
    const deadline = Date.now() + 10_000;
    let service = await readServiceFile(appBase, hostOwnership.serviceName);
    while (!service && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      service = await readServiceFile(appBase, hostOwnership.serviceName);
    }
    if (!service) throw new Error("service file did not appear");
    const base = `http://127.0.0.1:${service.port}`;
    const started = Date.now();
    const response = await fetch(
      `${base}/pe/capabilities?doc=${encodeURIComponent("C:\\Models\\A.rvt")}&pin=pe.app-25`,
    );
    const elapsed = Date.now() - started;
    expect(response.status).toBe(200);
    expect(elapsed).toBeLessThan(3_000);
    const catalog = (await response.json()) as {
      sources: Record<string, string>;
      machine: { revit: { sessions: unknown[] } };
      capabilities: { key: string }[];
    };
    expect(catalog.sources["route registry"]).toBe("ok");
    expect(catalog.sources.skills).toBe("ok");
    expect(catalog.sources.catalog).toMatch(/bridge catalog unavailable|did not answer/);
    // pod.list is host-local: the pods answer with Revit closed.
    expect(catalog.sources.packages).toBe("ok");
    expect(catalog.machine.revit.sessions).toEqual([]);
    // Recents read without Revit; whatever they answered in their own budget is named.
    expect(catalog.sources.recents).toMatch(/^(ok|still reading|did not answer)/);
    const keys = catalog.capabilities.map((row) => row.key);
    expect(keys).toContain("op:host.shell.open");
    expect(keys).toContain("workflow:instances.start");
    expect(keys.some((key) => key.startsWith("route:ops"))).toBe(false);
    // The member Work route is named for the pods its members live in.
    expect(keys).toContain("route:pods.propose");
    expect(keys).toContain("op:pod.list");
    expect(keys).not.toContain("route:pods.open");
    expect(keys).toContain("skill:@product/skills/build-pod");
    expect(keys.some((key) => key.startsWith("op:revit."))).toBe(false);

    // The thread head, its Reading, and route Work, with no tenant behind them.
    // Anonymous loopback is read-only; the owner's terminal token (written at start) is a human.
    const putAs = (headers: Record<string, string>) =>
      fetch(`${base}/pe/scope/t1`, {
        method: "PUT",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ defaultTarget: null, expectedRevision: 0 }),
      });
    const anonymous = await putAs({});
    expect(anonymous.status).toBe(403);
    expect(await anonymous.json()).toMatchObject({ refusal: { code: "context.missing" } });
    expect(await (await putAs({ "x-pe-context": "forged" })).json()).toMatchObject({
      refusal: { code: "context.unknown" },
    });
    const terminal = readFileSync(hostContextTokenPath(hostOwnership.serviceName), "utf8");
    const put = await putAs({ "x-pe-context": terminal });
    expect(await put.json()).toMatchObject({ ok: true, head: { revision: 1 } });
    const resources = await fetch(
      `${base}/pe/resources?keys=${encodeURIComponent(JSON.stringify([{ kind: "thread-head", thread: "t1" }]))}`,
    );
    const reader = resources.body!.getReader();
    const frame = new TextDecoder().decode((await reader.read()).value);
    await reader.cancel();
    expect(JSON.parse(frame.slice(frame.indexOf("data: ") + 6))).toMatchObject({
      kind: "snapshot",
      value: { defaultTarget: null, revision: 1 },
    });
    const routeList = await fetch(`${base}/pe/route-state`);
    expect(routeList.status).toBe(200);
    expect(((await routeList.json()) as unknown[]).length).toBeGreaterThan(0);
    expect((await fetch(`${base}/pe/access`)).status).toBe(200);

    await fetch(`${base}/admin/shutdown`, {
      method: "POST",
      headers: { "x-pe-service-token": service.token },
    });
    await done;
  } finally {
    vi.unstubAllEnvs();
    if (previousLocalAppData === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = previousLocalAppData;
    for (const directory of [localAppData])
      try {
        rmSync(directory, { force: true, recursive: true, maxRetries: 50, retryDelay: 100 });
      } catch {
        // Windows can retain a just-closed LibSQL handle past test teardown.
      }
  }
}, 40_000);

test("GET /pe/capabilities serves each open document as a doc: row and each unopened recent one as a recent: row", async () => {
  const app = createPeRoutes({
    registrations: [],
    store: { getState: async () => null, setState: async () => {} },
    heads: { observe: () => () => {} },
    capabilityCatalog: {
      read: async () => ({
        at: "2026-10-12T12:00:00.000Z",
        sources: {},
        diagnostics: [],
        machine: machineFixture([
          {
            session: "b1",
            documents: [
              {
                openId: "o1",
                address: "C:\\Models\\Riser.rvt",
                title: "Riser",
                isFamilyDocument: false,
                isActive: true,
              },
            ],
          },
        ]),
        recents: [
          { title: "Riser", path: "C:\\Models\\Riser.rvt", rank: 1 },
          { title: "Plant", path: "C:\\Models\\Plant.rvt", rank: 2 },
        ].map((recent) => ({
          ...recent,
          isCloud: false,
          region: null,
          projectGuid: null,
          modelGuid: null,
          year: 2025,
          savedYear: 2025,
        })),
        capabilities: [],
      }),
    },
  });
  const response = await app.fetch(new Request("http://local/pe/capabilities"));
  expect(response.status).toBe(200);
  const catalog = (await response.json()) as { capabilities: { key: string; kind: string }[] };
  expect(catalog.capabilities).toMatchObject([
    // Riser is open: its doc: row wins, so only Plant is a recent: row.
    { key: "doc:b1/o1", kind: "document" },
    { key: "recent:C:\\Models\\Plant.rvt", kind: "recent" },
  ]);
  expect(catalog.capabilities).toHaveLength(2);
});

test("one admitted content snapshot waits for import, publishes exact skill bytes and retains frozen script input", async () => {
  const home = mkdtempSync(join(tmpdir(), "pe-catalog-cut-"));
  const folder = join(home, "Pods", "renamed-folder");
  for (const name of ["Office_Page", "odd--name", "working"]) {
    mkdirSync(join(home, "Pages", name), { recursive: true });
    writeFileSync(join(home, "Pages", name, "index.html"), "<title>Scratch Page</title>");
  }
  let imports = 0,
    listings = 0;
  const input = {
    "pod.json": JSON.stringify({
      id: "shelf-test",
      name: "Shelf",
      entrypoints: [{ sourcePath: "src/Census.cs" }],
    }),
    "src/Census.cs": "original script\r\n",
    "pages/tour/index.html": "<title>Tour</title>",
    "skills/check/SKILL.md": "---\nname: check\ndescription: Check things.\n---\nexact\r\n",
    "skills/check/support.txt": "support\r\n",
    "settings/checks.json": "{}\r\n",
    "README.md": "guide\r\n",
  };
  const content = createContributionContent({
    worldRoot: home,
    bootstrap: async () => {
      imports++;
      for (const [path, text] of Object.entries(input)) {
        mkdirSync(join(folder, path, ".."), { recursive: true });
        writeFileSync(join(folder, path), text);
      }
    },
    packages: async () => {
      listings++;
      expect(imports).toBe(1);
      return listPackages(join(home, "Pods"));
    },
  });
  try {
    const [first, same] = await Promise.all([content.read(), content.read()]);
    expect(same).toBe(first);
    expect(listings).toBe(1);
    const catalog = {
      at: "now",
      sources: {},
      diagnostics: first.diagnostics,
      machine: machineFixture(),
      capabilities: buildCapabilities({ ops: [], routes: [], ...first }),
    };
    const app = createPeRoutes({
      registrations: [],
      store: { getState: async () => null, setState: async () => {} },
      heads: { observe: () => () => {} },
      capabilityCatalog: { read: async () => catalog },
      contributionRead: content.member,
    });
    const script = catalog.capabilities.find((c) => c.key === "script:@shelf-test/src/Census.cs")!;
    const page = catalog.capabilities.find((c) => c.key === "page:@shelf-test/pages/tour")!;
    expect(page.projection).toEqual({ openUrl: "/pages/shelf-test--tour/", pane: "page" });
    expect(catalog.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "page.noncanonical-folder",
          folder: "Office_Page",
          canonicalSlug: "office-page",
        }),
        expect.objectContaining({
          code: "page.noncanonical-folder",
          folder: "odd--name",
          canonicalSlug: "odd-name",
        }),
      ]),
    );
    expect(
      catalog.capabilities.some(
        (c) => c.key.includes("Office_Page") || c.key.includes("odd--name"),
      ),
    ).toBe(false);
    expect(catalog.capabilities.some((c) => c.key === "page:@pages/working")).toBe(true);
    const filtered = await (
      await app.fetch(new Request("http://local/pe/capabilities?query=Shelf&kind=page&limit=3"))
    ).json();
    expect(filtered.capabilities).toEqual(
      findCapabilities(catalog.capabilities, { query: "Shelf", kind: "page", limit: 3 }),
    );
    expect(filtered.diagnostics).toEqual(catalog.diagnostics);
    expect((await app.fetch(new Request("http://local/pe/capabilities?kind=pod"))).status).toBe(
      400,
    );
    writeFileSync(join(folder, "src/Census.cs"), "changed after admission");
    const answer = await app.fetch(
      new Request(
        `http://local/pe/contributions?key=${encodeURIComponent(script.key)}&sha256=${script.package!.sha256}`,
      ),
    );
    const frozen = await answer.json();
    expect(frozen.content).toBe(input["src/Census.cs"]);
    expect(frozen.folder).toBe("renamed-folder");
    expect(frozen.sourceBundle.files.map((f: { path: string }) => f.path).sort()).toEqual(
      Object.keys(input).sort(),
    );
    const skill = catalog.capabilities.find((c) => c.key === "skill:@shelf-test/skills/check")!;
    const skillBytes = content.member(skill.key, skill.package!.sha256) as { content: string };
    expect(skillBytes.content).toBe(input["skills/check/SKILL.md"]);
    for (const root of [".agents", ".claude"]) {
      expect(
        readFileSync(join(home, root, "skills", "shelf-test--check", "SKILL.md"), "utf8"),
      ).toBe(skillBytes.content);
      expect(
        readFileSync(join(home, root, "skills", "shelf-test--check", "support.txt"), "utf8"),
      ).toBe(input["skills/check/support.txt"]);
    }
    expect(
      (
        await app.fetch(
          new Request(
            `http://local/pe/contributions?key=${encodeURIComponent(script.key)}&sha256=${"f".repeat(64)}`,
          ),
        )
      ).status,
    ).toBe(409);
    expect(content.member("member:@shelf-test/README.md")).toMatchObject({
      content: input["README.md"],
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("a slow import retains one pending publication when the catalog TTL passes", async () => {
  const home = mkdtempSync(join(tmpdir(), "pe-publication-pending-"));
  let release!: () => void;
  const bootstrap = new Promise<void>((resolve) => {
    release = resolve;
  });
  let listings = 0;
  const content = createContributionContent({
    worldRoot: home,
    bootstrap: () => bootstrap,
    packages: async () => {
      listings++;
      return { packages: [], unreadable: [] };
    },
    pages: async () => [],
  });
  const started = Date.now();
  const clock = vi.spyOn(Date, "now").mockReturnValue(started);
  const first = content.read();
  let second = first;
  try {
    clock.mockReturnValue(started + 31_000);
    second = content.read();
    expect(second).toBe(first);
    release();
    await first;
    expect(listings).toBe(1);
  } finally {
    clock.mockRestore();
    release();
    await Promise.allSettled([first, second]);
    rmSync(home, { recursive: true, force: true });
  }
});
