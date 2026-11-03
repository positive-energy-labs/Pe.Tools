import { z } from "zod";
import generated from "./artifact.generated.json";
import { RouteGraphJson } from "../../../../packages/agent-contracts/src/route-kernel-data";
import { loadRouteArtifact } from "../route/route-artifact";
import { evaluateRouteBytes } from "../shell/admitted-mount";

const artifactSchema = z.object({
  version: z.literal(1),
  data: RouteGraphJson,
  contracts: z.array(z.object({ id: z.string(), sha256: z.string() })),
  executables: z.array(
    z.object({
      client: z.enum(["web", "pea", "shared"]),
      entry: z.string(),
      members: z.array(z.object({ path: z.string(), sha256: z.string() })),
    }),
  ),
});
const bytes = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
export const capturesArtifact = {
  artifact: artifactSchema.parse(generated.artifact),
  fingerprint: generated.fingerprint,
  contracts: generated.contracts.map((c) => ({ ...c, bytes: bytes(c.bytes) })),
  executables: generated.executables.map((e) => ({
    client: z.literal("web").parse(e.client),
    entry: e.entry,
    resolved: e.resolved,
    members: e.members.map((m) => ({ ...m, bytes: bytes(m.bytes) })),
  })),
};
export async function admitCaptures(input = capturesArtifact, evaluate = evaluateRouteBytes) {
  const admitted = await loadRouteArtifact(
    input,
    [
      {
        key: "captures.list",
        subject: "None",
        touches: ["Metadata"],
        effect: "Read",
        cost: "Cheap",
        cardinality: "One",
        uses: [],
      },
    ],
    evaluate,
  );
  if (!admitted.ok)
    throw Error(admitted.diagnostics.map((d) => `${d.path}: ${d.message}`).join("; "));
  return admitted.route;
}
