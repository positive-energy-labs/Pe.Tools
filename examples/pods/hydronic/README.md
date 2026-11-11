# Hydronic Pod

Sizes each pipe of one hydronic piping system: the smallest catalog diameter whose velocity and friction stay inside the limits, which pipes are wrong today, and the pump head once nothing is unresolved.

- `routes/sizing/size.ts`: the product. Pure math, no Revit, no kernel.
- `routes/sizing/schema.ts`: Work (two limits plus the chosen diameter per pipe UniqueId) and the Value the core returns.
- `routes/sizing/host.ts`: the core read, a Goal. It reads the target document's Work (`ctx.work(key, target.ref)`), the firm file's max friction (`ctx.firm`, `Firm/hydronic.json`), the system's pipes and segment sizes (`ctx.native("mep.system.members" | "mep.segment.sizes")`), and calls `size`.
- `routes/sizing/module.ts`: the route declaration. `sheet` binds `chosen` to each pipe's `Diameter` (mm); `goal` is the core, so the kernel draws the unresolved list first.
- `routes/sizing/sizing.test.ts`: the math, the published artifact's admission, the kernel doors this Pod uses, and one `kernel gap:` test per capability the kernel does not yet offer a Pod.

Publish after any source change, from `ts/apps/web`: `node scripts/publish-pod-route.ts <absolute path to this folder> sizing`. Test from this folder: `vp test run`.

A Pod adds no native op (ADR 0030 rule 12). It reaches Revit only through catalog reads and the kernel's one sheet pair (`sheet.plan`, then `sheet.apply` after consent), which its `parameter` binding earns. A Pod host imports no read-graph value: everything comes through the `ReadContext` it is handed. Every `kernel gap:` test marks a capability this Pod still waits for.
