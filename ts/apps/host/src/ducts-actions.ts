/**
 * /ducts verbs on the host: `ducts.preview-losses` and `ducts.apply-losses` are one native op, `ducts.apply`,
 * and `ducts.preview-heal` and `ducts.apply-heal` are `ducts.heal`, each sent with `previewOnly` true or false. The web builds the whole write list from the person's
 * staged cells and Pe's own lookup; the host admits it against the exact document lifetime and
 * process incarnation, journals the native step, and never reads or rewrites the Work.
 */
import { Effect } from "effect";
import {
  actionAdmissionSchema,
  ductsActions,
  nativeProcessSchema,
  type DuctsActionKey,
  type DuctsHealInput,
} from "@pe/agent-contracts";
import { healPlan, healRequestGroup } from "@pe/ducts-domain/heal";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { z } from "zod";
import { BridgeError, type RevitBridge } from "./bridge.ts";
import { resolveSdkSession } from "./sdk-session.ts";
import { type ActionJournal, type Crossing } from "./action-journal.ts";
import {
  readNativeReceipt,
  readOriginalProcess,
  type SdkReceiptReader,
} from "./native-receipts.ts";

const preparedDuctsSchema = z.strictObject({ process: nativeProcessSchema });

/** Each verb's native op and whether it only previews. */
const NATIVE: Record<DuctsActionKey, { op: "ducts.apply" | "ducts.heal"; previewOnly: boolean }> = {
  "ducts.preview-losses": { op: "ducts.apply", previewOnly: true },
  "ducts.apply-losses": { op: "ducts.apply", previewOnly: false },
  "ducts.preview-heal": { op: "ducts.heal", previewOnly: true },
  "ducts.apply-heal": { op: "ducts.heal", previewOnly: false },
};

/**
 * A heal group sent without items is planned here from a fresh snapshot with the route's own
 * classifier (`heal.ts`), so an agent can name a group; groups with items pass through untouched.
 */
export async function planned(input: DuctsHealInput, read: () => Promise<DuctSnapshot>) {
  if (input.groups.every((g) => g.items)) return input;
  const plan = healPlan(await read());
  return {
    groups: input.groups.map((g) => {
      if (g.items) return g;
      const found = plan.groups.find((p) => p.group === g.group);
      if (!found) throw refused(`Group ${g.group} has nothing to heal (or no such group in the snapshot)`);
      return healRequestGroup(found);
    }),
  };
}
const refused = (message: string) => new BridgeError(message, 409, { notDispatched: true });

export async function admitDuctsAction(
  raw: unknown,
  crossing: Crossing,
  owner: ActionJournal,
  bridge: RevitBridge["Service"],
  deps: { sdk?: SdkReceiptReader } = {},
  resume = false,
) {
  const admission = actionAdmissionSchema.parse(raw);
  if (!Object.hasOwn(ductsActions, admission.key))
    throw refused(`Unknown semantic action '${admission.key}'`);
  const key = admission.key as DuctsActionKey;
  admission.input = ductsActions[key].input.parse(admission.input);
  if (admission.destination.kind !== "document")
    throw refused(`${key} requires an exact DocumentRef`);
  const target = admission.destination.ref;
  const session = async () =>
    (await Effect.runPromise(bridge.list)).find((row) => row.sessionId === target.session);
  /** The admitted project document, still open in the admitted process incarnation. */
  const current = async (process?: z.infer<typeof nativeProcessSchema>) => {
    const selected = await session();
    if (
      process &&
      (selected?.processId !== process.pid ||
        selected?.processStartUtcUnixMs !== Date.parse(process.processStartUtc))
    )
      throw refused("The admitted process incarnation is no longer available");
    const document = selected?.state?.openDocuments.find((row) => row.openId === target.openId);
    if (!document || document.isFamilyDocument)
      throw refused("The admitted project document lifetime is no longer available");
    return selected!;
  };
  return owner.admit(
    { ...admission, ...crossing },
    async () => {
      await current();
      const selected = await resolveSdkSession(
        bridge,
        { bridgeSessionId: target.session, openDocumentId: target.openId },
        deps.sdk,
      );
      if (!selected.processId || selected.processStartUtcUnixMs == null)
        throw refused("Original process identity is unavailable");
      return {
        process: await readOriginalProcess(
          selected.processId,
          selected.processStartUtcUnixMs,
          deps.sdk,
        ),
      };
    },
    async (execution) => {
      const { process } = preparedDuctsSchema.parse(execution.prepared);
      const native = NATIVE[key];
      const input = {
        ...(native.op === "ducts.heal"
          ? await planned(admission.input as DuctsHealInput, async () => {
              await current(process);
              const read = await Effect.runPromise(
                Effect.result(bridge.invoke("ducts.snapshot", {}, target.session, target.openId)),
              );
              if (read._tag === "Failure") throw read.failure;
              return read.success.value as DuctSnapshot;
            })
          : admission.input),
        previewOnly: native.previewOnly,
      };
      const value = await execution.step("native", native.op, input, async (requestId) => {
        await current(process);
        const outcome = await Effect.runPromise(
          Effect.result(bridge.invoke(native.op, input, target.session, target.openId, requestId)),
        );
        if (outcome._tag === "Failure") throw outcome.failure;
        return outcome.success.value;
      });
      return { value, target: { session: target.session, document: null } };
    },
    resume,
  );
}

export const recoverDuctsAction = (
  id: string,
  owner: ActionJournal,
  deps: { sdk?: SdkReceiptReader },
) =>
  owner.recover(id, (step, prepared) =>
    readNativeReceipt(step, preparedDuctsSchema.parse(prepared).process, deps.sdk),
  );
