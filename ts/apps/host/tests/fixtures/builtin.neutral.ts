import { z } from "zod";
import { builtinData } from "../../../../packages/agent-contracts/src/route-kernel.fixtures.ts";
import type { HostRouteModule } from "../../../../packages/agent-contracts/src/host-route-admission.ts";
/** A real neutral source closure. Web fixtures may add pane bodies to this declaration. */
const base: HostRouteModule = {
  data: {
    ...builtinData,
    key: "u8b",
    address: "/u8b",
    work: { route: "u8b", schema: "work", version: 2, migrations: { "1": "upgrade" } },
  },
  schemas: { work: z.object({ amount: z.number().default(0) }) },
  bodies: {
    upgrade: {
      kind: "migration",
      slot: "work.migrations.1",
      source: { module: "builtin.neutral.ts", export: "upgrade" },
      run: (doc) => ({ amount: (doc as { old: number }).old + 1 }),
    },
  },
};

export const fixture: HostRouteModule = {
  ...base,
  workState: {
    route: "u8b",
    title: base.data.name,
    description: base.data.directory.summary,
    schema: base.schemas.work!,
    schemaVersion: 2,
    migrations: { 1: base.bodies.upgrade!.run },
  },
};
