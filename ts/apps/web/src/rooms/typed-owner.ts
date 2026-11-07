import { useMemo, useRef, useContext } from "react";
import {RegistryContext} from "@effect/atom-react";
import type { RoomsContext } from "./route";
import type { RoomsOwner } from "./workspace";
export function useRoomsOwner(ctx: RoomsContext): RoomsOwner {
  const registry = useContext(RegistryContext);
  const current = useRef(ctx);
  current.current = ctx;
  return useMemo(
    () =>
      ({
        registry,
        fixture: null,
        busy: () => null,
        view: {
          read: () => {
            const page = current.current.page.read();
            return { page: { ...page, selected: page.picked, epoch: 0 } };
          },
          setPage: (patch: any) => {
            const { view, show, selected, ...pose } = patch;
            if (view !== undefined) current.current.page.query({ view });
            if (show !== undefined) current.current.page.query({ show });
            current.current.page.pose({
              ...pose,
              ...(selected !== undefined ? { picked: selected } : {}),
            });
          },
        },
        snapshot: () => {
          const ctx = current.current,
            data = ctx.value.value;
          return {
            target: ctx.target,
            work: data?.handle ? { doc: data.roomsWork, handle: data.handle } : null,
          };
        },
        readings: {
          get: (id: string) => {
            const value = current.current.value,
              data = value.value;
            return {
              status: value.current ? "complete" : "pending",
              current: value.current,
              error: id === "plan" ? data?.planError : !value.current ? value.reason : null,
              value:
                id === "snapshot"
                  ? data?.snapshot
                  : id === "trace"
                    ? { data: data?.trace, none: data?.traceError }
                    : id === "plan"
                      ? data?.plan
                      : [],
            };
          },
        },
        control: (id: string, input: any) => ({
          refusal: current.current.cells.refusal,
          run: async () => {
            const ctx = current.current;
            const patches =
              id === "edit"
                ? input.patches
                : id === "delete-note"
                  ? [{ path: ["notes", input.id] }]
                  : id === "cell:edits.clear"
                    ? [{ path: ["edits", input.key, "edit"], value: null }]
                    : [];
            const failure = await ctx.cells.patch(patches, { label: id });
            return failure ? { state: "refused", refusal: failure } : { state: "done" };
          },
        }),
      }) as unknown as RoomsOwner,
    [registry],
  );
}
