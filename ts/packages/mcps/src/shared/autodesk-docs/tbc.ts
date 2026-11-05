import { runtimeRoot } from "@pe/runtime/runtime-owner";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { htmlToText, plainText } from "./text.ts";
import type { DocsHit } from "./types.ts";

const tbcBase = "https://jeremytammik.github.io/tbc/a/";
const indexTtlMs = 7 * 24 * 60 * 60 * 1000;

export type TbcPost = { number: number; date: string; file: string; title: string };

const rowPattern =
  /<tr><td align="right">(\d+)<\/td><td>([\d-]{10})<\/td><td><a href="([^"]+)">([^<]+)<\/a>/g;

export function parseTbcIndex(html: string): TbcPost[] {
  return [...html.matchAll(rowPattern)].map((m) => ({
    number: Number(m[1]),
    date: m[2]!,
    file: m[3]!,
    title: plainText(m[4]!),
  }));
}

const tokens = (text: string): string[] => text.toLowerCase().match(/[a-z0-9]+/g) ?? [];

/** Title-only ranking: a token scores 2 as a whole word, 1 as a substring; every token must hit; ties go to newer posts. */
export function rankTbc(posts: TbcPost[], query: string, max: number): TbcPost[] {
  const wanted = tokens(query);
  if (wanted.length === 0) return [];
  const scored: { post: TbcPost; score: number }[] = [];
  for (const post of posts) {
    const words = tokens(post.title);
    let score = 0;
    for (const token of wanted) {
      const best = words.includes(token) ? 2 : words.some((w) => w.includes(token)) ? 1 : 0;
      if (best === 0) {
        score = 0;
        break;
      }
      score += best;
    }
    if (score > 0) scored.push({ post, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || b.post.date.localeCompare(a.post.date))
    .slice(0, max)
    .map((s) => s.post);
}

async function loadTbcIndex(): Promise<string> {
  const file = join(runtimeRoot(), "state", "docs-cache", "tbc-index.html");
  const age = await stat(file).then(
    (s) => Date.now() - s.mtimeMs,
    () => Infinity,
  );
  if (age < indexTtlMs) return readFile(file, "utf8");
  const response = await fetch(tbcBase);
  if (!response.ok) throw new Error(`TBC index fetch failed: HTTP ${response.status}`);
  const html = await response.text();
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, html);
  return html;
}

export async function searchTbc(input: { query: string; max: number }): Promise<DocsHit[]> {
  const posts = parseTbcIndex(await loadTbcIndex());
  return rankTbc(posts, input.query, input.max).map((post) => ({
    source: "tbc",
    title: post.title,
    url: `${tbcBase}${post.file}`,
    date: post.date,
  }));
}

export const tbcPostText = (html: string): string => htmlToText(html, "article");

export async function fetchTbcPost(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`TBC post fetch failed: HTTP ${response.status} for ${url}`);
  return tbcPostText(await response.text());
}
