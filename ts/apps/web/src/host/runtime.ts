import {
  HOST_RUNTIME_SERVICE_HEADER,
  HOST_RUNTIME_SERVICE_QUERY,
} from "@pe/host-contracts/contracts";
import { z } from "zod";
import { webBuildStamp } from "./build-stamp";
import { currentFixture } from "../shell/fixture-name";
import { createReadFetch } from "./read-fetch";

const readFetch = createReadFetch((...args) => fetch(...args));

// Frozen into the served page's module graph: a reused port must never change its owner.
const serviceName: string = import.meta.env.PE_RUNTIME_SERVICE;

// A door answers `{ error }`; the admission layer, ahead of every door, answers `{ refusal }`.
const contextCode = z.object({ code: z.literal("context.missing") });
const contextRefusal = z.union([z.object({ error: contextCode }), z.object({ refusal: contextCode })]);
const contextReloadKey = "pe.context-reload-at";
const refusedForContext = async (response: Response) =>
  response.status === 403 &&
  contextRefusal.safeParse(
    await response
      .clone()
      .json()
      .catch((error) => { console.error("runtime: asynchronous operation failed", error); return null; }),
  ).success;

let readmitting: Promise<void> | undefined;
/**
 * A host keeps its browser contexts in memory, so a restarted host reads this tab's cookie as
 * anonymous, and only a navigation mints a new one (host `mintBrowserContext`). This is that
 * navigation, the door a fresh load uses, in a hidden frame that runs no script: the page and
 * what the person typed stay. One at a time for the tab; it settles whether or not a context came.
 */
const readmit = () =>
  (readmitting ??= new Promise<void>((resolve) => {
    const frame = document.createElement("iframe");
    const done = () => {
      clearTimeout(timer);
      frame.remove();
      readmitting = undefined;
      resolve();
    };
    const timer = setTimeout(done, 10_000);
    frame.hidden = true;
    // Same origin so the cookie is this site's; no `allow-scripts`, so the app never boots in it.
    frame.setAttribute("sandbox", "allow-same-origin");
    frame.addEventListener("load", done, { once: true });
    frame.addEventListener("error", done, { once: true });
    frame.src = `${window.location.origin}/`;
    document.body.append(frame);
  }));

export async function hostFetch(url: string, init?: RequestInit): Promise<Response> {
  if (currentFixture() !== null) throw Error("Fixture lane: real host requests are disabled");
  if (!serviceName) throw new Error("This page has no runtime owner.");
  const headers = new Headers(init?.headers);
  if (typeof window !== "undefined") {
    const search = new URLSearchParams(window.location.search);
    const point = search.get("at");
    if (point) {
      headers.set("x-pe-history-point", headers.get("x-pe-history-point") ?? point);
      if (search.get("compare") === "now") headers.set("x-pe-history-compare", "now");
    }
  }
  headers.set(HOST_RUNTIME_SERVICE_HEADER, serviceName);
  headers.set("x-pe-web-build", webBuildStamp.build);
  const write = (init?.method ?? "GET").toUpperCase() !== "GET";
  // A write sent while a re-admission is pending waits behind the refused write it will replay,
  // so the host receives writes in the order the page sent them.
  if (write && readmitting) await readmitting;
  const response = await readFetch(url, { ...init, headers });
  if (!write || !(await refusedForContext(response))) return response;
  // A stream body is spent; every other write is sent again under the context the navigation minted.
  const again =
    init?.body instanceof ReadableStream
      ? response
      : await readmit().then(() => readFetch(url, { ...init, headers }));
  if (again === response || (await refusedForContext(again))) {
    try {
      const previous = sessionStorage.getItem(contextReloadKey);
      const now = Date.now();
      if (previous === null || now - Number(previous) >= 30_000) {
        // The frame minted nothing: fall back to navigating the page itself, at most once per 30 s.
        sessionStorage.setItem(contextReloadKey, String(now));
        window.location.reload();
      }
    } catch (error) { console.warn("ts/apps/web/src/host/runtime.ts: fallback after failure", error);
      // Without persistent throttling, leave the refusal for the caller rather than loop.
    }
  }
  return again;
}

export function runtimeStreamUrl(url: string): string {
  if (currentFixture() !== null) throw Error("Fixture lane: real host streams are disabled");
  if (!serviceName) throw new Error("This page has no runtime owner.");
  const bound = new URL(url, window.location.href);
  bound.searchParams.set(HOST_RUNTIME_SERVICE_QUERY, serviceName);
  return bound.href;
}
