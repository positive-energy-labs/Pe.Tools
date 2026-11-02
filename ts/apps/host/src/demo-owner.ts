import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Effect } from "effect";
import { HttpEffect, HttpRouter } from "effect/http";
import { z } from "zod";
import { hostOpCatalog } from "@pe/host-contracts/catalog";
import { createFixtureHost } from "../../../packages/host-contracts/src/fixture-host.ts";

const json = (value: unknown, status = 200) => Response.json(value, { status });
const fixtureSeed = z.object({
  route: z.string().min(1),
  responses: z.record(z.string(), z.unknown()),
});

/** Supplied catalog responses only. No disk, SDK, native writes, or simulated model engine. */
export async function createDemoOwner(_parent: string, raw: unknown) {
  const seed = fixtureSeed.parse(raw);
  const host = createFixtureHost(hostOpCatalog, seed.responses);
  const id = `fixture-${randomUUID()}`;
  const description = { id, base: `/demo/instances/${id}`, route: seed.route, simulated: true };
  let retired = false;
  return {
    ...description,
    async fetch(request: Request) {
      if (retired) return json({ error: "Fixture instance retired" }, 410);
      if (new URL(request.url).pathname === "/description") return json(description);
      return host.fetch(request);
    },
    async dispose() {
      retired = true;
    },
  };
}

/** Explicit routes are more specific than the production declared route tenant; no second listener. */
export function demoRoutes(parent = resolve(".artifacts/tmp/demos")) {
  return HttpRouter.use((router) =>
    Effect.gen(function* () {
      const owners = new Map<string, Awaited<ReturnType<typeof createDemoOwner>>>();
      yield* Effect.addFinalizer(() =>
        Effect.promise(async () => {
          await Promise.all([...owners.values()].map((owner) => owner.dispose()));
        }),
      );
      const handler = HttpEffect.fromWebHandler(async (request) => {
        try {
          const url = new URL(request.url);
          if (url.pathname === "/demo/instances" && request.method === "POST") {
            const body = (await request.json()) as { seed?: unknown };
            if (typeof body.seed !== "string") throw Error("Encoded DemoSeed is required");
            const owner = await createDemoOwner(parent, JSON.parse(body.seed));
            owners.set(owner.id, owner);
            return owner.fetch(new Request(new URL("/description", url)));
          }
          const match = /^\/demo\/instances\/([^/]+)(\/.*)?$/.exec(url.pathname);
          const owner = match ? owners.get(match[1]!) : undefined;
          if (!owner && request.method === "DELETE" && match && !match[2])
            return json({ retired: match[1] });
          if (!owner) return json({ error: "Unknown isolated demo instance" }, 404);
          if (request.method === "DELETE" && !match![2]) {
            await owner.dispose();
            owners.delete(owner.id);
            return json({ retired: owner.id });
          }
          url.pathname = match![2] ?? "/description";
          return await owner.fetch(
            new Request(url, {
              method: request.method,
              headers: request.headers,
              signal: request.signal,
              ...(request.method === "GET" || request.method === "HEAD"
                ? {}
                : { body: await request.arrayBuffer() }),
            }),
          );
        } catch (error) {
          // effect-edge: island, phase 5
          await Effect.runPromise(Effect.logError("Fixture request refused", error));
          return json({ error: String(error) }, 409);
        }
      });
      yield* router.add("*", "/demo/instances/*", handler);
    }),
  );
}
