// Test-only bridge: the protected cells witness supplies its Work directly.
import type { ReadingSource } from "../shell/readings";
import type { FamilyMount } from "./store";
import type { FamilyContext } from "./route";
// Optional acquisitions stay absent. The witness's getSnapshot/write ports own all Work.
const absent: ReadingSource = { kind: "use", open: () => {} };
export const familySources = (): Readonly<Record<string, ReadingSource>> => ({
  "family.profile": absent,
  "family.spec": absent,
  "family.pods": absent,
  "family.receipts": absent,
  "family.captureReceipt": absent,
  "family.buildReceipt": absent,
  "family.test": {
    kind: "use",
    open: (_context, deliver) => deliver({ kind: "complete", value: "current", revision: 0 }),
  },
});

/** CHEAT: frozen witness setup forwards kit handles to its existing owner; no state of its own. */
export const familyWitnessCells = (owner: FamilyMount): Pick<FamilyContext["cells"], "at"> => ({
  at(path) {
    if (path.length !== 2 || path[0] !== "cells") throw Error("Witness only forwards Family cells");
    const key = path[1]!;
    const write = async (edit: unknown) => {
      const work = owner.snapshot().work;
      if (!work) return { code: "not-ready", message: "Read the family first" };
      const result = await owner
        .control("edit", {
          expectedRevision: work.handle.revision,
          patches: [{ path: ["cells", key, "edit"], value: edit }],
        })
        .run();
      return "refusal" in result ? { code: "refused", message: result.refusal.message } : null;
    };
    const cell: ReturnType<FamilyContext["cells"]["at"]> = {
      owner: { route: "family", label: "Family" },
      get value() {
        return owner.snapshot().work?.doc.cells[key] ?? {};
      },
      get refusal() {
        return owner.view.read().page.stage === "history" ? "History is inspection only" : null;
      },
      stage: (value) => write({ value }),
      clear: () => write(null),
      transitions: () =>
        !cell.value.edit || cell.refusal ? [] : [{ kind: "clear", run: cell.clear }],
    };
    return cell;
  },
});
