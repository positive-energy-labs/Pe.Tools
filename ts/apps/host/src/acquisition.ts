import { createHash } from "node:crypto";
import { basename, extname, isAbsolute, join, win32 } from "node:path";
import { z } from "zod";
import {
  cloudVersionSchema,
  isCloudSource,
  type ActionReceipt,
  type InstancesLaunch,
} from "@pe/agent-contracts";
import type { SessionDocument } from "@pe/host-contracts/pe-revit-contract";

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
  z.strictObject({
    kind: z.literal("version-copy"),
    source: z.string(),
    version: cloudVersionSchema,
    detach: z.literal(true),
    baseline: z.string(),
    work: z.string(),
  }),
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

/** Action ids are caller text: never a path segment or an SDK name, only this digest of them. */
const acquisitionKey = (id: string) => createHash("sha256").update(id).digest("hex").slice(0, 32);

/** A deterministic exclusive root. */
export const acquisitionRoot = (peaWork: string, id: string) => join(peaWork, acquisitionKey(id));

/** The SDK session a created process runs as: its own, never the checkout's default name. */
export const acquisitionSessionId = (id: string) => `pea-${acquisitionKey(id)}`;

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
  if (launch.cloudVersion && (launch.template || launch.reload || !isCloudSource(launch.source)))
    throw Error(
      "An immutable APS version requires a cloud model source, never a template, reload or local file.",
    );
  if (launch.cloudVersion && launch.links === "allow")
    throw Error(
      "Immutable-version acquisition requires links refuse until a linked package is certified.",
    );
  if (launch.reload) throw Error("A reload acts on an open document; it is never an acquisition.");
  let origin: z.infer<typeof originSchema>;
  if (launch.template) origin = { kind: "new", template: launch.source };
  else if (isCloudSource(launch.source)) {
    if (!launch.cloudVersion)
      throw Error(
        "Cloud acquisition requires an explicit immutable APS version; connected model opens are refused.",
      );
    origin = {
      kind: "version-copy",
      source: launch.source,
      version: launch.cloudVersion,
      detach: true,
      baseline: join(root, "baseline", "model.rvt"),
      work: join(root, "work", "model.rvt"),
    };
  } else {
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
const openedDoc = z.object({ openId: z.string().min(1), path: z.string().nullable() });
// A live open records the CLI's DocOpResult; recovery records the op response, whose `result` is
// the bridge's document itself (`{requestId,key,verdict,result:{openId,path,…}}`, acceptance R4d).
const openedSchema = z.union([
  z.object({ document: openedDoc }).transform((r) => r.document),
  z.object({ result: openedDoc }).transform((r) => r.result),
]);
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
      (row) => row.key === key && forAcquisition.safeParse(row.input).data?.acquisition === id,
    );
  return receipts.flatMap((row): Acquisition[] => {
    if (row.key !== "instances.start" && row.key !== "instances.open") return [];
    if (row.prepared.state !== "ready") return [];
    const intent = preparedSchema.safeParse(row.prepared.value).data?.acquisition;
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
      (!origin ||
        !("work" in origin) ||
        (opened.path !== null && samePath(opened.path, origin.work)))
        ? { process: docProcess, sdkOpenId: opened.openId }
        : null;
    const files = row.steps.flatMap((step) =>
      step.kind === "file" ? [fileStepInput.parse(step.input).to] : [],
    );
    const baselineStep = succeeded("acquisition.baseline");
    const copied =
      baselineStep?.state === "succeeded" ? copiedSchema.safeParse(baselineStep.result).data : null;
    const baseline =
      copied && origin && "baseline" in origin ? { path: origin.baseline, ...copied } : null;
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

type NativeFacts = Pick<SessionDocument, "isWorkshared" | "isDetached"> &
  Partial<Pick<SessionDocument, "isCloud">>;

/**
 * Why one SDK document is not natively certified independent, or null when it is: not workshared,
 * or detached. An unread fact is never independence. Central and cloud acquisition are owed.
 */
export function unindependent(doc: NativeFacts): string | null {
  if (doc.isWorkshared === false || doc.isDetached === true) return null;
  // Absent is a payload that never read the fact (beta.202's wire); null a native read that failed.
  if (typeof doc.isWorkshared !== "boolean") return "the SDK has no native isWorkshared for it";
  if (typeof doc.isDetached !== "boolean")
    return "it is workshared and the SDK has no native isDetached for it";
  return "it is workshared and not detached; central and cloud acquisition are not supported";
}

/** Writes require a held lifetime, native independence, and exactly one executor-attested product join. */
export function acquiredOpenIds(
  acquisitions: readonly Acquisition[],
  process: AcquiredProcess,
  sdkDocuments: readonly ({ openId: string | null } & NativeFacts)[] | null,
  productOpenIds: readonly string[],
): Map<string, string> {
  const owned = new Map<string, string>();
  for (const each of acquisitions) {
    const document = each.document;
    if (each.state !== "held" || !document || !sameProcess(document.process, process)) continue;
    const sdk = sdkDocuments?.filter((doc) => doc.openId === document.sdkOpenId) ?? [];
    const independent =
      sdk.length === 1 &&
      unindependent(sdk[0]!) === null &&
      (each.intent.document?.origin.kind !== "version-copy" || sdk[0]!.isCloud === false);
    const product = productOpenIds.filter((openId) => openId === document.sdkOpenId);
    if (independent && product.length === 1) owned.set(product[0]!, each.id);
  }
  return owned;
}
