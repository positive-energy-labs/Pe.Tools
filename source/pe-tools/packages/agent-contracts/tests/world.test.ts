import { expect, test } from "vite-plus/test";
import { peInfoSchema } from "../src/index.ts";

const info = {
  controllerId: "pea",
  resourceId: "pea:root",
  world: {
    id: "pea:root",
    root: "C:\\work",
    storage: { kind: "local-unversioned" },
    isolation: "none",
  },
} as const;

test("/pe/info round-trips exactly and rejects malformed wire data", () => {
  expect(peInfoSchema.parse(JSON.parse(JSON.stringify(info)))).toEqual(info);
  expect(() => peInfoSchema.parse({ ...info, extra: true })).toThrow();
  expect(() =>
    peInfoSchema.parse({ ...info, world: { ...info.world, isolation: "bwrap" } }),
  ).toThrow();
  expect(() =>
    peInfoSchema.parse({
      ...info,
      world: {
        ...info.world,
        storage: { kind: "mesa-versioned", org: "org" },
        isolation: "bwrap",
      },
    }),
  ).toThrow();
});
