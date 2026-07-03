import { createFileRoute } from "@tanstack/react-router";
// Side-effect type import: registers the `server` route-option augmentation.
import "@tanstack/react-start";

import type { CellProposal, MapRequest, MapResponse, ProposalConfidence } from "#/pdf-audit/types";

/**
 * The "agent" seam: parsed document blocks + table skeleton in, grounded cell
 * proposals out. Uses Anthropic when ANTHROPIC_API_KEY is set, otherwise a
 * deterministic markdown-table matcher so the UX is exercisable without keys.
 * ponytail: single stateless call today; the pea plugin/tool integration can
 * replace this endpoint without touching the routes.
 */
export const Route = createFileRoute("/api/pdf-audit/map")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json()) as MapRequest;
        if (!Array.isArray(body?.rows) || !Array.isArray(body?.columns)) {
          return Response.json({ error: "rows and columns are required" }, { status: 400 });
        }

        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (apiKey) {
          try {
            const proposals = await mapWithAnthropic(apiKey, body);
            return Response.json({ engine: "anthropic", proposals } satisfies MapResponse);
          } catch (error) {
            const proposals = mapHeuristically(body);
            return Response.json({
              engine: "heuristic",
              proposals,
              note: `Anthropic mapping failed (${error instanceof Error ? error.message : String(error)}); fell back to heuristic matching.`,
            } satisfies MapResponse);
          }
        }

        return Response.json({
          engine: "heuristic",
          proposals: mapHeuristically(body),
          note: "ANTHROPIC_API_KEY not set; used heuristic table matching.",
        } satisfies MapResponse);
      },
    },
  },
});

// --- anthropic --------------------------------------------------------------

async function mapWithAnthropic(apiKey: string, body: MapRequest): Promise<CellProposal[]> {
  const blockDigest = body.blocks
    .map((block) => `[${block.id}] (page ${block.page}, ${block.kind})\n${clip(block.md, 2000)}`)
    .join("\n\n");

  const prompt = [
    "You map values from a parsed manufacturer/engineering PDF onto a Revit family parameter table.",
    "Table rows are parameter names; table columns are family type names.",
    "",
    `ROWS (parameters): ${JSON.stringify(body.rows.map((row) => row.name))}`,
    `COLUMNS (types): ${JSON.stringify(body.columns)}`,
    `CURRENT VALUES: ${clip(JSON.stringify(body.current), 6000)}`,
    "",
    "DOCUMENT BLOCKS (each starts with its block id in brackets):",
    blockDigest,
    "",
    'Reply with ONLY a JSON array. Each element: {"row": <exact row name>, "column": <exact column name>, "value": <string value from the document>, "confidence": "high"|"medium"|"low", "blockId": <id of the block the value came from>, "note": <optional short reason>}.',
    "Only propose values you can ground in a block. Prefer values that differ from the current value or fill blanks. Do not invent rows or columns.",
  ].join("\n");

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.PE_PDF_AUDIT_MODEL ?? "claude-sonnet-5",
      max_tokens: 8192,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!response.ok) {
    throw new Error(`anthropic ${response.status}: ${clip(await response.text(), 300)}`);
  }
  const data = (await response.json()) as {
    content: Array<{ type: string; text?: string }>;
  };
  const text = data.content.find((part) => part.type === "text")?.text ?? "";
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) throw new Error("no JSON array in model reply");
  const parsed = JSON.parse(text.slice(start, end + 1)) as CellProposal[];

  const rowNames = new Set(body.rows.map((row) => row.name));
  const columnNames = new Set(body.columns);
  const blockIds = new Set(body.blocks.map((block) => block.id));
  return parsed.filter(
    (proposal) =>
      rowNames.has(proposal.row) &&
      columnNames.has(proposal.column) &&
      typeof proposal.value === "string" &&
      (proposal.blockId === null || blockIds.has(proposal.blockId ?? "")),
  );
}

// --- heuristic fallback ------------------------------------------------------

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function fuzzyEquals(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

function parseMarkdownTable(md: string): string[][] {
  const rows = md
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|"))
    .filter((line) => !/^\|[\s:|-]+\|$/.test(line))
    .map((line) =>
      line
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((cell) => cell.trim()),
    );
  return rows;
}

function mapHeuristically(body: MapRequest): CellProposal[] {
  const proposals = new Map<string, CellProposal>();
  const put = (proposal: CellProposal) => {
    const key = `${proposal.row}::${proposal.column}`;
    const existing = proposals.get(key);
    const rank: Record<ProposalConfidence, number> = { high: 2, medium: 1, low: 0 };
    if (!existing || rank[proposal.confidence] > rank[existing.confidence]) {
      proposals.set(key, proposal);
    }
  };

  for (const block of body.blocks) {
    if (block.kind !== "table") continue;
    const table = parseMarkdownTable(block.md);
    if (table.length < 2) continue;
    const header = table[0];

    // Which header cells correspond to known type columns?
    const columnHits = header.map((cell) =>
      body.columns.find((column) => fuzzyEquals(cell, column)),
    );
    const hasTypeColumns = columnHits.some((hit, index) => index > 0 && hit);

    for (const cells of table.slice(1)) {
      const label = cells[0] ?? "";
      const row = body.rows.find((candidate) => fuzzyEquals(label, candidate.name));
      if (!row) continue;

      if (hasTypeColumns) {
        cells.forEach((value, index) => {
          const column = columnHits[index];
          if (index === 0 || !column || !value) return;
          put({ row: row.name, column, value, confidence: "high", blockId: block.id });
        });
      } else if (cells.length === 2 && cells[1]) {
        // Key/value table: apply to every type column, but weakly.
        for (const column of body.columns) {
          put({
            row: row.name,
            column,
            value: cells[1],
            confidence: "medium",
            blockId: block.id,
            note: "key/value table; applied to all types",
          });
        }
      }
    }
  }

  return Array.from(proposals.values());
}

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}
