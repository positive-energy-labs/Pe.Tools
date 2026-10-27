/** One-way readers for historical journal envelopes. Archived bytes remain the authority.
 * Imported actions retain outcomes and reservations, but never gain new execution authority. */
import { createHash } from "node:crypto";
import { z } from "zod";
import { receiptSchema, type Receipt } from "@pe/agent-contracts";

const historicalAction = z.looseObject({
  id: z.string(),
  state: z.string(),
  startedAt: z.string(),
  steps: z.array(z.looseObject({ state: z.string() })),
  recovery: z.array(z.unknown()),
});

function importAction(raw: unknown, version: number, archive: string, sha256: string) {
  const old = historicalAction.parse(raw);
  const {
    kind: _kind,
    origin: _origin,
    footprint,
    frozen: _frozen,
    destination,
    request,
    bases: _bases,
    preparation,
    publication: _publication,
    consumes: _consumes,
    refusal: _refusal,
    ...facts
  } = old;
  const active = old.state === "waiting" || old.state === "running";
  return {
    ...facts,
    ...(version < 6
      ? {
          target: destination,
          input: request,
          prepared: preparation,
          effects: z
            .array(z.looseObject({ kind: z.string() }))
            .parse(footprint)
            .filter((effect) => effect.kind !== "receipt"),
          claims: [],
        }
      : {}),
    ...(active
      ? {
          state: "unknown",
          status: 503,
          error:
            "Historical execution has no durable terminal outcome; inspect the archived journal",
        }
      : {}),
    consumes: [],
    refusal: {
      kind: "domain",
      code: "historical-schema",
      message:
        "Original facts remain archived; this historical schema cannot authorize new execution",
    },
    steps: old.steps.map((step) => {
      const { established: _established, ...fact } = step;
      return step.state === "running"
        ? {
            ...fact,
            state: "unknown",
            status: 503,
            error: "Historical execution has no durable outcome",
          }
        : fact;
    }),
    recovery: [
      ...old.recovery,
      {
        stepId: `historical-v${version}`,
        at: old.startedAt,
        evidence: {
          schema: version === 5 ? "foundation-v5" : `journal-v${version}`,
          archive,
          sha256,
          action: old.id,
        },
      },
    ],
  };
}

/** Current decoding and every historical envelope share torn-tail and corruption rules. */
export function readJournalSnapshot(bytes: Buffer, archive: string) {
  const lines = bytes.toString("utf8").split("\n");
  const head = JSON.parse(lines[0]!);
  const version = head?.version;
  if (![4, 5, 6, 7].includes(version)) return null;
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const receipts: Receipt[] = [];
  const mappings: [string, string][] = [];
  let torn = version === 4;
  const parseReceipt = (raw: unknown) => {
    const envelope = z.looseObject({ body: z.looseObject({ kind: z.string() }) }).parse(raw);
    return receiptSchema.parse(
      version < 7 && envelope.body.kind === "action"
        ? {
            ...envelope,
            body: {
              kind: "action",
              value: importAction(envelope.body.value, version, archive, sha256),
            },
          }
        : raw,
    );
  };
  if (version === 4) {
    const envelope = z
      .strictObject({
        version: z.literal(4),
        receipts: z.array(z.unknown()),
        mappings: z.record(z.string(), z.uuid()),
      })
      .parse(head);
    receipts.push(...envelope.receipts.map(parseReceipt));
    mappings.push(...Object.entries(envelope.mappings));
  } else {
    const entry = z.union([
      z.strictObject({ receipt: z.unknown() }),
      z.strictObject({ mapping: z.tuple([z.string(), z.uuid()]) }),
    ]);
    lines.slice(1).forEach((text, i) => {
      if (!text) return;
      // A complete JSON line with an invalid schema is corruption, even at the tail.
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch (error) {
        if (i === lines.length - 2) {
          torn = true;
          return;
        }
        throw error;
      }
      const row = entry.parse(json);
      if ("receipt" in row) receipts.push(parseReceipt(row.receipt));
      else mappings.push(row.mapping);
    });
  }
  return { version, receipts, mappings, torn, lines: lines.length - 1, imported: version < 7 };
}
