import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Context, Effect, Layer } from "effect";
import { HttpRouter } from "effect/http";
import { expect, test } from "vite-plus/test";
import { HostNativeRead } from "@pe/host-internal/native-read";
import { routeFingerprint, valueReadResponse } from "@pe/agent-contracts";
import { peRouteUrl } from "@pe/agent-contracts/pe-api";
import { withInvocationContext } from "@pe/runtime/context";
import { builtinData } from "../../../packages/agent-contracts/src/route-kernel.fixtures.ts";
import { buildRouteArtifact } from "../../web/route-module-hash.ts";
import { loadPodHostEntry } from "../src/pod-artifact.ts";
import { createPodRoutes } from "../src/pod-routes.ts";
import { createPackageLifecycle } from "../src/package-lifecycle.ts";
import { listPackages } from "../src/packages.ts";
import { registeredReads } from "../src/reads/routes.ts";
import { readInputRoutes } from "../src/builtin-inputs.ts";
import { HostInputContext } from "../src/input-context.ts";
import { DuctsReadings } from "../src/ducts-readings.ts";
import { DuctFiles } from "../src/ducts-files.ts";
import { HostDocumentMarks, hostMarks } from "../src/document-marks.ts";
import { HostSessionInventory } from "../src/session-inventory.ts";
import { fileRouteDocumentStore } from "../src/route-document-store.ts";
import { RequestIdentity, admittedRequestIdentity } from "../src/request-services.ts";

test("digest-verified Pod host reads enter reads.value and retire with their Work admission", async () => {
  const root = await mkdtemp(join(tmpdir(), "pe-pod-read-"));
  const sentinel = "PE_POD_READ_HOST_LOADED",
    name = "pod.registry.value",
    leaf = "pod.registry.input";
  const data = {
    ...builtinData,
    key: "pod.registry.tool",
    address: `/tool/${encodeURIComponent("route:@registry/routes/tool/route.artifact")}`,
    work: { schema: "work", route: "pod.registry.tool", version: 1, },
  };
  const source = join(root, "host.ts"),
    zod = fileURLToPath(import.meta.resolve("zod"));
  await writeFile(
    source,
    `import {z} from ${JSON.stringify(zod)};
process.env.${sentinel} = 'loaded';
const input=z.object({}), output=z.object({total:z.number()}), work=z.object({amount:z.number()});
export const module={data:${JSON.stringify(data)},schemas:{work},
workState:{route:'pod.registry.tool',title:'Registry',description:'Host input admission',schema:work,schemaVersion:1},
reads:{value:{name:'${name}',input,output,run:(ctx)=>ctx.read({name:'${leaf}',input,output,leaf:true,validate:false},{})}},
leaves:{'${leaf}':async()=>({total:17})}};`,
  );
  const host = await buildRouteArtifact({
    entry: source,
    root,
    data,
    contracts: [
      { id: "registry-contract", bytes: new TextEncoder().encode("pod host read registration") },
    ],
  });
  const browserBytes = new TextEncoder().encode(
    "throw Error('Browser entry reached host registry')",
  );
  const executables = [
    {
      client: "host" as const,
      entry: "host.js",
      resolved: true,
      members: host.executables[0]!.members.map((member) => ({ ...member, path: "host.js" })),
    },
    {
      client: "web" as const,
      entry: "route.js",
      resolved: true,
      members: [{ path: "route.js", bytes: browserBytes }],
    },
  ];
  const artifact = {
    version: 1 as const,
    data,
    contracts: host.artifact.contracts,
    executables: executables.map((entry) => ({
      client: entry.client,
      entry: entry.entry,
      members: entry.members.map((member) => ({
        path: member.path,
        sha256: createHash("sha256").update(member.bytes).digest("hex"),
      })),
    })),
  };
  const fingerprint = `pod-bytes:${await routeFingerprint(artifact)}`;
  const wire = JSON.parse(
    JSON.stringify(
      { artifact, fingerprint: fingerprint.slice(10), contracts: host.contracts, executables },
      (_key, value) => (value instanceof Uint8Array ? [...value] : value),
    ),
  );
  const directory = join(root, "Pods/registry/routes/tool");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "route.artifact"), JSON.stringify(wire));
  await writeFile(
    join(root, "Pods/registry/pod.json"),
    JSON.stringify({
      id: "registry",
      routes: [
        {
          artifact: "routes/tool/route.artifact",
          fingerprint,
          name: "Registry",
          description: "Host graph falsifier",
        },
      ],
    }),
  );
  const lifecycle = createPackageLifecycle({
    packages: () => listPackages(join(root, "Pods")),
    decisionsPath: join(root, "enabled.json"),
  });
  let routes: ReturnType<typeof createPodRoutes> | undefined;
  const inputs = Effect.runSync(
    HostInputContext.pipe(Effect.provide(HostInputContext.layer({ kind: "live" }))),
  );
  const web = HttpRouter.toWebHandler(
    readInputRoutes(inputs, {
      store: fileRouteDocumentStore(join(root, "Work")),
      initialize: async (workspace) => {
        routes = createPodRoutes(lifecycle, { workspace, trustPath: join(root, "trust.json") });
      },
      live: {
        owner: new DuctsReadings(),
        native: Layer.succeed(HostNativeRead, {
          read: () => Effect.die("No native input"),
          resolve: () => Effect.die("No native target"),
        }),
        files: DuctFiles.layer({ firm: join(root, "Firm"), catalogs: join(root, "catalogs") }),
        marks: Layer.succeed(
          HostDocumentMarks,
          hostMarks({ observedSince: 0, changedAt: () => null, subscribe: () => () => {} }),
        ),
        inventory: Layer.succeed(HostSessionInventory, {
          list: () => Effect.die("No inventory"),
          document: () => Effect.die("No document"),
          session: () => Effect.die("No session"),
          attachment: () => Effect.die("No attachment"),
          subscribe: () => () => {},
        }),
      },
    }),
    { disableLogger: true },
  );
  const who = { kind: "human" as const, via: "local" as const };
  const probe = () =>
    withInvocationContext({ caller: who }, () =>
      web.handler(
        new Request(new URL(peRouteUrl("reads.value", {}), "http://host"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ read: name, args: {}, subscription: name, generation: 0 }),
        }),
        Context.make(RequestIdentity, admittedRequestIdentity(who, {})),
      ),
    );
  try {
    delete process.env[sentinel];
    const tampered = structuredClone(wire);
    tampered.executables[0].members[0].bytes.push(32);
    await expect(loadPodHostEntry(tampered, fingerprint)).rejects.toThrow(
      "bytes or fingerprint differ",
    );
    expect(process.env[sentinel]).toBeUndefined();
    expect(registeredReads.reads.has(name)).toBe(false);
    expect((await probe()).status).not.toBe(200); // initialize the real HTTP/Work owner
    const [row] = await routes!.list();
    await routes!.trust(row!.key, row!.fingerprint, true);
    expect(process.env[sentinel]).toBe("loaded");
    const response = await probe();
    expect(response.status, await response.clone().text()).toBe(200);
    expect(valueReadResponse.parse(await response.json())).toMatchObject({
      state: "current",
      value: { data: { total: 17 } },
    });
    const definition = registeredReads.reads.get(name)!;
    expect(() => registeredReads.register({ again: definition })).toThrow("Duplicate host read");
    expect(() =>
      registeredReads.register(
        { fresh: { ...definition, name: "pod.registry.uncommitted" } },
        { [leaf]: async () => null },
      ),
    ).toThrow("Duplicate host leaf");
    expect(registeredReads.reads.has("pod.registry.uncommitted")).toBe(false);
    await lifecycle.setEnabled("pod:registry", false);
    expect(registeredReads.reads.has(name)).toBe(false);
    expect(registeredReads.leaves[leaf]).toBeUndefined();
    expect((await probe()).status).not.toBe(200);
  } finally {
    delete process.env[sentinel];
    routes?.close();
    await web.dispose();
    await lifecycle.close();
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);
