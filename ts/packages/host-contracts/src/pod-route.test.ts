import { expect, test } from "vite-plus/test";
import { podRouteDeclarationSchema, podRouteDescriptorSchema } from "./pod-route.ts";

const route = {
  artifact: "routes/voltage-drop/route.artifact",
  fingerprint: `pod-bytes:${"a".repeat(64)}`,
  name: "Voltage drop",
  description: "Calculator",
};
test("one strict Pod declaration carries a package artifact and Pod fingerprint", () => {
  expect(podRouteDeclarationSchema.parse(route)).toEqual(route);
  for (const patch of [
    { fingerprint: `builtin-closure:${"a".repeat(64)}` },
    { fingerprint: "a".repeat(64) },
    { artifact: "../routes/voltage-drop/route.artifact" },
    { artifact: "routes/voltage-drop/index.js" },
    { sourcePath: "routes/voltage-drop/index.js" },
  ])
    expect(podRouteDeclarationSchema.safeParse({ ...route, ...patch }).success).toBe(false);
  expect(
    podRouteDeclarationSchema.safeParse({
      sourcePath: "routes/voltage-drop/index.js",
      name: route.name,
      description: route.description,
    }).success,
  ).toBe(false);
  expect(
    podRouteDescriptorSchema.safeParse({
      ...route,
      key: "route:@pod/routes/voltage-drop/route.artifact",
      packageId: "pod",
      workRoute: "pod.pod.voltage-drop",
      trusted: true,
      sha256: "a".repeat(64),
    }).success,
  ).toBe(false);
});
