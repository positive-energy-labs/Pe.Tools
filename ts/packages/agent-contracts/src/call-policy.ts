/** Call transport policy is authored on catalog entries, shared by both clients. */
export interface CallPolicy {
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
  "host.ops.catalog": { hostOnly: true, admission: "intrinsic" },
  "op.cancel": { cancel: true, admission: "intrinsic" },
  "scripting.execute": { script: true },
  "revit.context.view-image": { capture: true },
  "revit.context.view-image.focus": { capture: true },
  "host.shell.open": { shell: true },
};
