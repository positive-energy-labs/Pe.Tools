import { existsSync } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { isSea } from "node:sea";
import type { CaptureStore } from "./captures-route.ts";
import { pagePublicationSchema, type PagePublication } from "@pe/host-contracts/pe-api";
import { validatePageHtml, writeArtifact } from "./page-artifacts.ts";

/** Serving and preview use the same host-minted identity without changing authored bytes. */
export function withPageKey(html: string, page: string) {
  const icon = /<link\b[^>]*\brel=["'][^"']*\bicon\b/i.test(html)
    ? ""
    : '<link rel="icon" href="data:,">';
  const escaped = page.replace(
    /[&<>"']/g,
    (value) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[value]!,
  );
  const meta = `<meta name="pe-page" content="${escaped}">${icon}`;
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
  // Jiti rewrites Playwright's prebundled CJS interop; native require keeps source calls intact.
  // The SEA branch remains a declared import so the host packer includes Playwright.
  const { chromium } = isSea()
    ? await import("playwright-core")
    : (createRequire(import.meta.url)("playwright-core") as typeof import("playwright-core"));
  const browser = await chromium.launch({ executablePath, headless: true, timeout: 10_000 });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void browser.close().catch(() => undefined);
  }, 20_000);
  try {
    const context = await browser.newContext({
      viewport: { width: input.width ?? 1000, height: 700 },
      serviceWorkers: "block",
    });
    await context.routeWebSocket("**/*", (socket) => socket.close());
    const page = await context.newPage();
    const failures: string[] = [];
    page.on("pageerror", (error) => failures.push(error.message));
    const url = `${origin}/pages/${input.slug}/`;
    await context.route("**/*", async (route) => {
      const request = route.request();
      const destination = new URL(request.url());
      const blocked = (why: string) => {
        if (
          ["document", "script", "stylesheet", "image", "font", "media"].includes(
            request.resourceType(),
          )
        )
          failures.push(`${why}: ${request.url()}`);
        return route.abort("blockedbyclient");
      };
      if (destination.origin !== origin || request.method() !== "GET")
        return blocked("Preview blocked asset");
      if (request.url() === url)
        return route.fulfill({
          contentType: "text/html; charset=utf-8",
          body: withPageKey(input.html, `page:@pages/${input.slug}`),
        });
      let body: string | null;
      try {
        body = library(destination.pathname);
      } catch (error) {
        failures.push(`Page library ${destination.pathname}: ${(error as Error).message}`);
        return route.abort("failed");
      }
      if (body === null)
        return blocked("Preview requires self-contained HTML or a public Page library");
      await route.fulfill({
        contentType: destination.pathname.endsWith(".css") ? "text/css" : "text/javascript",
        body,
      });
    });
    await page.goto(url, { waitUntil: "load", timeout: 10_000 });
    await page.evaluate(async () => {
      const pe = (globalThis as unknown as { pe?: { kitReady?: Promise<unknown> } }).pe;
      await pe?.kitReady;
      await document.fonts.ready;
      await new Promise<void>((done) =>
        requestAnimationFrame(() => requestAnimationFrame(() => done())),
      );
    });
    const height = await page.evaluate(() =>
      Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0),
    );
    if (height > 10_000) throw Error("Page capture exceeds the 10000px height limit");
    const png = await page.screenshot({
      type: "png",
      fullPage: true,
      timeout: 5_000,
      animations: "disabled",
    });
    if (png.byteLength > 10 * 1024 * 1024) throw Error("Page PNG exceeds the 10 MiB capture limit");
    if (failures.length) throw Error(`Page capture failed: ${failures.join("; ")}`);
    return {
      mimeType: "image/png" as const,
      data: png.toString("base64"),
      width: input.width ?? 1000,
      height,
    };
  } catch (error) {
    throw Error(
      timedOut
        ? "Page capture exceeded its 20 second deadline"
        : `Page capture failed: ${(error as Error).message}`,
    );
  } finally {
    clearTimeout(timer);
    await browser.close();
  }
}

/** Keep the exact authored HTML and existing .state; candidate capture precedes atomic replacement. */
export async function publishPage(
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
  // Recheck after the browser yields: another writer must not redirect the publication.
  await ordinaryPath(index);
  await writeArtifact(root, index, input.html, true);
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
