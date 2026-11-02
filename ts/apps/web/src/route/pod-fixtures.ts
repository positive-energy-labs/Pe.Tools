import { podRouteDescriptorSchema } from "@pe/agent-contracts";
/** Fixture modules are the shipped bytes; they still pass trust/hash and common module admission. */
export async function podFixtures() {
  const sources = await Promise.all([
    fetch(new URL("../../../../../examples/pods/pipes/routes/pipes/index.js?raw", import.meta.url)).then(r => r.text()).then(source => ["pipes", "pipes", source] as const),
    fetch(new URL("../../../../../examples/pods/snowdon-circuits/routes/voltage-drop/index.js?raw", import.meta.url)).then(r => r.text()).then(source => ["snowdon-circuits", "voltage-drop", source] as const),
  ]);
  return Promise.all(sources.map(async ([packageId, member, source]) => {
    const bytes = new TextEncoder().encode(source);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const sha256 = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2,"0")).join("");
    return { bytes, row: podRouteDescriptorSchema.parse({key:`route:@${packageId}/routes/${member}/index.js`,packageId,workRoute:`pod.${packageId}.${member}`,name:member,description:"Shipped Pod fixture",sourcePath:`routes/${member}/index.js`,sha256,trusted:true}) };
  }));
}
