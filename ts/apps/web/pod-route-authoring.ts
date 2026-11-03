import { buildRouteArtifact } from "./route-module-hash.ts";
import { podRouteDeclarationSchema } from "../../packages/host-contracts/src/pod-route.ts";

export type { PodRouteAuthoring } from "../../packages/agent-contracts/src/pod-authoring.ts";

/** Package the generic producer's exact bytes; this adds no compiler or fingerprint algorithm. */
export async function publishPodRoute(
  options: Parameters<typeof buildRouteArtifact>[0] & {
    readonly slug: string;
    readonly name: string;
    readonly description: string;
    readonly page?: string;
  },
) {
  const built = await buildRouteArtifact(options);
  const declaration = podRouteDeclarationSchema.parse({
    artifact: `routes/${options.slug}/route.artifact`,
    fingerprint: `pod-bytes:${built.fingerprint}`,
    name: options.name,
    description: options.description,
    ...(options.page ? { page: options.page } : {}),
  });
  const bytes = new TextEncoder().encode(
    JSON.stringify(built, (_key, value) =>
      value instanceof Uint8Array ? Array.from(value) : value,
    ),
  );
  return { declaration, bytes, artifact: built };
}
