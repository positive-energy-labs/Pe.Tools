import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Context } from "effect";
import { z } from "zod";
import type { MachineLeg, MachineUpdate } from "@pe/agent-contracts";
import {
  opResultArgv,
  updateApplyArgv,
  updateCheckArgv,
  type Envelope,
  type UpdatePlan,
  type UpdateReceipt,
} from "@pe/host-contracts/pe-revit-contract";
import { readStored, writeAtomic } from "@pe/host-contracts/store";
import { storedBlobsPath, storedNoticesPath } from "./notice-feed.ts";

const blocker = z.object({ code: z.string(), detail: z.string() });
const processIdentity = z.object({ pid: z.number().int(), processStartUtc: z.string().nullable() });
const leg = z.object({
  name: z.string(),
  status: z.string(),
  observedAtUtc: z.string(),
  detail: z.string().nullable(),
  exitCode: z.number().int().nullable(),
});
const receiptSchema: z.ZodType<UpdateReceipt> = z.object({
  state: z.string(),
  requestId: z.string().min(1),
  planId: z.string().min(1),
  receiptPath: z.string().min(1),
  reopen: z.array(z.string()),
  restartYears: z.array(z.number().int()),
  legs: z.array(leg),
  // beta.210: the stub's identity lets the SDK read a lost stub as abandoned; older receipts lack it.
  stub: processIdentity.nullable().default(null),
});
const planSchema: z.ZodType<UpdatePlan> = z.object({
  installedRoot: z.string(),
  available: z.boolean(),
  blockers: z.array(blocker),
  current: z.string(),
  effects: z.object({
    close: z.array(processIdentity),
    reopen: z.array(z.string()),
    restartYears: z.array(z.number().int()),
  }),
  feed: z.string(),
  latest: z.string().nullable(),
  msi: z
    .object({ digest: z.string(), name: z.string(), size: z.number(), url: z.string() })
    .nullable(),
  observedAtUtc: z.string(),
  planId: z.string().min(1),
  product: z.string(),
  quiet: z.boolean(),
  revits: z.array(
    z.object({
      ...processIdentity.shape,
      answering: z.boolean(),
      blockers: z.array(blocker),
      custody: z.string(),
      documents: z.array(
        z.object({
          central: z.string().nullable(),
          isModified: z.boolean(),
          openId: z.string().nullable(),
          path: z.string().nullable(),
          persistence: z.string().nullable(),
          reopenSource: z.string().nullable(),
          title: z.string().nullable(),
        }),
      ),
      idle: z.boolean(),
      modal: z.unknown().nonoptional().nullable(),
      queue: z.unknown().nonoptional().nullable(),
      sessionId: z.string().nullable(),
      unknown: z.boolean(),
      year: z.number().int(),
    }),
  ),
});

/** Validate without projecting: all confirmed SDK fields survive unchanged. */
function validateUpdatePlan(value: unknown): UpdatePlan {
  planSchema.parse(value);
  return value as UpdatePlan;
}
function validateReceipt(value: unknown, requestId: string, planId: string): UpdateReceipt {
  receiptSchema.parse(value);
  const receipt = value as UpdateReceipt;
  if (receipt.requestId !== requestId || receipt.planId !== planId)
    throw Error("Update receipt does not match the admitted request and plan.");
  return receipt;
}

export const unreadLeg = (): MachineLeg => ({
  observedAtUtc: null,
  attemptedAtUtc: null,
  error: null,
});
const admissionSchema = z.object({
  requestId: z.uuid(),
  planId: z.string().min(1),
  admittedAtUtc: z.string(),
  receiptObservedAtUtc: z.string().nullable(),
  receipt: receiptSchema.nullable(),
  receiptError: z.string().nullable().default(null),
  /** The version this request installs, read from the plan it was admitted against. */
  candidate: z.string().nullable().default(null),
  /** Whether the machine admitted this request on its own; null on admissions older than 0.7.31. */
  automatic: z.boolean().nullable().default(null),
  /** When an earlier record at this path was discarded; every later record carries it forward. */
  discardedAtUtc: z.string().nullable().default(null),
});
type Admission = z.infer<typeof admissionSchema>;
/** What a discard leaves in the file until the next admission: only when it happened. */
const discardedSchema = z.strictObject({ discardedAtUtc: z.string() });
/** The stored record: a receipt must answer the request and plan it is stored beside. */
const storedAdmissionSchema = admissionSchema.refine((stored) => {
  // A mismatch throws, and `readStored` refuses a file whose decode throws.
  if (stored.receipt) validateReceipt(stored.receipt, stored.requestId, stored.planId);
  return true;
});
export type UpdateRunner = (args: string[], detached?: boolean) => Promise<Envelope<unknown>>;
export const isUpdatePlanId = (id: unknown): id is string =>
  typeof id === "string" && z.uuid().safeParse(id).success && id === id.toLowerCase();

/**
 * An update fact for the receipt spine to publish. The reader announces; it never notifies. A
 * settled fact fires on the transition into a terminal receipt, so a re-read of the same terminal
 * receipt (a successor host loading it, the diagnostic re-persist) announces nothing twice.
 */
export type UpdateFact =
  | { readonly kind: "available"; readonly version: string; readonly automatic: boolean }
  | {
      readonly kind: "settled";
      readonly requestId: string;
      readonly state: "ok" | "failed" | "refused";
      readonly version: string | null;
      readonly detail: string | null;
      readonly automatic: boolean | null;
      /** The first leg that did not finish ok, and its exit code: the remote-safe failure reason. */
      readonly failedLeg: string | null;
      readonly exitCode: number | null;
    };

/** One persisted recovery handle. A lost acknowledgement is never permission to dispatch again. */
export function createUpdateReader(options: {
  readonly path: string;
  readonly run: UpdateRunner;
  readonly installed: boolean;
  readonly pid: number;
  /** The installed product manifest; the SDK resolves the install root from it (`update.not-installed` otherwise). */
  readonly manifest?: string;
  /** Present means automatic updates are off; absent (the default) means on. */
  readonly automaticOffPath?: string;
  /** The spine's intake for update facts; absent in tests that do not observe them. */
  readonly fact?: (fact: UpdateFact) => void;
  /**
   * The one exit path: called once per request when its persisted receipt first shows a confirmed
   * running handoff, wherever that receipt was learned (apply, lost-ack recovery, late recovery).
   */
  readonly handoff?: () => void;
  readonly now?: () => string;
}) {
  const now = options.now ?? (() => new Date().toISOString());
  let admission: Admission | null = null;
  /** Set when a record at this path was discarded: the reader no longer knows what was applied. */
  let discardedAtUtc: string | null = null;
  let loaded = false;
  let loading: Promise<void> | undefined;
  let refreshing: Promise<MachineUpdate> | undefined;
  let refreshingFeed = false;
  let applying: Promise<MachineUpdate> | undefined;
  let automaticPending = false;
  let terminalDiagnosticPending = false;
  const handedOff = new Set<string>();
  // The marker is re-read on every read, so writing or deleting it takes effect without a host restart.
  const automaticOn = () => !(options.automaticOffPath && existsSync(options.automaticOffPath));
  let value: MachineUpdate = {
    plan: null,
    receipt: null,
    requestId: null,
    admittedPlanId: null,
    planLeg: unreadLeg(),
    receiptLeg: unreadLeg(),
    automatic: automaticOn(),
  };

  const load = () =>
    (loading ??= (async () => {
      // Machine state (ADR 0039): an admission that does not decode, or whose receipt answers
      // another request, is discarded with a notice. The update then reads as never admitted. Its
      // bytes rest in the blob store first, under the hash the notice names.
      const read = readStored(options.path, z.union([storedAdmissionSchema, discardedSchema]), {
        class: "discard",
        place: "Update status",
        notices: storedNoticesPath(),
        blobRoot: storedBlobsPath(),
      });
      // The replay guard's record rides this file, like the journal's header: a discard leaves
      // when it happened, and every admission after it carries that forward.
      if (read.kind === "discarded") {
        discardedAtUtc = now();
        try {
          writeAtomic(options.path, JSON.stringify({ discardedAtUtc }));
        } catch (error) {
          // The flag stays in memory, and the next admission writes it.
          console.warn(`Could not record the update status discard: ${String(error)}`);
        }
      }
      if (read.kind === "ok") discardedAtUtc = read.value.discardedAtUtc;
      if (read.kind === "ok" && "requestId" in read.value) {
        admission = read.value;
        terminalDiagnosticPending =
          admission.receipt?.state === "failed" && !admission.receiptError;
        value = {
          ...value,
          requestId: admission.requestId,
          admittedPlanId: admission.planId,
          receipt: admission.receipt,
          receiptLeg: {
            ...value.receiptLeg,
            observedAtUtc: admission.receiptObservedAtUtc,
            error: admission.receiptError,
          },
        };
        // A crash between the terminal persist and the fact intake leaves no fact; the journal
        // dedupes by request, so announcing the persisted terminal receipt again is safe.
        const settled = admission.receipt?.state;
        if (settled === "ok" || settled === "failed" || settled === "refused")
          options.fact?.(settledFact(admission, settled));
        if (hasHandoff(admission.receipt)) handedOff.add(admission.requestId);
      }
      loaded = true;
    })().catch((error) => {
      loading = undefined;
      throw error;
    }));

  async function persist(record: Admission) {
    writeAtomic(options.path, JSON.stringify(record));
    const before = admission?.requestId === record.requestId ? admission.receipt?.state : null;
    admission = record;
    const after = record.receipt?.state;
    terminalDiagnosticPending = false;
    if (record.receipt && ["ok", "failed", "refused"].includes(record.receipt.state))
      automaticPending = false;
    if (after !== before && (after === "ok" || after === "failed" || after === "refused"))
      options.fact?.(settledFact(record, after));
    if (hasHandoff(record.receipt) && !handedOff.has(record.requestId)) {
      handedOff.add(record.requestId);
      options.handoff?.();
    }
    value = {
      ...value,
      requestId: record.requestId,
      admittedPlanId: record.planId,
      receipt: record.receipt,
    };
  }

  async function recover() {
    if (
      !admission ||
      (admission.receipt &&
        ["ok", "failed", "refused"].includes(admission.receipt.state) &&
        !terminalDiagnosticPending)
    )
      return;
    const attemptedAtUtc = now();
    try {
      const envelope = await options.run(opResultArgv({ requestId: admission.requestId }));
      // beta.186 op-result wraps update.apply's frame in response.result, even while running.
      const result = z
        .object({
          requestId: z.string(),
          response: z.object({
            requestId: z.string(),
            key: z.literal("update.apply"),
            result: z.unknown(),
            code: z.string().nullable().optional(),
            detail: z.string().nullable().optional(),
          }),
        })
        .parse(envelope.result);
      if (
        result.requestId !== admission.requestId ||
        result.response.requestId !== admission.requestId
      )
        throw Error("op result returned a different update request.");
      const receipt = validateReceipt(
        result.response.result,
        admission.requestId,
        admission.planId,
      );
      if (terminalDiagnosticPending && receipt.state !== admission.receipt?.state)
        throw Error("Diagnostic recovery changed the already confirmed terminal update state.");
      if (envelope.diagnostics.length && !["ok", "failed", "refused"].includes(receipt.state))
        throw Error(said(envelope));
      const observedAtUtc = now();
      const receiptError = failureDiagnostic(receipt, envelope, result.response);
      await persist({
        ...admission,
        receipt,
        receiptObservedAtUtc: observedAtUtc,
        receiptError,
      });
      value = { ...value, receiptLeg: { observedAtUtc, attemptedAtUtc, error: receiptError } };
    } catch (error) {
      value = {
        ...value,
        receiptLeg: { ...value.receiptLeg, attemptedAtUtc, error: String(error) },
      };
    }
  }

  function refresh(checkFeed = true): Promise<MachineUpdate> {
    if (refreshing)
      return checkFeed && !refreshingFeed ? refreshing.then(() => refresh(true)) : refreshing;
    refreshingFeed = checkFeed;
    refreshing = (async () => {
      if (!options.installed) return value;
      try {
        if (!loaded) await load();
      } catch (error) {
        value = {
          ...value,
          receiptLeg: { ...value.receiptLeg, attemptedAtUtc: now(), error: String(error) },
        };
      }
      const attemptedAtUtc = now();
      await Promise.all([
        checkFeed
          ? (async () => {
              try {
                const envelope = await options.run(updateCheckArgv({ manifest: options.manifest }));
                if (envelope.exitCode !== 0) throw Error(said(envelope));
                const plan = validateUpdatePlan(envelope.result);
                value = {
                  ...value,
                  plan,
                  planLeg: { observedAtUtc: now(), attemptedAtUtc, error: null },
                };
              } catch (error) {
                value = {
                  ...value,
                  planLeg: { ...value.planLeg, attemptedAtUtc, error: String(error) },
                };
              }
            })()
          : Promise.resolve(),
        applying ? Promise.resolve() : recover(),
      ]);
      return value;
    })().finally(() => {
      refreshing = undefined;
    });
    return refreshing;
  }

  function apply(planId: string, noShortcutArgs = false): Promise<MachineUpdate> {
    if (!isUpdatePlanId(planId))
      return Promise.reject(Error("An update planId must be a canonical UUID."));
    if (!options.installed) return Promise.reject(Error("Only the installed app updates itself."));
    if (applying)
      return applying.then((result) => {
        if (admission?.planId !== planId) throw Error("Another update request is admitted.");
        return result;
      });
    if (noShortcutArgs) automaticPending = true;
    applying = (async () => {
      if (refreshing) await refreshing;
      if (!loaded) await load();
      if (admission?.planId === planId) {
        await recover();
        return value;
      }
      if (
        admission &&
        (!admission.receipt || !["ok", "failed", "refused"].includes(admission.receipt.state))
      )
        throw Error("The previous update has no confirmed terminal receipt.");
      // The replay guard (MAP decision log 2026-11-12). After a discard this reader cannot say
      // whether a plan it is handed was already applied or is still running, and the installer
      // refuses only a plan whose installed version already changed. So it admits only a plan
      // this host checked after the discard. Every check mints a new plan id, so a re-sent apply
      // of an older plan is refused here and never reaches the installer.
      if (
        discardedAtUtc &&
        !(
          value.plan?.planId === planId &&
          Date.parse(value.plan.observedAtUtc) > Date.parse(discardedAtUtc)
        )
      )
        throw Error(
          "The update status could not be read and was discarded, so whether this plan was already applied is unknown. It is not applied again. Check for updates, then apply the plan that check returns.",
        );
      const record: Admission = {
        requestId: randomUUID(),
        planId,
        admittedAtUtc: now(),
        receiptObservedAtUtc: null,
        receipt: null,
        receiptError: null,
        candidate: value.plan?.planId === planId ? value.plan.latest : null,
        automatic: noShortcutArgs,
        discardedAtUtc,
      };
      // Flush and atomically install identity BEFORE the detached child can have effects.
      await persist(record);
      const attemptedAtUtc = now();
      try {
        const envelope = await options.run(
          updateApplyArgv({
            planId,
            manifest: options.manifest,
            requestId: record.requestId,
            waitPid: options.pid,
            noShortcutArgs,
          }),
          true,
        );
        const receipt = validateReceipt(envelope.result, record.requestId, planId);
        const observedAtUtc = now();
        const receiptError = failureDiagnostic(receipt, envelope);
        await persist({
          ...record,
          receipt,
          receiptObservedAtUtc: observedAtUtc,
          receiptError,
        });
        value = { ...value, receiptLeg: { observedAtUtc, attemptedAtUtc, error: receiptError } };
      } catch (error) {
        value = {
          ...value,
          receiptLeg: { ...value.receiptLeg, attemptedAtUtc, error: String(error) },
        };
        await recover();
      }
      return value;
    })().finally(() => {
      applying = undefined;
      if (
        !admission ||
        (admission.receipt && ["ok", "failed", "refused"].includes(admission.receipt.state))
      )
        automaticPending = false;
    });
    return applying;
  }

  /** The off switch is one marker file: present means off. */
  async function setAutomatic(on: boolean) {
    if (!options.automaticOffPath) throw Error("Automatic updates have no switch on this host.");
    if (on) await rm(options.automaticOffPath, { force: true });
    else {
      await mkdir(dirname(options.automaticOffPath), { recursive: true });
      await writeFile(options.automaticOffPath, "");
    }
    value = { ...value, automatic: on };
    return value;
  }

  return {
    refresh,
    apply,
    setAutomatic,
    announce: (fact: UpdateFact) => options.fact?.(fact),
    current: () => (value = { ...value, automatic: automaticOn() }),
    automaticPending: () => automaticPending,
  };
}

const hasHandoff = (receipt: UpdateReceipt | null) =>
  receipt?.state === "running" &&
  receipt.legs.some((leg) => leg.name === "handoff" && leg.status === "ok");

function settledFact(record: Admission, state: "ok" | "failed" | "refused"): UpdateFact {
  const failed = state === "ok" ? undefined : record.receipt?.legs.find((l) => l.status !== "ok");
  return {
    kind: "settled",
    requestId: record.requestId,
    state,
    version: record.candidate,
    detail: record.receipt?.legs.at(-1)?.detail ?? null,
    automatic: record.automatic,
    failedLeg: failed?.name ?? null,
    exitCode: failed?.exitCode ?? null,
  };
}

function said(envelope: Envelope<unknown>) {
  return (
    envelope.diagnostics.map((d) => `${d.code}: ${d.detail}`).join("; ") ||
    `SDK exit ${envelope.exitCode}`
  );
}

function failureDiagnostic(
  receipt: UpdateReceipt,
  envelope: Envelope<unknown>,
  response?: { code?: string | null; detail?: string | null },
) {
  if (receipt.state !== "failed") return null;
  if (response?.detail) return `${response.code ?? "update.failed"}: ${response.detail}`;
  return envelope.diagnostics.length ? said(envelope) : null;
}

export class UpdateReader extends Context.Service<
  UpdateReader,
  ReturnType<typeof createUpdateReader>
>()("pe/UpdateReader") {}
