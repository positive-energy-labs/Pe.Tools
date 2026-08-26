import { readFileSync } from "node:fs";
import path from "node:path";
import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerResponse as Response } from "effect/unstable/http";
import { expect, test, vi } from "vite-plus/test";
import { sourceHostServiceName } from "@pe/host-contracts/service-identity";
import { makeHttpLive, NoRevitBoundaryLive } from "../src/app.ts";
import {
  NO_REVIT_ARGUMENT,
  resolveHostCapabilities,
  serviceNameForCapabilities,
} from "../src/host-ownership.ts";
import { makeMastraRuntimeLive, MastraRuntime } from "../src/mastra-runtime.ts";

test("dev:no-revit uses the shared source entrypoint and a distinct dev receipt", () => {
  const rootPackage = readPackage(path.resolve(import.meta.dirname, "../../..", "package.json"));
  const hostPackage = readPackage(path.resolve(import.meta.dirname, "..", "package.json"));
  const sourceRoot = "C:\\Users\\Alice\\Repo\\source\\pe-tools";
  const defaultCapabilities = resolveHostCapabilities(["node", "src/dev.ts"]);
  const noRevitCapabilities = resolveHostCapabilities([
    "node",
    "src/dev.ts",
    "--take-over-host",
    NO_REVIT_ARGUMENT,
  ]);
  const defaultServiceName = sourceHostServiceName(sourceRoot);

  expect(rootPackage.scripts?.["dev:no-revit"]).toBe("pnpm --filter @pe/host dev:no-revit");
  expect(hostPackage.scripts?.["dev:no-revit"]).toBe(
    "vp exec node --watch-path=src --import jiti/register src/dev.ts --take-over-host --no-revit",
  );
  expect(defaultCapabilities).toEqual({ revit: true });
  expect(noRevitCapabilities).toEqual({ revit: false });
  expect(defaultServiceName).toMatch(/^host-source-[a-f0-9]{12}$/);
  expect(serviceNameForCapabilities(defaultServiceName, defaultCapabilities)).toBe(
    defaultServiceName,
  );
  expect(serviceNameForCapabilities(defaultServiceName, noRevitCapabilities)).toBe(
    `${defaultServiceName}-no-revit`,
  );
});

test("no-Revit composition never touches contact factories", () => {
  const contactFactory = vi.fn(() => {
    throw new Error("SDK/proxy/contact factory touched");
  });
  const capabilities = { revit: false } as const;

  expect(() => makeMastraRuntimeLive(capabilities, contactFactory)).not.toThrow();
  expect(() =>
    makeHttpLive({
      capabilities,
      lifecycle: { latch: null as never, handle: null as never },
      mastraLayer: Layer.succeed(MastraRuntime, {
        fetch: async () => new globalThis.Response(null, { status: 404 }),
      }),
      port: 0,
      revitCompositionFactory: contactFactory,
      webRoot: null,
    }),
  ).not.toThrow();
  expect(contactFactory).not.toHaveBeenCalled();

  expect(() =>
    makeHttpLive({
      capabilities: { revit: true },
      lifecycle: { latch: null as never, handle: null as never },
      mastraLayer: Layer.succeed(MastraRuntime, {
        fetch: async () => new globalThis.Response(null, { status: 404 }),
      }),
      port: 0,
      revitCompositionFactory: contactFactory,
      webRoot: null,
    }),
  ).toThrow("SDK/proxy/contact factory touched");
  expect(contactFactory).toHaveBeenCalledOnce();
});

test("no-Revit routes return empty 404 before the web fallback", async () => {
  const fallback = HttpRouter.add("*", "/*", Effect.succeed(Response.text("vite fallback")));
  const web = HttpRouter.toWebHandler(Layer.mergeAll(NoRevitBoundaryLive, fallback), {
    disableLogger: true,
  });

  try {
    for (const pathName of [
      "/api/bridge",
      "/call",
      "/ops",
      "/sessions",
      "/events",
      "/schemas/settings/module/root.json",
      "/host/install",
      "/host/update",
    ]) {
      const response = await web.handler(new Request(`http://host.test${pathName}`));
      expect(response.status, pathName).toBe(404);
      expect(await response.text(), pathName).toBe("");
    }

    const websocket = await web.handler(
      new Request("http://host.test/api/bridge", { headers: { upgrade: "websocket" } }),
    );
    expect(websocket.status).toBe(404);
    expect(await websocket.text()).toBe("");

    const fallbackResponse = await web.handler(new Request("http://host.test/calls"));
    expect(fallbackResponse.status).toBe(200);
    expect(await fallbackResponse.text()).toBe("vite fallback");
  } finally {
    await web.dispose();
  }
});

function readPackage(file: string): { scripts?: Record<string, string> } {
  return JSON.parse(readFileSync(file, "utf8")) as { scripts?: Record<string, string> };
}
