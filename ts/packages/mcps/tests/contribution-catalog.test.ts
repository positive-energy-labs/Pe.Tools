import { createHash } from "node:crypto";
import { cli } from "gunshi";
import { afterEach, expect, test, vi } from "vite-plus/test";
import {
  capabilityCatalogSchema,
  findCapabilities,
  type PackageProjection,
} from "@pe/agent-contracts";
import { machineFixture } from "../../agent-contracts/tests/machine-fixture.ts";
import { buildCapabilities } from "../src/pea/capabilities.ts";
import { skillSnapshot } from "../src/pea/skill-publication.ts";
import { peDo, peFind, peRead } from "../src/pea/capability-tools.ts";
import { PeaCliCommands } from "../src/pea/PeaCliCommands.ts";
import { fakeRuntimeHost } from "./runtime-host-fixture.ts";

const bytes = Buffer.from(
  "---\nname: duct-loss\ndescription: Duct loss rules.\n---\nExact admitted revision.\r\n",
);
const sha256 = createHash("sha256").update(bytes).digest("hex");
const skills = [skillSnapshot("snowdon-ducts", "duct-loss", [{ path: "SKILL.md", bytes, sha256 }])];
const pod: PackageProjection = {
  id: "snowdon-ducts",
  folder: "renamed-local",
  diagnostics: [],
  members: [
    "src/Census.cs",
    "pages/tour/index.html",
    "skills/duct-loss/SKILL.md",
    "settings/checks.json",
  ].map((path) => ({ path, sha256, sizeBytes: bytes.length })),
  contributions: [
    {
      key: "script:@snowdon-ducts/src/Census.cs",
      sourcePath: "src/Census.cs",
      title: "Duct census",
      description: "Duct loss systems",
    },
    {
      key: "page:@snowdon-ducts/pages/tour",
      sourcePath: "pages/tour/index.html",
      title: "Duct tour",
      description: "Duct loss tour",
      projection: { openUrl: "/pages/host-projected/", pane: "page" },
    },
    {
      key: "skill:@snowdon-ducts/skills/duct-loss",
      sourcePath: "skills/duct-loss/SKILL.md",
      title: "Duct skill",
      description: "Duct loss",
    },
    {
      key: "member:@snowdon-ducts/settings/checks.json",
      sourcePath: "settings/checks.json",
      title: "Duct checks",
      description: "Duct loss settings",
    },
  ],
};
const rows = () => buildCapabilities({ ops: [], routes: [], packages: [pod], skills });
const catalog = () =>
  capabilityCatalogSchema.parse({
    at: "2026-10-13T15:00:00.000Z",
    machine: machineFixture(),
    sources: {},
    diagnostics: [],
    capabilities: rows(),
  });
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

test("renamed package content keeps all four canonical kinds with no native availability", () => {
  const current = rows().filter((row) => row.package?.id === pod.id);
  expect(current.map((row) => row.key).sort()).toEqual(pod.contributions.map((c) => c.key).sort());
  expect(current.find((row) => row.kind === "member")).toMatchObject({
    needs: "nothing",
    mutates: false,
  });
  expect(
    buildCapabilities({
      ops: [],
      routes: [],
      packages: [{ ...pod, folder: "other-folder" }],
      skills,
    }),
  ).toEqual(rows());
});

test("public MCP and CLI rank one canonical snapshot with the shared ranker", async () => {
  fakeRuntimeHost("http://127.0.0.1:9");
  vi.stubEnv("PE_CONTEXT", "");
  vi.stubGlobal("fetch", async () => Response.json(catalog()));
  const expected = findCapabilities(catalog().capabilities, { query: "duct loss", limit: 8 }).map(
    (r) => r.key,
  );
  const found = (await peFind.execute({ query: "duct loss", limit: 8 }, undefined)) as {
    matches: { key: string }[];
  };
  expect(found.matches.map((r) => r.key)).toEqual(expected);
  expect(found.matches).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        key: "page:@snowdon-ducts/pages/tour",
        projection: { openUrl: "/pages/host-projected/", pane: "page" },
      }),
    ]),
  );
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  await cli(
    ["duct", "loss", "--json"],
    new PeaCliCommands({ hostBaseUrl: "http://127.0.0.1:9" }).findCommand(),
  );
  expect(JSON.parse(output.mock.calls[0]![0]).map((r: { key: string }) => r.key)).toEqual(expected);
});

test("skill reads exact admitted bytes, members refuse execution, and old keys refuse before dispatch", async () => {
  fakeRuntimeHost("http://127.0.0.1:9");
  vi.stubEnv("PE_CONTEXT", "");
  const paths: string[] = [];
  vi.stubGlobal("fetch", async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    paths.push(url.pathname);
    if (url.pathname === "/pe/capabilities") return Response.json(catalog());
    expect(url.pathname).toBe("/pe/contributions");
    expect(url.searchParams.get("sha256")).toBe(sha256);
    return Response.json({
      content: bytes.toString(),
      bytesBase64: bytes.toString("base64"),
      sha256,
    });
  });
  const read = await peRead.execute({ key: skills[0]!.key, timeoutSeconds: 30 }, undefined);
  expect(read).toMatchObject({
    ok: true,
    result: bytes.toString(),
    bytesBase64: bytes.toString("base64"),
  });
  expect(
    await peDo.execute({ key: pod.contributions[3]!.key, timeoutSeconds: 30 }, undefined),
  ).toMatchObject({ ok: false, content: expect.stringMatching(/cannot execute/) });
  const calls = paths.length;
  for (const key of ["pod:renamed-local.run", "skill:build-pod"])
    expect(await peDo.execute({ key, timeoutSeconds: 30 }, undefined)).toMatchObject({
      ok: false,
      content: expect.stringMatching(/Legacy/),
    });
  expect(paths).toHaveLength(calls);
});

test("Page shelf follows its projected URL and never borrows the Page action door", async () => {
  fakeRuntimeHost("http://127.0.0.1:9");
  vi.stubEnv("PE_CONTEXT", "");
  const paths: string[] = [];
  vi.stubGlobal("fetch", async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    paths.push(url.pathname);
    if (url.pathname === "/pe/capabilities") return Response.json(catalog());
    return Response.json({ text: "Page text" });
  });
  expect(
    await peRead.execute({ key: pod.contributions[1]!.key, timeoutSeconds: 30 }, undefined),
  ).toMatchObject({ ok: true, result: { state: { text: "Page text" } } });
  await peDo.execute(
    { key: pod.contributions[1]!.key, input: { event: { text: "note" } }, timeoutSeconds: 30 },
    undefined,
  );
  await peDo.execute(
    {
      key: pod.contributions[1]!.key,
      input: { binding: { kind: "pinned", address: "C:/Ducts.rvt" } },
      timeoutSeconds: 30,
    },
    undefined,
  );
  expect(paths).toContain("/pages/host-projected/events");
  expect(paths).toContain("/pe/pages/host-projected/binding");
  expect(paths.some((p) => p.endsWith("/act") || p.endsWith("/call"))).toBe(false);
});
