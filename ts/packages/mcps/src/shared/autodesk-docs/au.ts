import { openBrowser, type BrowserPage } from "@pe/browser";
import { plainText } from "./text.ts";
import type { DocsHit } from "./types.ts";
import { z } from "zod";

const auOrigin = "https://www.autodesk.com";
const classPrefix = `${auOrigin}/autodesk-university/class/`;

const attachmentSchema = z.object({
  fields: z.object({
    label: z.string().optional(),
    pdfUrl: z.string().optional(),
    downloadUrl: z.string().optional(),
  }),
});
const unitSchema = z.object({
  fields: z.object({
    eventId: z.string().optional(),
    eventTime: z.string().optional(),
    attachments: z.array(attachmentSchema).optional(),
    videos: z.array(z.object({ fields: z.object({ label: z.string().optional() }) })).optional(),
  }),
});
const itemSchema = z.object({
  fields: z.object({
    title: z.string(),
    slug: z.string(),
    overview: z.string().optional(),
    shortDescription: z.string().optional(),
    keywords: z.string().optional(),
    relatedProducts: z
      .array(z.object({ fields: z.object({ displayName: z.string().optional() }) }))
      .optional(),
    units: z.array(unitSchema).optional(),
  }),
});

export type AuClass = {
  title: string;
  slug: string;
  url: string;
  year?: string;
  eventId?: string;
  abstract: string;
  products: string[];
  attachments: { label: string; url: string }[];
  videoId?: string;
};

/** Trims one raw Contentful item (~20 KB each with link metadata) to what an agent needs. */
export function trimAuItem(raw: unknown): AuClass {
  const { fields } = itemSchema.parse(raw);
  const unit = fields.units?.[0]?.fields;
  const attachments = (unit?.attachments ?? []).flatMap((a) => {
    const url = a.fields.pdfUrl ?? a.fields.downloadUrl;
    return url ? [{ label: a.fields.label ?? "attachment", url }] : [];
  });
  const video = unit?.videos?.[0]?.fields.label?.match(/^brightcove:\/\/(\d+)$/)?.[1];
  return {
    title: plainText(fields.title),
    slug: fields.slug,
    url: `${classPrefix}${fields.slug}`,
    ...(unit?.eventTime ? { year: unit.eventTime.slice(0, 4) } : {}),
    ...(unit?.eventId ? { eventId: unit.eventId } : {}),
    abstract: plainText(fields.overview ?? fields.shortDescription ?? ""),
    products: (fields.relatedProducts ?? []).flatMap((p) =>
      p.fields.displayName ? [p.fields.displayName] : [],
    ),
    attachments,
    ...(video ? { videoId: video } : {}),
  };
}

export function parseAuHits(items: unknown[], max: number): DocsHit[] {
  return items.slice(0, max).map((raw) => {
    const hit = trimAuItem(raw);
    return {
      source: "au",
      title: hit.title,
      url: hit.url,
      ...(hit.year ? { date: hit.year } : {}),
      snippet: hit.abstract.slice(0, 300),
    };
  });
}

export function formatAuClass(item: AuClass): string {
  const lines = [
    `# ${item.title}`,
    `${item.url}${item.year ? ` (AU ${item.year}${item.eventId ? `, ${item.eventId}` : ""})` : ""}`,
    item.products.length ? `Products: ${item.products.join(", ")}` : "",
    "",
    item.abstract,
    "",
    "## Attachments",
    ...(item.attachments.length
      ? item.attachments.map((a) => `- ${a.label}: ${a.url}`)
      : ["(none)"]),
    item.videoId
      ? `\n## Video\nBrightcove ${item.videoId}: https://players.brightcove.net/6057940518001/default_default/index.html?videoId=${item.videoId}`
      : "",
  ];
  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function pageIsReady(page: BrowserPage): Promise<"ready" | "denied" | "loading"> {
  return page.evaluate(() => {
    if (document.getElementById("__NEXT_DATA__")) return "ready";
    return /Access Denied/i.test(document.title + document.body?.innerText.slice(0, 200))
      ? "denied"
      : "loading";
  });
}

/** Opens an AU page, passes the bot gate, and runs `use` against it. Always closes the browser. */
async function withAuPage<T>(use: (page: BrowserPage) => Promise<T>): Promise<T> {
  // Headless first; a page still denied or loading retries once in a visible window.
  for (const mode of ["headless", "visible"] as const) {
    const browser = await openBrowser({ mode });
    try {
      const page = await browser.page({ url: "about:blank" });
      // kaitpw chose this deliberately (2026-11-04), knowing it sidesteps a bot block: Akamai 403s the
      // default "HeadlessChrome" user agent, so we present the same browser as plain "Chrome". The rule
      // against evading bot blocks is not waived anywhere else; the boundary that still holds is that
      // this is one polite, low-rate, read-only GET of public AU search data per call.
      const ua = (await page.send("Browser.getVersion")).userAgent.replace(
        "HeadlessChrome",
        "Chrome",
      );
      await page.send("Network.enable");
      await page.send("Network.setUserAgentOverride", { userAgent: ua });
      await page.send("Page.navigate", {
        url: `${auOrigin}/autodesk-university/search?query=revit`,
      });
      // Poll in short evaluates: one running past ~15 s kills the page's JavaScript. 30 s per mode:
      // a 20 s budget timed out in both modes once in the field (2026-11-04), then passed in 26 s.
      let state: Awaited<ReturnType<typeof pageIsReady>> = "loading";
      for (let attempt = 0; attempt < 60 && state === "loading"; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        state = await pageIsReady(page).catch(() => "loading" as const);
      }
      if (state === "ready") return await use(page);
      if (mode === "visible") throw new Error(`AU page did not load (${state}) even when visible.`);
    } finally {
      await browser.close();
    }
  }
  throw new Error("unreachable");
}

type AuFetchResult = { status: number; json: unknown };

/** One same-origin `_next/data` GET from inside the page; the buildId rotates per AU deploy, so read it fresh. */
async function auData(page: BrowserPage, path: string, params: string): Promise<AuFetchResult> {
  return page.evaluate(
    async (dataPath: string, query: string) => {
      const next = JSON.parse(document.getElementById("__NEXT_DATA__")!.textContent!) as {
        buildId: string;
      };
      const response = await fetch(
        `/autodesk-university/_next/data/${next.buildId}/en/${dataPath}.json${query}`,
      );
      return { status: response.status, json: response.ok ? await response.json() : null };
    },
    path,
    params,
  );
}

const searchPropsSchema = z.object({ pageProps: z.object({ items: z.array(z.unknown()) }) });

async function searchAuItems(
  page: BrowserPage,
  input: { query: string; year?: number },
): Promise<unknown[]> {
  const params = new URLSearchParams({ query: input.query, sort: "year,desc" });
  if (input.year) params.set("fields.year", String(input.year));
  const { status, json } = await auData(page, "search", `?${params}`);
  if (status !== 200) throw new Error(`AU search failed: HTTP ${status}`);
  // An invalid parameter answers 200 with pageProps lacking `items`; schema parse makes that an error.
  return searchPropsSchema.parse(json).pageProps.items;
}

export function searchAu(input: { query: string; year?: number; max: number }): Promise<DocsHit[]> {
  return withAuPage(async (page) => parseAuHits(await searchAuItems(page, input), input.max));
}

export function auSlugOf(url: string): string {
  const match = /\/autodesk-university\/class\/([^/?#]+)/.exec(url);
  if (!match) throw new Error(`Not an AU class URL: ${url}`);
  return match[1]!;
}

const classPropsSchema = z.object({
  pageProps: z.object({ classData: z.unknown() }).passthrough(),
});

export function fetchAuClass(url: string): Promise<string> {
  const slug = auSlugOf(url);
  return withAuPage(async (page) => {
    const direct = await auData(page, `class/${slug}`, "");
    if (direct.status === 200) {
      const props = classPropsSchema.safeParse(direct.json);
      if (props.success) return formatAuClass(trimAuItem(props.data.pageProps.classData));
    }
    // Fall back to the search hit: the title is the slug minus its year suffix.
    const title = slug.replace(/-\d{4}$/, "").replace(/-/g, " ");
    const year = Number(/-(\d{4})$/.exec(slug)?.[1]);
    const items = await searchAuItems(page, { query: title, year: year || undefined });
    const item = items.find((raw) => itemSchema.parse(raw).fields.slug === slug);
    if (!item) throw new Error(`AU class not found: ${slug}`);
    return formatAuClass(trimAuItem(item));
  });
}
