import { expect, test, vi } from "vite-plus/test";
import { z } from "zod";
import { HOST_RPC_BRIDGE_SESSION_HEADER } from "@pe/host-contracts/operation-types";
import {
  capabilityMap,
  findCapabilities,
  turnContextKey,
  type CapabilityCatalog,
} from "@pe/agent-contracts";
import { buildCapabilities } from "../src/pea/capabilities.ts";
import { createRouteRegistrations } from "../src/pea/routes.ts";
import { bundledPeaSkills } from "../src/pea/skills.ts";
import { peDo, peFind, peRead } from "../src/pea/capability-tools.ts";

const ops = [
  {
    key: "revit.catalog.loaded-families",
    displayName: "Loaded families",
    description: "Inventory of loaded families.",
    needs: "project-document" as const,
    intent: "Read" as const,
    visibility: "ExpertOnly" as const,
    requestSchemaJson: JSON.stringify({ type: "object", title: "LoadedFamiliesRequest" }),
  },
  {
    key: "scripting.execute",
    description: "Run C#.",
    needs: "document" as const,
    intent: "Mutate" as const,
  },
];

const pods = {
  workspacesRootPath: "C:/pods",
  pods: [
    {
      workspaceKey: "sheets",
      workspaceRootPath: "C:/pods/sheets",
      isValid: true,
      manifest: {
        schemaVersion: 1,
        id: "sheets",
        name: "Sheet tools",
        version: "1.0.0",
        entrypoints: [{ id: "rename", sourcePath: "src/Rename.cs", name: "Rename sheets" }],
      },
      diagnostics: [],
    },
    {
      workspaceKey: "broken",
      workspaceRootPath: "C:/pods/broken",
      isValid: false,
      manifest: null,
      diagnostics: [{ stage: "manifest", severity: "Error" as const, message: "bad json" }],
    },
  ],
};

function catalog(): CapabilityCatalog {
  return {
    at: "2026-09-04T00:00:00.000Z",
    sessions: [{ sessionId: "b1", custody: "observed", sdkSessionId: "dev" }],
    sources: { catalog: "ok" },
    capabilities: buildCapabilities({
      ops,
      routes: createRouteRegistrations({ hostBaseUrl: "http://127.0.0.1:9" }).map(
        (registration) => registration.spec,
      ),
      pods,
      skills: bundledPeaSkills,
    }),
  };
}

test("every source projects into one row shape with no hidden tier", () => {
  const rows = catalog().capabilities;
  const keys = rows.map((row) => row.key);
  // An ExpertOnly op and a scripting.* op are plain rows now; the tier is a rank, not a filter.
  expect(rows.find((row) => row.key === "op:revit.catalog.loaded-families")?.rank).toBe(0);
  expect(keys).toContain("op:scripting.execute");
  expect(keys).toContain("route:instances");
  expect(keys).toContain("route:instances.propose");
  expect(rows.find((row) => row.key === "route:instances.start")).toMatchObject({
    kind: "route-command",
    actor: "any",
    mutates: true,
  });
  expect(rows.find((row) => row.key === "route:instances.stop")?.actor).toBe("human");
  expect(keys).toContain("route:pods.run");
  // Only valid pods become buttons; invalid ones are absent, not hidden.
  expect(rows.filter((row) => row.kind === "pod").map((row) => row.key)).toEqual([
    "pod:sheets.rename",
  ]);
  expect(keys).toContain("skill:build-pod");
  expect(new Set(keys).size).toBe(keys.length);
  for (const row of rows)
    expect(z.record(z.string(), z.unknown()).safeParse(row.input).success).toBe(true);
});

test("no query gives the map; a query ranks across kinds; needs filters replace hiding", () => {
  const rows = catalog().capabilities;
  const map = capabilityMap(rows);
  expect(map.kinds.map((kind) => kind.kind)).toEqual([
    "op",
    "route-doc",
    "route-command",
    "pod",
    "skill",
  ]);
  expect(map.total).toBe(rows.length);
  expect(findCapabilities(rows, { query: "loaded families" })[0]?.key).toBe(
    "op:revit.catalog.loaded-families",
  );
  expect(findCapabilities(rows, { query: "rename sheets" })[0]?.key).toBe("pod:sheets.rename");
  expect(findCapabilities(rows, { query: "start revit", kind: "route-command" })[0]?.key).toBe(
    "route:instances.start",
  );
  expect(
    findCapabilities(rows, { needs: "project-document" }).every(
      (row) => row.needs === "project-document",
    ),
  ).toBe(true);
});

type ExecutableTool = { execute?: (input: never, context: never) => Promise<unknown> };
const turn = {
  id: "11111111-1111-4111-8111-111111111111",
  thread: "t1",
  scope: { kind: "document", document: "C:\\Models\\A.rvt", pin: "dev" },
  revision: 4,
};
const run = (tool: ExecutableTool, input: unknown) =>
  tool.execute!(
    input as never,
    { agent: { toolCallId: "call-1" }, requestContext: { [turnContextKey]: turn } } as never,
  );

test("the doors ride the host under the turn's Scope and name the revision and resolved target", async () => {
  vi.stubEnv("PE_TOOLS_HOST_BASE_URL", "http://127.0.0.1:9");
  const calls: Array<{ method: string; url: URL; headers: Headers; body?: unknown }> = [];
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    calls.push({
      method: init?.method ?? "GET",
      url,
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    if (url.pathname === "/pe/capabilities") return Response.json(catalog());
    if (url.pathname === "/call")
      return Response.json(
        { families: 3 },
        {
          headers: {
            "x-pe-resolved-session": "dev",
            "x-pe-resolved-document": encodeURIComponent("C:\\Models\\A.rvt"),
          },
        },
      );
    if (url.pathname.startsWith("/pe/route-state/instances"))
      return Response.json({ revision: 2, doc: { selectedSession: null } });
    return Response.json({ ok: true, revision: 3 });
  });
  try {
    const map = (await run(peFind, {})) as {
      map: { total: number };
      sessions: unknown[];
      revision: number;
    };
    expect(map.map.total).toBeGreaterThan(10);
    expect(map.sessions).toHaveLength(1);
    expect(map.revision).toBe(4);
    // The catalog is read for the turn's Scope, never for a model-typed selector.
    expect(calls[0]?.url.search).toBe("?doc=C%3A%5CModels%5CA.rvt&pin=dev");

    const op = (await run(peRead, {
      key: "op:revit.catalog.loaded-families",
      timeoutSeconds: 30,
    })) as { ok: boolean; revision: number; target: { session: string; document: string } };
    expect(op.ok).toBe(true);
    expect(op.revision).toBe(4);
    expect(op.target).toEqual({ session: "dev", document: "C:\\Models\\A.rvt" });
    expect(calls.at(-1)?.headers.get(HOST_RPC_BRIDGE_SESSION_HEADER)).toBe(
      "pin:dev|doc:C:\\Models\\A.rvt",
    );
    expect(calls.at(-1)?.body).toEqual({ key: "revit.catalog.loaded-families", request: {} });

    const mutating = (await run(peRead, { key: "op:scripting.execute", timeoutSeconds: 30 })) as {
      isError: boolean;
      content: string;
    };
    expect(mutating.isError).toBe(true);
    expect(mutating.content).toContain("pe_do");

    const read = (await run(peRead, { key: "route:instances", timeoutSeconds: 30 })) as {
      ok: boolean;
      target: { session: string };
    };
    expect(read.ok).toBe(true);
    expect(read.target.session).toBe("dev");
    expect(calls.at(-1)?.url.pathname).toBe("/pe/route-state/instances");
    expect(calls.at(-1)?.url.search).toBe("?doc=C%3A%5CModels%5CA.rvt&pin=dev");

    const command = (await run(peDo, { key: "route:instances.refresh", timeoutSeconds: 30 })) as {
      ok: boolean;
    };
    expect(command.ok).toBe(true);
    expect(calls.at(-1)?.url.pathname).toBe("/pe/agent/route-state/instances/command");
    // No expectedRevision given: the command runs against the current revision it just read.
    expect(calls.at(-1)?.body).toMatchObject({ command: "refresh", expectedRevision: 2 });

    const pod = (await run(peDo, { key: "pod:sheets.rename", timeoutSeconds: 30 })) as {
      ok: boolean;
    };
    expect(pod.ok).toBe(true);
    expect(calls.at(-1)?.url.pathname).toBe("/pe/agent/route-state/pods/command");
    expect(calls.at(-1)?.body).toMatchObject({
      command: "run",
      input: { entrypoint: "rename", workspaceKey: "sheets" },
    });

    const human = (await run(peDo, { key: "route:instances.stop", timeoutSeconds: 30 })) as {
      isError: boolean;
      content: string;
    };
    expect(human.isError).toBe(true);
    expect(human.content).toContain("human-only");

    const skill = (await run(peRead, { key: "skill:build-pod", timeoutSeconds: 30 })) as {
      result: string;
    };
    expect(skill.result).toContain("name: build-pod");
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});
