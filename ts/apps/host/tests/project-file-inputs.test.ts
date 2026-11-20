import { hostState } from "../src/host-ownership.ts";
import { stateFixture } from "../../../tests/isolated-home/storage.ts";
import { afterEach, expect, test } from "vite-plus/test";
import { Context, Effect, Layer } from "effect";
import { HttpRouter } from "effect/http";
import { NodeServices } from "@effect/platform-node";
import { z } from "zod";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { projectFixture } from "./project-home-fixture.ts";
import { read, leaf } from "@pe/host-internal/read-graph";
import { registeredReads } from "../src/reads/routes.ts";
import { readInputRoutes } from "../src/builtin-inputs.ts";
import { HostInputContext } from "../src/input-context.ts";
import { HostNativeRead } from "@pe/host-internal/native-read";
import { DuctFiles } from "@pe/ducts-host/ducts-files";
import { HostDocumentMarks, hostMarks } from "../src/document-marks.ts";
import { HostSessionInventory } from "../src/session-inventory.ts";
import { DuctsReadings } from "@pe/ducts-host/ducts-readings";
import { fileRouteDocumentStore } from "../src/route-document-store.ts";
import { admittedRequestIdentity, RequestIdentity } from "@pe/host-internal/request-identity";
import { settle } from "./effect-test.ts";

const closes: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of closes.splice(0).reverse()) await close();
});

test("file inputs retain the target pointer for project Catalogs", async () => {
  const f = await projectFixture(false);
  await mkdir(join(f.project, "Catalogs", "site"), { recursive: true });
  await writeFile(join(f.project, "Catalogs", "site", "bad.json"), "{");
  const definition = read("test.project-inputs", {
    input: z.object({ name: z.string(), args: z.unknown() }),
    output: z.unknown(),
    run: (ctx, args) => ctx.read(leaf(`file:${args.name}`, z.unknown(), z.unknown()), args.args),
  });
  const unregister = registeredReads.register({ witness: definition });
  closes.push(async () => unregister());
  const inputs = await settle(
    HostInputContext.pipe(Effect.provide(HostInputContext.layer({ kind: "live" }))),
  );
  const web = HttpRouter.toWebHandler(
    readInputRoutes(inputs, {
      store: fileRouteDocumentStore(stateFixture(join(f.dir, "file-work"))),
      live: {
        owner: new DuctsReadings(),
        files: DuctFiles.layer(hostState().home),
        native: Layer.succeed(HostNativeRead, {
          resolve: () => Effect.die("Unexpected native read"),
          read: () => Effect.die("Unexpected native read"),
        }),
        marks: Layer.succeed(
          HostDocumentMarks,
          hostMarks({ changedAt: () => null, subscribe: () => () => {} }),
        ),
        inventory: Layer.succeed(HostSessionInventory, {
          document: () =>
            Effect.succeed({ ...f.target.ref, address: null, projectHome: "Projects/Example" }),
          list: () => Effect.die("Unexpected list"),
          session: () => Effect.die("Unexpected session"),
          attachment: () => Effect.die("Unexpected attachment"),
          subscribe: () => () => {},
        }),
      },
    }).pipe(Layer.provide(NodeServices.layer)),
    { disableLogger: true },
  );
  closes.push(() => web.dispose());
  const take = async (name: string, args: unknown) => {
    const response = await web.handler(
      new Request("http://fixture/pe/reads/value", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          read: definition.name,
          args: { name, args },
          subscription: crypto.randomUUID(),
          generation: 0,
        }),
      }),
      Context.make(RequestIdentity, admittedRequestIdentity({ kind: "human", via: "local" }, {})),
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const value = await response.json();
    expect(value.value, JSON.stringify(value)).toBeTruthy();
    return value.value.data;
  };
  expect(await take("catalogs", f.target.ref)).toMatchObject({
    findings: [expect.stringContaining("site")],
  });
});
