import { createHash } from "node:crypto";
import { afterEach, expect, test, vi } from "vite-plus/test";
import {
  capabilityCatalogSchema,
  declaredScriptRun,
  type PackageProjection,
} from "@pe/agent-contracts";
import { machineFixture } from "../../agent-contracts/tests/machine-fixture.ts";
import { buildCapabilities } from "../src/pea/capabilities.ts";
import { skillSnapshot } from "../src/pea/skill-publication.ts";
import { peDo, peRead } from "../src/pea/capability-tools.ts";
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

test("skill reads exact admitted bytes, members refuse execution, and old keys refuse before dispatch", async () => {
  fakeRuntimeHost("http://127.0.0.1:9");
  vi.stubEnv("PE_CONTEXT", "");
  const paths: string[] = [];
  let returnedHash = sha256;
  vi.stubGlobal("fetch", async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    paths.push(url.pathname);
    if (url.pathname === "/pe/capabilities") return Response.json(catalog());
    expect(url.pathname).toBe("/pe/contributions");
    expect(url.searchParams.get("sha256")).toBe(sha256);
    return Response.json({
      content: bytes.toString(),
      bytesBase64: bytes.toString("base64"),
      sha256: returnedHash,
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
  returnedHash = "0".repeat(64);
  expect(
    await peRead.execute({ key: skills[0]!.key, timeoutSeconds: 30 }, undefined),
  ).toMatchObject({
    ok: false,
    content: expect.stringMatching(/revision|admitted/i),
  });
});

// Contract C1, Pea's script door. Mutants, each run red once: restore `effect: "command"` for every
// script row in `packageRows` (pe_read refuses the check); drop the ReadOnly refusal in
// `declaredScriptRun` (the write is sent); spread the whole payload there (scriptContent crosses);
// drop `input` from what it passes.
test("a ReadOnly entrypoint is a read Pea runs with pe_read, with its input, and never as a write", async () => {
  fakeRuntimeHost("http://127.0.0.1:9");
  vi.stubEnv("PE_CONTEXT", "");
  const check = "script:@snowdon-ducts/pages/tour/checks/census.csx";
  const withCheck: PackageProjection = {
    ...pod,
    members: [...pod.members, { path: "pages/tour/checks/census.csx", sha256, sizeBytes: 1 }],
    contributions: [
      ...pod.contributions,
      {
        key: check,
        sourcePath: "pages/tour/checks/census.csx",
        title: "Duct check",
        description: "",
        mode: "ReadOnly",
      },
    ],
  };
  const built = buildCapabilities({ ops: [], routes: [], packages: [withCheck], skills });
  expect(built.find((row) => row.key === check)).toMatchObject({
    effect: "query",
    mutates: false,
    mode: "ReadOnly",
    input: { properties: { input: { type: "object" } } },
  });
  expect(built.find((row) => row.key === pod.contributions[0]!.key)).toMatchObject({
    effect: "command",
    mutates: true,
  });
  const calls: { path: string; body: unknown }[] = [];
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    const body = request.method === "GET" ? undefined : await request.json().catch(() => undefined);
    calls.push({ path: url.pathname, body });
    if (url.pathname === "/pe/capabilities")
      return Response.json({ ...catalog(), capabilities: built });
    if (url.pathname === "/pe/contributions")
      return Response.json({
        content: "Result(1);",
        bytesBase64: "",
        sha256,
        folder: "renamed-local",
        sourceBundle: { files: [] },
      });
    if (request.method === "GET" && url.pathname.endsWith("/actions")) return Response.json([]);
    return Response.json({ ok: true });
  });
  // A script that declares no mode is still a command: pe_read refuses it and nothing is sent.
  expect(
    await peRead.execute({ key: pod.contributions[0]!.key, timeoutSeconds: 30 }, undefined),
  ).toMatchObject({ ok: false, content: expect.stringMatching(/pe_do/) });
  for (const tool of [peRead, peDo])
    expect(
      await tool.execute(
        { key: check, input: { permissionMode: "WriteTransaction" }, timeoutSeconds: 30 },
        undefined,
      ),
    ).toMatchObject({ ok: false, content: expect.stringMatching(/declared ReadOnly in pod.json/) });
  // Refused before the admitted bytes are even read.
  expect(calls.some((call) => call.path === "/pe/contributions")).toBe(false);
  // What crosses for a declared script: its input, the mode and the timeout. The source never does.
  expect(
    declaredScriptRun(built.find((row) => row.key === check)!, {
      input: { level: "L2" },
      scriptContent: "Result(2);",
      sourcePath: "src/Census.cs",
      sourceBundle: { files: [] },
    }),
  ).toEqual({ input: { level: "L2" }, permissionMode: "ReadOnly" });
  expect(
    declaredScriptRun({ key: "script:@a/src/B.cs" }, { permissionMode: "NoTransaction", timeoutSeconds: 9 }),
  ).toEqual({ permissionMode: "NoTransaction", timeoutSeconds: 9 });
  expect(declaredScriptRun({ key: "script:@a/src/B.cs" }, {})).toEqual({
    permissionMode: "ReadOnly",
  });
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
  ).toMatchObject({ ok: true, result: { text: "Page text" } });
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
