import { Effect } from "effect";
import { actionAdmissionSchema } from "@pe/agent-contracts";
import type { RequestIdentityData } from "@pe/host-internal/request-contracts";
import type { CausalParentId } from "../../../packages/agent-contracts/src/route-kernel-page.ts";
import type { CommandContext } from "./command-executor.ts";
import { InvalidRead } from "./native-reads.ts";
import { admittedRequestIdentity } from "./request-services.ts";

/**
 * The identity of a native read an admitted command makes: its actual caller, the exact document
 * its admission targets, and the command itself as causal parent. A fresh child request owns it.
 */
export const admittedCommandReadIdentity = (
  context: Pick<CommandContext, "caller" | "admission">,
): Effect.Effect<RequestIdentityData, InvalidRead> =>
  Effect.gen(function* () {
    const admission = actionAdmissionSchema.safeParse(context.admission);
    if (!admission.success)
      return yield* new InvalidRead({
        message: `Command admission is invalid: ${admission.error.message}`,
        status: 409,
        problem: "read.admission",
      });
    const { id, target } = admission.data;
    if (target.kind !== "document")
      return yield* new InvalidRead({
        message: `A command read needs a document target, not '${target.kind}'`,
        status: 409,
        problem: "read.target",
      });
    const identity = admittedRequestIdentity(context.caller, {
      bridgeSessionId: target.ref.session,
      openDocumentId: target.ref.openId,
    });
    // The one nominal conversion: only a validated, document-scoped admission id becomes the
    // causal parent its child read settles under. Callers never brand an id themselves.
    return Object.freeze({
      ...identity,
      ownership: Object.freeze({ ...identity.ownership, causalParent: id as CausalParentId }),
    });
  });
