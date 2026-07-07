/**
 * Family-sheet tools — pea's side of the collaborative /family-sheet route.
 *
 * The worksheet lives under the `route:family-sheet` key of AgentController
 * session state. These tools read/write it through the controller context
 * (`requestContext.get("controller")`) with `updateState` — atomic
 * read-modify-write, every change rebroadcast to all browser tabs via the
 * native `state_changed` event.
 *
 * Trust contract, enforced here in code: pea PROPOSES and MARKS. It never
 * writes `staged` (human promotion) and never pushes to Revit.
 */
import { createTool } from "@mastra/core/tools";
import z from "zod";
import {
  type CellState,
  FORMULA_TYPE,
  type FamilySheetSnapshot,
  type Worksheet,
  cellReviewSchema,
  familySheetRouteState,
  familySheetSnapshotSchema,
  sourceRefSchema,
  worksheetCellKey,
  worksheetSchema,
} from "@pe/agent-contracts";

import { HostRpcCaller } from "../shared/host-rpc-caller.ts";
import { resolveHostBaseUrl } from "../shared/host-config.ts";

const WORKSHEET_KEY = familySheetRouteState.key;

/* ── Controller session-state access ─────────────────────────────────────── */

interface ControllerStateContext {
  getState: () => Record<string, unknown>;
  updateState: (
    updater: (state: Record<string, unknown>) => {
      updates?: Record<string, unknown>;
      result?: unknown;
    },
  ) => Promise<unknown>;
}

function controllerState(toolContext: unknown): ControllerStateContext | null {
  const context = toolContext as
    | { requestContext?: { get?: (key: string) => unknown } }
    | undefined;
  const controller = context?.requestContext?.get?.("controller") as
    | ControllerStateContext
    | undefined;
  return typeof controller?.getState === "function" && typeof controller?.updateState === "function"
    ? controller
    : null;
}

const EMPTY_WORKSHEET: Worksheet = { snapshot: null, doc: null, cells: {}, pushedAt: null };

function readWorksheet(state: Record<string, unknown>): Worksheet {
  const parsed = worksheetSchema.safeParse(state[WORKSHEET_KEY]);
  return parsed.success ? parsed.data : structuredClone(EMPTY_WORKSHEET);
}

/** Atomic worksheet mutation through the controller's serialized update queue. */
async function mutateWorksheet<T>(
  controller: ControllerStateContext,
  mutate: (worksheet: Worksheet) => T,
): Promise<T> {
  const result = await controller.updateState((state) => {
    const worksheet = readWorksheet(state);
    const outcome = mutate(worksheet);
    return { updates: { [WORKSHEET_KEY]: worksheet }, result: outcome };
  });
  return result as T;
}

const NO_CONTROLLER =
  "No controller session available — family-sheet tools only work inside a pea run.";

/* ── Tools ───────────────────────────────────────────────────────────────── */

export const familySheetStatus = createTool({
  id: "family_sheet_status",
  description:
    "Read the /family-sheet worksheet: the Revit family snapshot (parameters × types), the parsed spec doc reference, and review counts. Use compact for orientation; full adds per-type values, formulas, and every cell's proposal/staged/review state. Call this FIRST before proposing.",
  inputSchema: z.object({
    verbosity: z.enum(["compact", "full"]).default("compact"),
  }),
  execute: async (input, context) => {
    const controller = controllerState(context);
    if (!controller) return { isError: true, content: NO_CONTROLLER };
    const worksheet = readWorksheet(controller.getState());
    const { snapshot, doc, cells } = worksheet;
    const cellEntries = Object.entries(cells);
    const counts = {
      openProposals: cellEntries.filter(([, c]) => c.proposal && c.staged == null).length,
      staged: cellEntries.filter(([, c]) => c.staged != null).length,
      needsAttention: cellEntries.filter(([, c]) => c.review === "attention").length,
    };
    const base = {
      family: snapshot
        ? {
            familyName: snapshot.familyName,
            typeNames: snapshot.typeNames,
            parameterCount: snapshot.parameters.length,
            takenAt: snapshot.takenAt,
          }
        : null,
      doc: doc
        ? { fileName: doc.fileName, parseId: doc.parseId, blockCount: doc.blocks.length }
        : null,
      counts,
      hint: snapshot
        ? undefined
        : "No family snapshot yet — ask the user to click 'Read family' on /family-sheet, or call family_sheet_refresh.",
    };
    if (input.verbosity === "compact") {
      return {
        ...base,
        parameters: snapshot?.parameters.map((p) => ({
          name: p.name,
          group: p.group,
          storageType: p.storageType,
          readOnly: p.isReadOnly || p.isDeterminedByFormula ? true : undefined,
          hasFormula: p.formula ? true : undefined,
        })),
      };
    }
    return { ...base, parameters: snapshot?.parameters, cells };
  },
});

export const familySheetDoc = createTool({
  id: "family_sheet_doc",
  description:
    "Read the parsed spec-sheet blocks (markdown) attached to the family-sheet worksheet. Table blocks carry the values to propose; note each block's id and, within a table, the 0-based data row index and column index (column 0 is the row label) — these become the provenance `source` you pass to family_sheet_propose.",
  inputSchema: z.object({
    page: z.number().optional().describe("Only blocks on this page."),
    blockId: z.string().optional().describe("Only this block."),
  }),
  execute: async (input, context) => {
    const controller = controllerState(context);
    if (!controller) return { isError: true, content: NO_CONTROLLER };
    const doc = readWorksheet(controller.getState()).doc;
    if (!doc) {
      return {
        isError: true,
        content:
          "No spec doc on the worksheet. Parse one with family_sheet_parse_spec or ask the user to upload it on /family-sheet.",
      };
    }
    const blocks = doc.blocks.filter(
      (b) =>
        (input.page == null || b.page === input.page) &&
        (input.blockId == null || b.id === input.blockId),
    );
    return { fileName: doc.fileName, parseId: doc.parseId, blocks };
  },
});

const proposeCellSchema = z.object({
  paramName: z.string(),
  typeName: z
    .string()
    .describe(
      `Exact family type name; "*" applies the value to every type (single-value spec rows); "${FORMULA_TYPE}" proposes the parameter's formula.`,
    ),
  value: z.string(),
  source: sourceRefSchema
    .nullish()
    .describe(
      "Provenance in markdown coordinates: blockId from family_sheet_doc, rowIdx = 0-based data row, colIdx = 0-based column (0 = row label). Omit only for inferred values.",
    ),
  note: z.string().nullish(),
  confidence: z.enum(["high", "low"]).nullish(),
});

export const familySheetPropose = createTool({
  id: "family_sheet_propose",
  description:
    "Stage value PROPOSALS on the family-sheet worksheet (batch). Proposals appear live in the UI for the engineer to accept, edit, or reject — you cannot commit values yourself. Always carry `source` when the value comes from the spec doc. Low-confidence proposals are auto-marked needs-attention.",
  inputSchema: z.object({ cells: z.array(proposeCellSchema).min(1) }),
  execute: async (input, context) => {
    const controller = controllerState(context);
    if (!controller) return { isError: true, content: NO_CONTROLLER };
    return mutateWorksheet(controller, (worksheet) => {
      const skipped: { paramName: string; typeName: string; reason: string }[] = [];
      let accepted = 0;
      for (const entry of input.cells) {
        const param = worksheet.snapshot?.parameters.find((p) => p.name === entry.paramName);
        if (worksheet.snapshot && !param) {
          skipped.push({ ...pick(entry), reason: "parameter not in family snapshot" });
          continue;
        }
        const isFormula = entry.typeName === FORMULA_TYPE;
        if (param && !isFormula && (param.isReadOnly || param.isDeterminedByFormula)) {
          skipped.push({ ...pick(entry), reason: "read-only / determined by formula" });
          continue;
        }
        const typeNames =
          entry.typeName === "*" ? (worksheet.snapshot?.typeNames ?? []) : [entry.typeName];
        if (typeNames.length === 0) {
          skipped.push({ ...pick(entry), reason: "no types to apply to" });
          continue;
        }
        for (const typeName of typeNames) {
          if (
            !isFormula &&
            worksheet.snapshot &&
            !worksheet.snapshot.typeNames.includes(typeName)
          ) {
            skipped.push({ paramName: entry.paramName, typeName, reason: "unknown type" });
            continue;
          }
          const key = worksheetCellKey(entry.paramName, typeName);
          const cell: CellState = worksheet.cells[key] ?? { review: "none" };
          cell.proposal = {
            value: entry.value,
            by: "pea",
            source: entry.source ?? null,
            note: entry.note ?? null,
            confidence: entry.confidence ?? null,
          };
          if (entry.confidence === "low" && cell.review === "none") cell.review = "attention";
          worksheet.cells[key] = cell;
          accepted++;
        }
      }
      return { accepted, skipped };
    });
  },
});

export const familySheetMark = createTool({
  id: "family_sheet_mark",
  description:
    'Set review marks on worksheet cells: "attention" flags a cell the engineer must look at (blocks push), "good" clears it, "none" resets. Mark your own low-confidence reads honestly.',
  inputSchema: z.object({
    marks: z
      .array(
        z.object({
          paramName: z.string(),
          typeName: z.string().describe(`Type name or "${FORMULA_TYPE}".`),
          review: cellReviewSchema,
          note: z.string().nullish(),
        }),
      )
      .min(1),
  }),
  execute: async (input, context) => {
    const controller = controllerState(context);
    if (!controller) return { isError: true, content: NO_CONTROLLER };
    return mutateWorksheet(controller, (worksheet) => {
      let marked = 0;
      for (const mark of input.marks) {
        const key = worksheetCellKey(mark.paramName, mark.typeName);
        const cell: CellState = worksheet.cells[key] ?? { review: "none" };
        cell.review = mark.review;
        if (mark.note && cell.proposal) cell.proposal.note = mark.note;
        worksheet.cells[key] = cell;
        marked++;
      }
      return { marked };
    });
  },
});

export const familySheetRefresh = createTool({
  id: "family_sheet_refresh",
  description:
    "Re-read the family document open in Revit's family editor into the worksheet snapshot (parameters × types, formulas). Requires the family.editor.snapshot host op; existing proposals and review marks are preserved.",
  inputSchema: z.object({
    bridgeSessionId: z.string().optional(),
  }),
  execute: async (input, context) => {
    const controller = controllerState(context);
    if (!controller) return { isError: true, content: NO_CONTROLLER };
    const caller = new HostRpcCaller({
      hostBaseUrl: resolveHostBaseUrl(undefined),
      bridgeSessionId: input.bridgeSessionId,
    });
    let raw: unknown;
    try {
      // Unknown keys pass through POST /call untyped; typegen will type this op later.
      raw = await (caller.call as (key: string, request?: unknown) => Promise<unknown>)(
        "family.editor.snapshot",
        {},
      );
    } catch (error) {
      return {
        isError: true,
        content: `family.editor.snapshot failed (${error instanceof Error ? error.message : String(error)}). The op may not be registered on this host yet — ask the user to click 'Read family' on /family-sheet instead.`,
      };
    }
    const snapshot = coerceSnapshot(raw);
    if (!snapshot) {
      return { isError: true, content: `Unexpected snapshot shape: ${shortJson(raw)}` };
    }
    await mutateWorksheet(controller, (worksheet) => {
      worksheet.snapshot = snapshot;
    });
    return {
      familyName: snapshot.familyName,
      typeNames: snapshot.typeNames,
      parameterCount: snapshot.parameters.length,
    };
  },
});

export const familySheetParseSpec = createTool({
  id: "family_sheet_parse_spec",
  description:
    "Run OCR (LlamaParse, ~1-2 minutes) on a manufacturer spec sheet / submittal PDF by URL and attach the parsed blocks to the family-sheet worksheet. The browser UI gains hover-grounding automatically. Then read blocks with family_sheet_doc and propose values with provenance.",
  inputSchema: z.object({
    url: z.string().describe("Public URL of the PDF."),
  }),
  execute: async (input, context) => {
    const controller = controllerState(context);
    if (!controller) return { isError: true, content: NO_CONTROLLER };
    const base = process.env.PE_WEB_URL ?? "http://localhost:3010";
    const form = new FormData();
    form.append("url", input.url);
    let payload: {
      error?: string;
      jobId?: string;
      fileName?: string;
      pages?: unknown[];
      blocks?: { id: string; page: number; kind: string; md: string }[];
    };
    try {
      const response = await fetch(`${base}/api/pdf-audit/parse`, {
        method: "POST",
        body: form,
      });
      payload = (await response.json()) as typeof payload;
      if (!response.ok || payload.error) {
        return { isError: true, content: payload.error ?? `parse failed (${response.status})` };
      }
    } catch (error) {
      return {
        isError: true,
        content: `Couldn't reach the web server at ${base} (${error instanceof Error ? error.message : String(error)}). Is the /family-sheet dev server running? Set PE_WEB_URL if it's on another port.`,
      };
    }
    const blocks = (payload.blocks ?? []).map(({ id, page, kind, md }) => ({
      id,
      page,
      kind,
      md,
    }));
    await mutateWorksheet(controller, (worksheet) => {
      worksheet.doc = {
        parseId: payload.jobId ?? null,
        fileName: payload.fileName ?? "document.pdf",
        blocks,
      };
    });
    const tables = blocks.filter((b) => b.kind === "table");
    return {
      parseId: payload.jobId,
      fileName: payload.fileName,
      pageCount: payload.pages?.length ?? 0,
      blockCount: blocks.length,
      tableBlockIds: tables.map((t) => t.id),
    };
  },
});

export const familySheetTools = {
  [familySheetStatus.id]: familySheetStatus,
  [familySheetDoc.id]: familySheetDoc,
  [familySheetPropose.id]: familySheetPropose,
  [familySheetMark.id]: familySheetMark,
  [familySheetRefresh.id]: familySheetRefresh,
  [familySheetParseSpec.id]: familySheetParseSpec,
};

/* ── helpers ─────────────────────────────────────────────────────────────── */

function pick(entry: { paramName: string; typeName: string }) {
  return { paramName: entry.paramName, typeName: entry.typeName };
}

/** Map a family.editor.snapshot response loosely onto the worksheet snapshot shape. */
function coerceSnapshot(raw: unknown): FamilySheetSnapshot | null {
  const direct = familySheetSnapshotSchema.safeParse(raw);
  if (direct.success) return direct.data;
  // tolerate a wrapper ({ data: ... } / { snapshot: ... }) from op envelopes
  const record = raw as Record<string, unknown> | null;
  for (const key of ["data", "snapshot", "result"]) {
    const nested = record?.[key];
    if (nested) {
      const parsed = familySheetSnapshotSchema.safeParse(nested);
      if (parsed.success) return parsed.data;
    }
  }
  return null;
}

function shortJson(value: unknown): string {
  try {
    return JSON.stringify(value)?.slice(0, 300) ?? String(value);
  } catch {
    return String(value);
  }
}
