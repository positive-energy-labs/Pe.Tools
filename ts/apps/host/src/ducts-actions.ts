/**
 * /ducts verbs on the host: `ducts.preview-losses` and `ducts.apply-losses` are one native op, `ducts.apply`,
 * sent with `previewOnly` true or false. The web builds the whole write list from the person's
 * staged cells and Pe's own lookup; the host admits it against the exact document lifetime and
 * process incarnation, journals the native step, and never reads or rewrites the Work.
 */
import { Effect } from "effect";
import {
  actionAdmissionSchema,
  ductsActions,
  nativeProcessSchema,
  type DuctsActionKey,
} from "@pe/agent-contracts";
import { z } from "zod";
import { BridgeError, type RevitBridge } from "./bridge.ts";
import { type ActionJournal } from "./action-journal.ts";
import {
  readNativeReceipt,
  readOriginalProcess,
  type SdkReceiptReader,
} from "./native-receipts.ts";

const preparedDuctsSchema = z.strictObject({ process: nativeProcessSchema });
const refused = (message: string) => new BridgeError(message, 409, { notDispatched: true });

export async function admitDuctsAction(
  raw: unknown,
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
    admission,
    async () => {
      const selected = await current();
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
      const input = { ...admission.input, previewOnly: key === "ducts.preview-losses" };
      const value = await execution.step("native", "ducts.apply", input, async (requestId) => {
        await current(process);
        const outcome = await Effect.runPromise(
          Effect.result(
            bridge.invoke("ducts.apply", input, target.session, target.openId, requestId),
          ),
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
