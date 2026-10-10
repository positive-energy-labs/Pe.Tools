import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
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
});
const planSchema: z.ZodType<UpdatePlan> = z.object({
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
});
type Admission = z.infer<typeof admissionSchema>;
export type UpdateRunner = (args: string[], detached?: boolean) => Promise<Envelope<unknown>>;
export const isUpdatePlanId = (id: unknown): id is string =>
  typeof id === "string" && z.uuid().safeParse(id).success && id === id.toLowerCase();

/** One persisted recovery handle. A lost acknowledgement is never permission to dispatch again. */
export function createUpdateReader(options: {
  readonly path: string;
  readonly run: UpdateRunner;
  readonly installed: boolean;
  readonly pid: number;
  /** The installed product manifest; the SDK resolves the install root from it (`update.not-installed` otherwise). */
  readonly manifest?: string;
  readonly now?: () => string;
}) {
  const now = options.now ?? (() => new Date().toISOString());
  let admission: Admission | null = null;
  let loaded = false;
  let loading: Promise<void> | undefined;
  let refreshing: Promise<MachineUpdate> | undefined;
  let refreshingFeed = false;
  let applying: Promise<MachineUpdate> | undefined;
  let automaticPending = false;
  let terminalDiagnosticPending = false;
  let value: MachineUpdate = {
    plan: null,
    receipt: null,
    requestId: null,
    admittedPlanId: null,
    planLeg: unreadLeg(),
    receiptLeg: unreadLeg(),
  };

  const load = () =>
    (loading ??= (async () => {
      try {
        admission = admissionSchema.parse(JSON.parse(await readFile(options.path, "utf8")));
        if (admission.receipt)
          validateReceipt(admission.receipt, admission.requestId, admission.planId);
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
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      loaded = true;
    })().catch((error) => {
      loading = undefined;
      throw error;
    }));

  async function persist(record: Admission) {
    await mkdir(dirname(options.path), { recursive: true });
    const temporary = `${options.path}.${randomUUID()}.tmp`;
    try {
      const file = await open(temporary, "wx");
      try {
        await file.writeFile(JSON.stringify(record));
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temporary, options.path);
      admission = record;
      terminalDiagnosticPending = false;
      if (record.receipt && ["ok", "failed", "refused"].includes(record.receipt.state))
        automaticPending = false;
      value = {
        ...value,
        requestId: record.requestId,
        admittedPlanId: record.planId,
        receipt: record.receipt,
      };
    } finally {
      await rm(temporary, { force: true });
    }
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
      const record: Admission = {
        requestId: randomUUID(),
        planId,
        admittedAtUtc: now(),
        receiptObservedAtUtc: null,
        receipt: null,
        receiptError: null,
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

  return { refresh, apply, current: () => value, automaticPending: () => automaticPending };
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
