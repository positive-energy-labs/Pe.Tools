import { createJiti } from "jiti";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { projectWork } from "./scripts/host-projection.ts";
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
  const jiti = createJiti(import.meta.url, { fsCache: false });
  const { module } = await jiti.import<{ module: import("./src/route/typed-route.ts").TypedRoute }>(
    options.entry,
  );
  let hostEntry = options.hostEntry;
  if ("spec" in module) {
    if (!module.spec.host) throw Error("A typed Pod declares its separate host entry");
    const entry = resolve(dirname(options.entry), ".host-entry.generated.ts");
    const specifier = (path: string) => {
      const local = relative(dirname(entry), path).replaceAll("\\", "/");
      return JSON.stringify(local.startsWith(".") ? local : `./${local}`);
    };
    const sdk = fileURLToPath(new URL("../../packages/agent-contracts/src/", import.meta.url));
    const projected = module.spec.edits
      ? await projectWork(
          options.entry,
          module,
          entry,
          "work",
          (source) => jiti.import<Record<string, { schema?: unknown }>>(source),
        )
      : null;
    hostEntry = {
      entry,
      source: `import {z} from ${specifier(resolve(sdk, "pod-authoring.ts"))};\n${projected?.definition ?? ""}import * as runtime from ${specifier(resolve(dirname(options.entry), module.spec.host))};\nconst data=${JSON.stringify(module.data)};\nexport const module={data,bodies:{},${projected?.properties ?? "schemas:{},"}reads:runtime.reads,leaves:runtime.leaves};\n`,
    };
  }
  const built = await buildRouteArtifact({ ...options, hostEntry });
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
