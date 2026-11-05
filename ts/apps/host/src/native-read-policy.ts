/**
 * The generated-metadata and caller policy every native Read passes for its calling identity,
 * live or recorded. It acquires no SDK, so a recording replay applies the same rule as live admission.
 */
import { Effect } from "effect";
import { hostOpCatalog } from "@pe/host-contracts/catalog";
import { nativePrincipals } from "@pe/agent-contracts";
import { admitAnonymousCall } from "./control.ts";
import { requireEligibleCaller } from "./gateway-actions.ts";
import { isDoorFailure } from "./http-problems.ts";
import { InvalidRead } from "./native-reads.ts";
import { RequestIdentity } from "./request-services.ts";

export const readRefusal = (message: string, problem: string, status = 409) =>
  new InvalidRead({ message, status, problem });

/** A thrown admission helper's refusal stays a door failure; anything else is a read refusal. */
export const admitted = <A>(check: () => A) =>
  Effect.try({
    try: check,
    catch: (error) => (isDoorFailure(error) ? error : readRefusal(String(error), "read.admission")),
  });

export const admitNativeCaller = Effect.fn("NativeReadPolicy.caller")(function* (key: string) {
  const { caller } = yield* RequestIdentity;
  const definition = hostOpCatalog.find((entry) => entry.key === key);
  if (
    definition?.intent !== "Read" ||
    (definition.effect !== "Read" && definition.effect !== "TransactRead")
  )
    return yield* readRefusal("Only declared native Reads can be admitted", "read.intent");
  yield* admitted(() => {
    admitAnonymousCall(caller, key);
    requireEligibleCaller(
      { ...definition, principal: nativePrincipals(definition.actor) },
      caller,
      "native-read",
    );
  });
  return definition;
});
