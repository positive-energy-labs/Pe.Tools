import { useRef, useMemo } from "react";
import type { ReadingState } from "@pe/agent-contracts";
import { refusalOf } from "@pe/web-kernel/route/typed-route";
import type { OpenContext } from "./open-fields";
import type { RunVerb } from "@pe/web-kernel/route/typed-route";
type OpenVerb = "start" | "open" | "close" | "stop" | "restart";
/** What the owner reads: a pane's draw context, or the mount itself where no pane is drawn (the companion
 *  controls), so the reading may be value-less. `/sessions` passes the three verbs it declares. */
export type OpenSource<V extends OpenVerb = OpenVerb> = {
  verb(id: NoInfer<V>): RunVerb;
  readonly value: ReadingState<OpenContext["value"]["value"]>;
  // A pane's typed Page port, or the mount's own.
  readonly page:
    | OpenContext["page"]
    | Pick<import("../shell/typed-mount").TypedMount["page"], "read" | "pose" | "query">;
};
import type { OpenOwner } from "./context";
const openActions: readonly OpenVerb[] = ["start", "open", "close", "stop", "restart"];
export function useOpenTypedOwner(ctx: OpenSource): OpenOwner;
export function useOpenTypedOwner<V extends OpenVerb>(
  ctx: OpenSource<V>,
  actions: readonly V[],
): OpenOwner;
export function useOpenTypedOwner(
  ctx: OpenSource,
  actions: readonly OpenVerb[] = openActions,
): OpenOwner {
  const current = useRef(ctx);
  current.current = ctx;
  return useMemo(
    () =>
      ({
        subscribe: () => () => {},
        version: () => 0,
        fixture: null,
        busy: () => actions.find((id) => current.current.verb(id).pending) ?? null,
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
            const { value } = current.current;
            return {
              status:
                value.state === "ready"
                  ? "complete"
                  : value.state === "reading" || value.state === "refreshing"
                    ? "pending"
                    : "failed",
              current: value.state === "ready",
              value:
                "value" in value ? value.value[id as "machine" | "recents" | "threads"] : undefined,
              error: refusalOf(value),
            };
          },
        },
        control: (id: OpenVerb, input: any) => ({
          refusal: refusalOf(current.current.value),
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
