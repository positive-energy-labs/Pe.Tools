// Test-only bridge: the protected cells witness supplies its Work directly.
import type { ReadingSource } from "../shell/readings";
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
