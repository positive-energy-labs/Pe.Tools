import { createHash } from "node:crypto";
import { basename, extname, isAbsolute, join, win32 } from "node:path";
import { z } from "zod";
import type { ActionReceipt, InstancesLaunch } from "@pe/agent-contracts";

/**
 * Acquisition evidence (ADR 0017 D6 at document grain; review plan C3). An acquisition is a
 * resource one action created for Pea: a copy of a saved file, a new document, a detached cloud
 * open, or a background Revit. The acquiring action freezes this intent in its preparation before
 * anything is allocated; every allocation is a recorded step after it. This fold over the one
 * action journal is the only reader: no registry, no `owner` flag. Process provenance (`whose`)
 * is a label derived here; write authority is per document and minted only by `acquiredOpenIds`.
 */

// Parsed, not strict: an SDK incarnation also names its executable; only pid/start bind.
const processSchema = z.object({ pid: z.number().int(), processStartUtc: z.string() });
export type AcquiredProcess = z.infer<typeof processSchema>;

const originSchema = z.discriminatedUnion("kind", [
  /** Saved bytes copied to an immutable baseline, then to the work copy Revit opens. */
  z.strictObject({
    kind: z.literal("file-copy"),
    source: z.string(),
    detach: z.boolean(),
    baseline: z.string(),
    work: z.string(),
  }),
  /** A new unsaved document from a template: its baseline is empty. */
  z.strictObject({ kind: z.literal("new"), template: z.string() }),
  /** A cloud model opened detached: no baseline version is recorded (handover says so). */
  z.strictObject({ kind: z.literal("detached"), source: z.string() }),
]);

export const acquisitionIntentSchema = z.strictObject({
  id: z.string().min(1),
  /** The exclusive root under pea-work; every path this acquisition may create lives in it. */
  root: z.string(),
  process: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("create"), year: z.string() }),
    /** A process another acquisition created; this one owns only its document. */
    z.strictObject({
      kind: z.literal("existing"),
      process: processSchema,
      acquisition: z.string(),
    }),
  ]),
  document: z
    .strictObject({ origin: originSchema, result: z.string(), diffPlan: z.string() })
    .nullable(),
});
export type AcquisitionIntent = z.infer<typeof acquisitionIntentSchema>;

const artifactSchema = z.strictObject({ path: z.string(), sha256: z.string(), bytes: z.number() });
export type Artifact = z.infer<typeof artifactSchema>;

export type Acquisition = {
  readonly id: string;
  readonly intent: AcquisitionIntent;
  /**
   * planned: intent frozen, nothing allocated. reconciling: a step of its own, its handover or its
   * cleanup has no proven outcome; nothing is guessed and nothing is admitted. held: its recorded
   * resources exist as far as receipts know. released: a cleanup succeeded.
   */
  readonly state: "planned" | "reconciling" | "held" | "released";
  /** The Revit this acquisition started (a start step that succeeded, even if the open failed). */
  readonly process: AcquiredProcess | null;
  /** The SDK lifetime the open step bound, in the process it ran in. */
  readonly document: {
    readonly process: AcquiredProcess;
    readonly sdkOpenId: string;
    readonly path: string | null;
  } | null;
  /** Paths its file steps recorded before any write; cleanup touches only these. */
  readonly files: readonly string[];
  readonly baseline: Artifact | null;
  readonly handover: z.infer<typeof handedSchema> | null;
};

/** A deterministic exclusive root: action ids are caller text, never a path segment. */
export const acquisitionRoot = (peaWork: string, id: string) =>
  join(peaWork, createHash("sha256").update(id).digest("hex").slice(0, 32));

export const isCloud = (source: string) => /^(cld:\/\/|cloud:)/i.test(source);
const resultName = (source: string) => {
  const ext = extname(source).toLowerCase();
  const stem = basename(source, extname(source)).replace(/[<>:"/\\|?*{}]/g, "_") || "document";
  return `${stem}${ext === ".rfa" || ext === ".rft" ? ".rfa" : ".rvt"}`;
};

/**
 * The intent for one acquiring launch, with every path it may create, before anything exists.
 * A reload is never an acquisition: it mutates an exact open lifetime. `hint` is the provisional
 * worksharing read of a local .rvt (true/false); unknown refuses before this is called.
 */
export function planAcquisition(
  id: string,
  peaWork: string,
  process: AcquisitionIntent["process"],
  launch: InstancesLaunch | null,
  hint: boolean,
): AcquisitionIntent {
  const root = acquisitionRoot(peaWork, id);
  if (!launch) return { id, root, process, document: null };
  if (launch.reload) throw Error("A reload acts on an open document; it is never an acquisition.");
  const result = join(root, "result", resultName(launch.source));
  const diffPlan = join(root, "diff-plan.json");
  if (launch.template)
    return {
      id,
      root,
      process,
      document: { origin: { kind: "new", template: launch.source }, result, diffPlan },
    };
  if (isCloud(launch.source))
    return {
      id,
      root,
      process,
      document: { origin: { kind: "detached", source: launch.source }, result, diffPlan },
    };
  if (!isAbsolute(launch.source))
    throw Error(
      `Pea opens a local path or a cloud identity; '${launch.source}' is neither. Read recents for the path it opens with.`,
    );
  const name = basename(launch.source);
  return {
    id,
    root,
    process,
    document: {
      origin: {
        kind: "file-copy",
        source: launch.source,
        detach: hint || launch.detach === true,
        baseline: join(root, "baseline", name),
        work: join(root, "work", name),
      },
      result,
      diffPlan,
    },
  };
}

const preparedSchema = z.object({ acquisition: acquisitionIntentSchema.nullable() });
const startedSchema = z.object({ session: z.object({ process: processSchema }) });
const docView = z.object({
  document: z.object({ openId: z.string().min(1), path: z.string().nullable() }),
});
// A live open settles with the SDK's DocOpResult; one recovered by `op result <request-id>` keeps
// it under the receipt response's `result`. Either is that exact request's own answer.
const openedSchema = z.union([docView, z.object({ result: docView }).transform((r) => r.result)]);
const copiedSchema = z.object({ sha256: z.string(), bytes: z.number() });
const fileStepInput = z.object({ to: z.string() });
const handedSchema = z.object({
  result: artifactSchema,
  diffPlan: z.string(),
  work: artifactSchema.nullable(),
});
const forAcquisition = z.object({ acquisition: z.string() });

const samePath = (a: string, b: string) =>
  win32.normalize(a).toLowerCase() === win32.normalize(b).toLowerCase();
export const sameProcess = (a: AcquiredProcess, b: AcquiredProcess) =>
  a.pid === b.pid && a.processStartUtc === b.processStartUtc;
/** Steps decide, not the attempt's state: a recovered step is proven even before a resume. */
const uncertain = (row: ActionReceipt) =>
  row.steps.some((step) => step.state === "running" || step.state === "unknown");

/**
 * Every acquisition the journal proves, oldest first. A malformed persisted intent mints nothing
 * (it is skipped, never repaired); an action that failed before any effect leaves no acquisition.
 */
export function foldAcquisitions(receipts: readonly ActionReceipt[]): Acquisition[] {
  const linked = (key: string, id: string) =>
    receipts.filter(
      (row) => row.key === key && forAcquisition.safeParse(row.request).data?.acquisition === id,
    );
  return receipts.flatMap((row): Acquisition[] => {
    if (row.key !== "instances.start" && row.key !== "instances.open") return [];
    if (row.preparation.state !== "ready") return [];
    const intent = preparedSchema.safeParse(row.preparation.value).data?.acquisition;
    if (!intent || intent.id !== row.id) return [];
    const succeeded = (key: string) =>
      row.steps.find((step) => step.key === key && step.state === "succeeded");
    const startStep = succeeded(row.key === "instances.start" ? row.key : `${row.key}.start`);
    const created =
      intent.process.kind === "create" && startStep?.state === "succeeded"
        ? (startedSchema.safeParse(startStep.result).data?.session.process ?? null)
        : null;
    const openStep = row.key === "instances.open" ? succeeded("instances.open") : undefined;
    const opened =
      openStep?.state === "succeeded" ? openedSchema.safeParse(openStep.result).data : undefined;
    const origin = intent.document?.origin;
    const docProcess = intent.process.kind === "existing" ? intent.process.process : created;
    // A bound lifetime names the work copy it opened; another path is not this acquisition's.
    const document =
      opened &&
      docProcess &&
      (origin?.kind !== "file-copy" ||
        (opened.document.path !== null && samePath(opened.document.path, origin.work)))
        ? { process: docProcess, sdkOpenId: opened.document.openId, path: opened.document.path }
        : null;
    const files = row.steps.flatMap((step) =>
      step.kind === "file" ? [fileStepInput.parse(step.input).to] : [],
    );
    const baselineStep = succeeded("acquisition.baseline");
    const copied =
      baselineStep?.state === "succeeded" ? copiedSchema.safeParse(baselineStep.result).data : null;
    const baseline =
      copied && origin?.kind === "file-copy" ? { path: origin.baseline, ...copied } : null;
    const handovers = linked("instances.handover", row.id);
    const cleanups = linked("instances.cleanup", row.id);
    const handed = handovers.find((each) => each.state === "succeeded");
    const handover =
      handed?.state === "succeeded" ? (handedSchema.safeParse(handed.result).data ?? null) : null;
    const effects = row.steps.some((step) => step.state !== "failed" && step.state !== "cancelled");
    const state: Acquisition["state"] = cleanups.some((each) => each.state === "succeeded")
      ? "released"
      : uncertain(row) ||
          [...handovers, ...cleanups].some((each) => each.state === "running" || uncertain(each))
        ? "reconciling"
        : row.state === "running" && !effects
          ? "planned"
          : effects
            ? "held"
            : "released";
    if (state === "released" && !cleanups.length) return [];
    return [{ id: row.id, intent, state, process: created, document, files, baseline, handover }];
  });
}

/** The held acquisition that created this exact Revit; reconciling and released ones never do. */
export const heldProcess = (acquisitions: readonly Acquisition[], process: AcquiredProcess) =>
  acquisitions.find(
    (each) => each.state === "held" && each.process && sameProcess(each.process, process),
  ) ?? null;

/** The provenance label: Pea started this Revit and no cleanup released it. Never authority. */
export const processWhose = (acquisitions: readonly Acquisition[], process: AcquiredProcess) =>
  acquisitions.some(
    (each) => each.state !== "released" && each.process && sameProcess(each.process, process),
  )
    ? ("pea" as const)
    : ("you" as const);

/**
 * The only mint of a Pea write on one document: product openId → acquisition id. A held
 * acquisition's bound SDK lifetime must be open in its exact process now, natively certified
 * independent (not workshared, or detached; unknown is not), and joined to exactly one product
 * document by the executor's openId. Anything missing leaves the document read.
 */
export function acquiredOpenIds(
  acquisitions: readonly Acquisition[],
  process: AcquiredProcess,
  sdkDocuments:
    | readonly {
        openId: string | null;
        isWorkshared?: boolean | null;
        isDetached?: boolean | null;
      }[]
    | null,
  productOpenIds: readonly string[],
): Map<string, string> {
  const owned = new Map<string, string>();
  for (const each of acquisitions) {
    const document = each.document;
    if (each.state !== "held" || !document || !sameProcess(document.process, process)) continue;
    const sdk = sdkDocuments?.filter((doc) => doc.openId === document.sdkOpenId) ?? [];
    const independent =
      sdk.length === 1 && (sdk[0]!.isWorkshared === false || sdk[0]!.isDetached === true);
    const product = productOpenIds.filter((openId) => openId === document.sdkOpenId);
    if (independent && product.length === 1) owned.set(product[0]!, each.id);
  }
  return owned;
}
