import { useMemo, useRef, useContext } from "react";
import { RegistryContext } from "@effect/atom-react";
import { familyPageSchema } from "./page";
import type { FamilyContext } from "./route";
import type { FamilyMount } from "./store";

/** CHEAT: DocLab projections, edit buffer and pose still need app drawing ports (K gap 4).
 * Ordinary drawn cells receive ctx.cells/Value directly; this bridge owns no state or engine. */
export function useFamilyOwner(ctx: FamilyContext): FamilyMount {
  const registry = useContext(RegistryContext);
  const current = useRef(ctx);
  current.current = ctx;
  return useMemo(() => {
    const page = () => familyPageSchema.parse(current.current.page.read());
    const snapshot = () => {
      const ctx = current.current,
        data = ctx.value.current ? ctx.value.value : undefined;
      return {
        target: ctx.target ?? { kind: "host" as const },
        work: data?.handle ? { handle: data.handle, doc: data.familyWork } : null,
      };
    };
    return {
      registry,
      subscribe: () => () => {},
      version: () => 0,
      busy: () => null,
      snapshot,
      view: {
        read: () => ({ page: page() }),
        setPage: (patch: Record<string, unknown>) => {
          const { stage, pane, overlay, drill, inspector, doc, ...query } = patch;
          current.current.page.query(query);
          current.current.page.pose(
            Object.fromEntries(
              Object.entries({ stage, pane, overlay, drill, inspector, doc }).filter(
                ([, v]) => v !== undefined,
              ),
            ),
          );
        },
      },
      control: (id: string, input: any = {}) => ({
        run: async () => {
          try {
            const ctx = current.current;
            if (id === "edit") {
              if (input.expectedRevision !== ctx.value.value?.handle?.revision)
                throw Error("Work changed; edit the current family cells");
              const failure = await ctx.cells.patch(input.patches, { label: "Edit family cells" });
              if (failure) throw Error(failure.message);
            } else await ctx.write(id === "attach-spec" ? "attach" : id).run(input);
            return { state: "done" };
          } catch (error) {
            return {
              state: "refused",
              refusal: { message: error instanceof Error ? error.message : String(error) },
            };
          }
        },
      }),
    } as unknown as FamilyMount;
  }, [registry]);
}
