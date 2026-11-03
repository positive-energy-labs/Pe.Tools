import { podRouteDescriptorSchema } from "@pe/agent-contracts";
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
      const response = await fetch(
        new URL(`../../../../../examples/pods/snowdon-circuits/${row.artifact}`, import.meta.url),
      );
      if (!response.ok) throw Error(`Pod fixture artifact refused: ${response.status}`);
      return { row, envelope: { fingerprint: row.fingerprint, artifact: await response.json() } };
    }),
  );
}
