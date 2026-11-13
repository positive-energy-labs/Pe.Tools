import { useRef, useMemo } from "react";
import type { OpenContext } from "./open-fields";
import type { RunVerb } from "../route/typed-route";
import type { OpenOwner } from "./context";
type OpenVerb = "start" | "open" | "close" | "stop" | "restart";
const openActions: readonly OpenVerb[] = ["start", "open", "close", "stop", "restart"];
/** `/sessions` passes the three verbs it declares; its context holds those and no others. */
export function useOpenTypedOwner<V extends OpenVerb = OpenVerb>(
  ctx: Omit<OpenContext, "verb"> & { verb(id: NoInfer<V>): RunVerb },
  actions: readonly V[] = openActions as readonly V[],
): OpenOwner {
  const current = useRef(ctx);
  current.current = ctx;
  return useMemo(
    () =>
      ({
        subscribe: () => () => {},
        version: () => 0,
        fixture: null,
        busy: () => actions.find(id => current.current.verb(id).pending) ?? null,
        view: {
          read: () => ({
            page: {
              ...current.current.page.read(),
              epoch: 0,
              session: "",
              document: current.current.page.read().draft.doc ?? "",
            },
          }),
          setPage: (patch: any) => {
            if (patch.draft) current.current.page.pose({ draft: patch.draft });
            if (patch.table) current.current.page.query({ table: patch.table });
          },
        },
        readings: {
          mount: () => () => {},
          get: (id: string) => {
            const ctx = current.current;
            return {
              status: ctx.value.current
                ? "complete"
                : ctx.value.status === "pending"
                  ? "pending"
                  : "failed",
              current: ctx.value.current,
              value: ctx.value.value?.[id as "machine" | "recents" | "threads"],
              error: ctx.value.current ? null : ctx.value.reason,
            };
          },
        },
        control: (id: V, input: any) => ({
          refusal: current.current.value.current ? null : current.current.value.reason,
          run: async () => {
            try {
              if (input.refusal) throw Error(input.refusal);
              const value = await current.current.verb(id).run(input.request);
              return { state: "done", kind: "command", outcome: { state: "succeeded" }, value };
            } catch (error) {
              return { state: "refused", refusal: { message: String(error) } };
            }
          },
        }),
      }) as unknown as OpenOwner,
    [ctx, actions],
  );
}
