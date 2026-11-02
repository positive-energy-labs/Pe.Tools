/** Call transport policy is authored on catalog entries, shared by both clients. */
export interface CallPolicy {
  humanOnly?: boolean;
  canonicalSession?: boolean;
  hostOnly?: boolean;
  admission?: "intrinsic";
  script?: boolean;
  saved?: boolean;
  capture?: boolean;
  snapshot?: boolean;
  cancel?: boolean;
  shell?: boolean;
  reading?: "roster" | "walk" | "tables";
}
export const callPolicies: Readonly<Record<string, CallPolicy>> = {
  "rhvac.launch": { humanOnly: true },
  "host.ops.catalog": { hostOnly: true, admission: "intrinsic" },
  "op.cancel": { cancel: true, admission: "intrinsic" },
  "scripting.execute": { script: true },
  "takeoffs.saved": { saved: true },
  "takeoffs.snapshot": { snapshot: true, admission: "intrinsic" },
  "revit.context.view-image": { capture: true },
  "host.shell.open": { shell: true },
  "ducts.snapshot.roster": { canonicalSession: true, reading: "roster" },
  "ducts.snapshot.walk": { canonicalSession: true, reading: "walk" },
  "ducts.tables": { canonicalSession: true, reading: "tables" },
};
