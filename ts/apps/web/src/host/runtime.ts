import {
  HOST_RUNTIME_SERVICE_HEADER,
  HOST_RUNTIME_SERVICE_QUERY,
} from "@pe/host-contracts/contracts";
import { z } from "zod";
import { webBuildStamp } from "./build-stamp";
import { currentFixture } from "#/shell/fixture-lane";

// Frozen into the served page's module graph: a reused port must never change its owner.
const serviceName: string = import.meta.env.PE_RUNTIME_SERVICE;

const contextRefusal = z.object({ error: z.object({ code: z.literal("context.missing") }) });
const contextReloadKey = "pe.context-reload-at";

export async function hostFetch(url: string, init?: RequestInit): Promise<Response> {
  if (currentFixture() !== null) throw Error("Fixture lane: real host requests are disabled");
  if (!serviceName) throw new Error("This page has no runtime owner.");
  const headers = new Headers(init?.headers);
  headers.set(HOST_RUNTIME_SERVICE_HEADER, serviceName);
  headers.set("x-pe-web-build", webBuildStamp.build);
  const response = await fetch(url, { ...init, headers });
  if ((init?.method ?? "GET").toUpperCase() !== "GET" && response.status === 403) {
    const body: unknown = await response
      .clone()
      .json()
      .catch(() => null);
    if (contextRefusal.safeParse(body).success) {
      try {
        const previous = sessionStorage.getItem(contextReloadKey);
        const now = Date.now();
        if (previous === null || now - Number(previous) >= 30_000) {
          // Only navigation can mint a new human browser context after a host restart.
          sessionStorage.setItem(contextReloadKey, String(now));
          window.location.reload();
        }
      } catch {
        // Without persistent throttling, leave the refusal for the caller rather than loop.
      }
    }
  }
  return response;
}

export function runtimeStreamUrl(url: string): string {
  if (currentFixture() !== null) throw Error("Fixture lane: real host streams are disabled");
  if (!serviceName) throw new Error("This page has no runtime owner.");
  const bound = new URL(url, window.location.href);
  bound.searchParams.set(HOST_RUNTIME_SERVICE_QUERY, serviceName);
  return bound.href;
}
