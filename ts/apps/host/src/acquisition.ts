import { createHash } from "node:crypto";
import { basename, extname, isAbsolute, join, win32 } from "node:path";
import { z } from "zod";
import { isCloudSource, type ActionReceipt, type InstancesLaunch } from "@pe/agent-contracts";

/** Intent is frozen before allocation; the journal fold is the sole acquisition authority (ADR 0017 D6). */

// Parsed, not strict: an SDK incarnation also names its executable; only pid/start bind.
const processSchema = z.object({ pid: z.number().int(), processStartUtc: z.string() });
type AcquiredProcess = z.infer<typeof processSchema>;

const originSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("file-copy"),
    source: z.string(),
    detach: z.boolean(),
    baseline: z.string(),
    work: z.string(),
  }),
  z.strictObject({ kind: z.literal("new"), template: z.string() }),
  /** A cloud model opened detached: no baseline version is recorded (handover says so). */
  z.strictObject({ kind: z.literal("detached"), source: z.string() }),
]);

const acquisitionIntentSchema = z.strictObject({
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
type Artifact = z.infer<typeof artifactSchema>;

export type Acquisition = {
  readonly id: string;
  readonly intent: AcquisitionIntent;
  /** Reconciling includes unknown handover/cleanup steps; held describes receipts, not liveness. */
  readonly state: "planned" | "reconciling" | "held" | "released";
  /** The Revit this acquisition started (a start step that succeeded, even if the open failed). */
  readonly process: AcquiredProcess | null;
  /** The SDK lifetime the open step bound, in the process it ran in. */
  readonly document: {
    readonly process: AcquiredProcess;
    readonly sdkOpenId: string;
  } | null;
  /** Paths its file steps recorded before any write; cleanup touches only these. */
  readonly files: readonly string[];
  readonly baseline: Artifact | null;
  readonly handover: z.infer<typeof handedSchema> | null;
  /** Files a Save As moved its document to, each from a receipted `acquisition.artifact` step. */
  readonly artifacts: readonly Artifact[];
};

/** A deterministic exclusive root: action ids are caller text, never a path segment. */
const acquisitionRoot = (peaWork: string, id: string) =>
  join(peaWork, createHash("sha256").update(id).digest("hex").slice(0, 32));

const resultName = (source: string) => {
  const ext = extname(source).toLowerCase();
  const stem = basename(source, extname(source)).replace(/[<>:"/\\|?*{}]/g, "_") || "document";
  return `${stem}${ext === ".rfa" || ext === ".rft" ? ".rfa" : ".rvt"}`;
};

/** Reserve every output before effects; an unknown worksharing hint must refuse upstream. */
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
  let origin: z.infer<typeof originSchema>;
  if (launch.template) origin = { kind: "new", template: launch.source };
  else if (isCloudSource(launch.source)) origin = { kind: "detached", source: launch.source };
  else {
    if (!isAbsolute(launch.source))
      throw Error(
        `Pea opens a local path or a cloud identity; '${launch.source}' is neither. Read recents for the path it opens with.`,
      );
    const name = basename(launch.source);
    origin = {
      kind: "file-copy",
      source: launch.source,
      detach: hint || launch.detach === true,
      baseline: join(root, "baseline", name),
      work: join(root, "work", name),
    };
  }
  return {
    id,
    root,
    process,
    document: {
      origin,
      result: join(root, "result", resultName(launch.source)),
      diffPlan: join(root, "diff-plan.json"),
    },
  };
}

const preparedSchema = z.object({ acquisition: acquisitionIntentSchema.nullable() });
const startedSchema = z.object({ session: z.object({ process: processSchema }) });
const docView = z.object({
  document: z.object({ openId: z.string().min(1), path: z.string().nullable() }),
});
// Recovery wraps the same request's DocOpResult under response.result.
const openedSchema = z.union([docView, z.object({ result: docView }).transform((r) => r.result)]);
const copiedSchema = z.object({ sha256: z.string(), bytes: z.number() });
const fileStepInput = z.object({ to: z.string() });
const handedSchema = z.object({
  result: artifactSchema,
  diffPlan: z.string(),
  work: artifactSchema.nullable(),
});
const forAcquisition = z.object({ acquisition: z.string() });
const artifactStep = z.object({ acquisition: z.string(), to: z.string() });

const samePath = (a: string, b: string) =>
  win32.normalize(a).toLowerCase() === win32.normalize(b).toLowerCase();
const sameProcess = (a: AcquiredProcess, b: AcquiredProcess) =>
  a.pid === b.pid && a.processStartUtc === b.processStartUtc;
/** Steps decide, not the attempt's state: a recovered step is proven even before a resume. */
const uncertain = (row: ActionReceipt) =>
  row.steps.some((step) => step.state === "running" || step.state === "unknown");

/** Malformed persisted intent mints nothing; actions with no effects leave no acquisition. */
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
        ? { process: docProcess, sdkOpenId: opened.document.openId }
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
    const artifacts = receipts.flatMap((each) =>
      each.key !== "instances.save"
        ? []
        : each.steps.flatMap((step) =>
            step.key === "acquisition.artifact" &&
            step.state === "succeeded" &&
            artifactStep.safeParse(step.input).data?.acquisition === row.id
              ? (artifactSchema.safeParse(step.result).data ?? [])
              : [],
          ),
    );
    return [
      {
        id: row.id,
        intent,
        state,
        process: created,
        document,
        files,
        baseline,
        handover,
        artifacts,
      },
    ];
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

/** Writes require a held lifetime, native independence, and exactly one executor-attested product join. */
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
