import { loadBuiltinRoute, builtinRouteStamp } from "../route/builtin-inventory";

// The loader inventory owns source imports and evidence; no executable byte JSON.
export const capturesArtifact = Object.freeze({ fingerprint: builtinRouteStamp("captures") });
export async function admitCaptures() {
  const admitted = await loadBuiltinRoute("captures", capturesArtifact.fingerprint);
  if (!admitted.ok)
    throw Error(admitted.diagnostics.map((d) => `${d.path}: ${d.message}`).join("; "));
  return admitted.route;
}
