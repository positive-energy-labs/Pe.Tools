import { BridgeError } from "./bridge.ts";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { lstat, readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createServer } from "node:net";
import { connectCdp, openBrowser, type BrowserSession, type CdpClient } from "@pe/browser";
import type { CaptureStore } from "./captures-route.ts";
import { pagePublicationSchema, type PagePublication } from "@pe/host-contracts/pe-api";
import { validatePageHtml, writeArtifact } from "./page-artifacts.ts";

export const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (value) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[value]!,
  );

/** Serving and preview use the same host-minted identity without changing authored bytes. */
export function withPageKey(html: string, page: string) {
  const icon = /<link\b[^>]*\brel=["'][^"']*\bicon\b/i.test(html)
    ? ""
    : '<link rel="icon" href="data:,">';
  const meta = `<meta name="pe-page" content="${escapeHtml(page)}">${icon}`;
  const head = /<head[^>]*>/i.exec(html) ?? /^\s*<!doctype[^>]*>/i.exec(html);
  if (!head) return `${meta}${html}`;
  const end = head.index + head[0].length;
  return `${html.slice(0, end)}${meta}${html.slice(end)}`;
}

/** Publication cannot follow a redirected ancestor, including its configured Pages root. */
async function ordinaryPath(path: string) {
  for (let current = resolve(path); ; current = dirname(current)) {
    const info = await lstat(current).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
      return null;
    });
    if (info?.isSymbolicLink()) throw Error(`Page publication refuses a symlink: ${current}`);
    if (dirname(current) === current) return;
  }
}

/** A fresh ephemeral context receives only authored HTML and public libraries, never caller auth. */
async function capturePage(
  input: PagePublication,
  origin: string,
  library: (path: string) => string | null,
) {
  const executablePath = [
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  ].find(existsSync);
  if (!executablePath)
    throw Error("Page capture requires an installed Microsoft Edge; no browser was downloaded");
  // Page Fetch does not cover every worker, popup or WebSocket. This proxy never forwards,
  // and <-loopback> removes Chromium's implicit localhost bypass for every browser target.
  const deny = createServer((socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    deny.once("error", reject);
    deny.listen(0, "127.0.0.1", () => {
      deny.removeListener("error", reject);
      resolve();
    });
  });
  const address = deny.address();
  if (!address || typeof address === "string") throw Error("Page capture proxy has no port");
  let browser: BrowserSession | undefined;
  let unsubscribe: (() => void) | undefined;
  let observer: CdpClient | undefined;
  let observing = false;
  let stopObservation: Promise<unknown> | undefined;
  const stopObserving = () =>
    observing && observer
      ? (stopObservation ??= observer.sendRaw(
          "Target.setAutoAttach",
          {
            autoAttach: false,
            waitForDebuggerOnStart: false,
            flatten: true,
          },
          { timeoutMs: 5_000 },
        ))
      : Promise.resolve();
  const bounded = async <T>(work: Promise<T>, ms: number, message: string): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        work,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(Error(message)), ms);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    browser = await openBrowser({
      executablePath,
      mode: "headless",
      timeoutMs: 10_000,
      args: [
        `--proxy-server=http://127.0.0.1:${address.port}`,
        "--proxy-bypass-list=<-loopback>",
        "--disable-quic",
      ],
    });
    return await bounded(
      (async () => {
        const page = await browser!.page();
        const failures: string[] = [];
        const pending = new Set<Promise<void>>();
        const url = `${origin}/pages/${input.slug}/`;
        let loaded!: () => void;
        const load = new Promise<void>((resolve) => {
          loaded = resolve;
        });
        const intercept = async (event: Record<string, unknown>) => {
          const requestId = event.requestId as string;
          const request = event.request as { url: string; method: string };
          const blocked = async (why: string) => {
            if (
              ["Document", "Script", "Stylesheet", "Image", "Font", "Media"].includes(
                event.resourceType as string,
              )
            )
              failures.push(`${why}: ${request.url}`);
            await page.send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" });
          };
          const destination = new URL(request.url);
          if (destination.origin !== origin || request.method !== "GET")
            return blocked("Preview blocked asset");
          let body: string | null;
          try {
            body =
              request.url === url
                ? withPageKey(input.html, `page:@pages/${input.slug}`)
                : library(destination.pathname);
          } catch (error) {
            failures.push(`Page library ${destination.pathname}: ${(error as Error).message}`);
            await page.send("Fetch.failRequest", { requestId, errorReason: "Failed" });
            return;
          }
          if (body === null)
            return blocked("Preview requires self-contained HTML or a public Page library");
          await page.send("Fetch.fulfillRequest", {
            requestId,
            responseCode: 200,
            responseHeaders: [
              {
                name: "Content-Type",
                value:
                  request.url === url
                    ? "text/html; charset=utf-8"
                    : destination.pathname.endsWith(".css")
                      ? "text/css"
                      : "text/javascript",
              },
              // Service workers require HTTP(S) script URLs; only self-contained compute workers
              // may start outside page Fetch. Their networking still meets the deny proxy.
              ...(request.url === url
                ? [{ name: "Content-Security-Policy", value: "worker-src blob: data:" }]
                : []),
            ],
            body: Buffer.from(body).toString("base64"),
          });
        };
        unsubscribe = page.subscribe((event) => {
          if (event.method === "Page.loadEventFired") loaded();
          if (event.method === "Page.windowOpen")
            failures.push(`Preview blocked document: ${String(event.params.url)}`);
          if (event.method === "Runtime.exceptionThrown") {
            const detail = event.params.exceptionDetails as {
              text: string;
              exception?: { description?: string };
            };
            failures.push(detail.exception?.description ?? detail.text);
          }
          if (event.method === "Fetch.requestPaused") {
            const task = intercept(event.params).catch((error: Error) => {
              failures.push(`Page interception failed: ${error.message}`);
            });
            pending.add(task);
            void task.finally(() => pending.delete(task));
          }
        });
        // A separate owned-page CDP session can route flattened worker commands. BrowserPage
        // deliberately does not allow a caller to override its sessionId.
        const target = (await browser!.targets()).find((target) => target.id === page.targetId);
        if (!target?.webSocketDebuggerUrl)
          throw Error("Page capture has no worker observation endpoint");
        observer = await connectCdp(target.webSocketDebuggerUrl, { timeoutMs: 5_000 });
        const workerPolicy = {
          autoAttach: true,
          waitForDebuggerOnStart: true,
          flatten: true,
          filter: [{ type: "worker" }, { type: "shared_worker" }, { exclude: true }],
        };
        observer.subscribe((event) => {
          if (event.method === "Runtime.exceptionThrown") {
            const detail = event.params.exceptionDetails as {
              text: string;
              exception?: { description?: string };
            };
            failures.push(detail.exception?.description ?? detail.text);
          }
          if (event.method === "Target.attachedToTarget") {
            const command = { sessionId: event.params.sessionId as string, timeoutMs: 5_000 };
            const task = (async () => {
              await observer!.sendRaw("Runtime.enable", {}, command);
              await observer!.sendRaw("Target.setAutoAttach", workerPolicy, command);
              await observer!.sendRaw("Runtime.runIfWaitingForDebugger", {}, command);
            })().catch((error: Error) => {
              failures.push(`Page worker observation failed: ${error.message}`);
            });
            pending.add(task);
            void task.finally(() => pending.delete(task));
          }
        });
        observing = true; // Even a timeout can leave acquisition applied; cleanup must undo it.
        await observer.sendRaw("Target.setAutoAttach", workerPolicy, { timeoutMs: 5_000 });
        await page.send("Runtime.enable");
        await page.send("Page.enable");
        await page.send("Network.enable");
        await page.send("Network.setBypassServiceWorker", { bypass: true });
        await page.send("Emulation.setDeviceMetricsOverride", {
          width: input.width ?? 1000,
          height: 700,
          deviceScaleFactor: 1,
          mobile: false,
        });
        await page.send("Fetch.enable", {
          patterns: [{ urlPattern: "*", requestStage: "Request" }],
        });
        await bounded(
          (async () => {
            const navigation = await page.send("Page.navigate", { url });
            if (navigation.errorText) throw Error(navigation.errorText);
            await load;
          })(),
          10_000,
          "Page navigation exceeded its 10 second deadline",
        );
        await page.evaluate(async () => {
          const pe = (globalThis as unknown as { pe?: { kitReady?: Promise<unknown> } }).pe;
          await pe?.kitReady;
          await document.fonts.ready;
          await new Promise<void>((done) =>
            requestAnimationFrame(() => requestAnimationFrame(() => done())),
          );
          // Match disabled-animation screenshots: finite animations finish, infinite ones reset.
          for (const animation of document.getAnimations()) {
            if (Number.isFinite(animation.effect?.getComputedTiming().endTime)) animation.finish();
            else animation.cancel();
          }
          return null;
        });
        const height = await page.evaluate(() =>
          Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0),
        );
        const { cssContentSize } = await page.send("Page.getLayoutMetrics");
        if (Math.max(height, cssContentSize.height) > 10_000)
          throw Error("Page capture exceeds the 10000px height limit");
        const screenshot = (await page.sendRaw(
          "Page.captureScreenshot",
          {
            format: "png",
            captureBeyondViewport: true,
            clip: {
              ...cssContentSize,
              width: Math.max(input.width ?? 1000, cssContentSize.width),
              scale: 1,
            },
          },
          { timeoutMs: 5_000 },
        )) as { data: string };
        await page.send("Page.stopLoading");
        await stopObserving();
        while (pending.size) await Promise.all(pending);
        const png = Buffer.from(screenshot.data, "base64");
        if (png.byteLength > 10 * 1024 * 1024)
          throw Error("Page PNG exceeds the 10 MiB capture limit");
        if (failures.length) throw Error(failures.join("; "));
        return {
          mimeType: "image/png" as const,
          data: screenshot.data,
          width: input.width ?? 1000,
          height,
        };
      })(),
      20_000,
      "Page capture exceeded its 20 second deadline",
    );
  } catch (error) {
    const message = (error as Error).message;
    throw Error(
      message === "Page capture exceeded its 20 second deadline"
        ? message
        : `Page capture failed: ${message}`,
    );
  } finally {
    unsubscribe?.();
    try {
      try {
        try {
          await stopObserving();
        } finally {
          await observer?.close();
        }
      } finally {
        await browser?.close();
      }
    } finally {
      await new Promise<void>((resolve, reject) =>
        deny.close((error) => (error ? reject(error) : resolve())),
      );
    }
  }
}

/** Keep the exact authored HTML and existing .state; candidate capture precedes atomic replacement. */
export async function preparePagePublication(
  root: string,
  raw: unknown,
  origin: string,
  library: (path: string) => string | null,
  captures: Pick<CaptureStore, "adopt">,
) {
  const input = pagePublicationSchema.parse(raw);
  validatePageHtml(input.html);
  library("/pages/pe.js"); // The host's own Page client must render before any browser starts.
  const directory = join(resolve(root), input.slug);
  const index = join(directory, "index.html");
  await ordinaryPath(index);
  const names = await readdir(root).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  });
  if (names.some((name) => name !== input.slug && name.toLowerCase() === input.slug.toLowerCase()))
    throw Error("Page folder differs only by case from an existing Page");
  const captured = await capturePage(input, origin, library);
  const sha256 = await captures.adopt(Buffer.from(captured.data, "base64"));
  const capture = { ...captured, sha256, url: `${origin}/captures/${sha256}.png` };
  return { input, capture, origin };
}

/** The frozen version is checked at the actual file effect, after consent and capture. */
export async function pageVersion(root: string, slug: string): Promise<string | null> {
  const index = join(resolve(root), slug, "index.html");
  await ordinaryPath(index);
  const bytes = await readFile(index).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
    return null;
  });
  return bytes === null ? null : createHash("sha256").update(bytes).digest("hex");
}

export async function commitPagePublication(
  root: string,
  prepared: Awaited<ReturnType<typeof preparePagePublication>>,
  expectedVersion: string | null,
) {
  const { input, capture, origin } = prepared;
  if ((await pageVersion(root, input.slug)) !== expectedVersion)
    throw new BridgeError("Page changed after submission; read it and submit a new command", 409, {
      notDispatched: true,
    });
  await writeArtifact(root, join(resolve(root), input.slug, "index.html"), input.html, true);
  return {
    ok: true as const,
    kind: "page" as const,
    key: `page:@pages/${input.slug}`,
    slug: input.slug,
    title: input.title,
    openUrl: `${origin}/pages/${input.slug}/`,
    capture,
  };
}

/** The standalone publisher uses the same prepare and commit as the journal adapter. */
export async function publishPage(
  root: string,
  raw: unknown,
  origin: string,
  library: (path: string) => string | null,
  captures: Pick<CaptureStore, "adopt">,
) {
  const input = pagePublicationSchema.parse(raw);
  const version = await pageVersion(root, input.slug);
  return commitPagePublication(
    root,
    await preparePagePublication(root, input, origin, library, captures),
    version,
  );
}
