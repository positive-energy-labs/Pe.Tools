import { useRef, useMemo } from "react";
import type { OpenContext } from "./route";
import type { OpenOwner } from "./context";
export function useOpenTypedOwner(ctx: OpenContext): OpenOwner {
  const current = useRef(ctx);
  current.current = ctx;
  return useMemo(
    () =>
      ({
        subscribe: () => () => {},
        version: () => 0,
        fixture: null,
        busy: () => null,
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
              status: ctx.value.current ? "complete" : "pending",
              current: ctx.value.current,
              value: ctx.value.value?.[id as "machine" | "recents" | "threads"],
              error: ctx.value.current ? null : ctx.value.reason,
            };
          },
        },
        control: (id: string, input: any) => ({
          refusal: current.current.value.current ? null : current.current.value.reason,
          run: async () => {
            try {
              if (input.refusal) throw Error(input.refusal);
              const value = await current.current.write(id).run(input.request);
              return { state: "done", kind: "command", outcome: { state: "succeeded" }, value };
            } catch (error) {
              return { state: "refused", refusal: { message: String(error) } };
            }
          },
        }),
      }) as unknown as OpenOwner,
    [],
  );
}
