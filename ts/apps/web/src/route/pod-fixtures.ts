import { podRouteDescriptorSchema } from "@pe/agent-contracts";
const artifacts = new Map([
  [
    "routes/voltage-drop/route.artifact",
    new URL(
      "../../../../../examples/pods/snowdon-circuits/routes/voltage-drop/route.artifact",
      import.meta.url,
    ),
  ],
]);
/** Fixtures consume the same published artifact envelope as production discovery. */
export async function podFixtures() {
  const response = await fetch(
    new URL("../../../../../examples/pods/snowdon-circuits/pod.json", import.meta.url),
  );
  if (!response.ok) throw Error(`Pod fixture manifest refused: ${response.status}`);
  const manifest = await response.json();
  return Promise.all(
    manifest.routes.map(async (member: Record<string, unknown>) => {
      const row = podRouteDescriptorSchema.parse({
        ...member,
        key: `route:@snowdon-circuits/${member.artifact}`,
        packageId: "snowdon-circuits",
        workRoute: "pod.snowdon-circuits.voltage-drop",
        trusted: true,
      });
      const url = artifacts.get(row.artifact);
      if (!url) throw Error(`Pod fixture artifact is not bundled: ${row.artifact}`);
      const response = await fetch(url);
      if (!response.ok) throw Error(`Pod fixture artifact refused: ${response.status}`);
      return { row, envelope: { fingerprint: row.fingerprint, artifact: await response.json() } };
    }),
  );
}
