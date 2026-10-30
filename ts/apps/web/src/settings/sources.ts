import type { Machine, Reading } from "@pe/agent-contracts";
import { subscriptionSource } from "#/shell/readings-use";
import type { ReadingSource } from "#/shell/readings";
import { frozenDemo } from "#/host/demo-client";
import { MACHINE_SEEDS, OPEN_SEEDS } from "#/open/seeds";

export type SettingsMachine = { reading: Reading<Machine>; fixture: boolean };
const live = subscriptionSource({
  request: () => ({ kind: "machine" }),
  decode: (value) => value as Machine,
});
export const settingsSources: Readonly<Record<string, ReadingSource>> = {
  "settings.machine": {
    kind: "use",
    open(context, deliver) {
      const demo = frozenDemo();
      if (demo) {
        const saved = Object.hasOwn(MACHINE_SEEDS, demo)
          ? MACHINE_SEEDS[demo as keyof typeof MACHINE_SEEDS]
          : null;
        const machine = OPEN_SEEDS[demo as keyof typeof OPEN_SEEDS]?.readings.machine as
          | Machine
          | undefined;
        const reading =
          saved ??
          (machine
            ? { state: "ready" as const, observation: machine }
            : { state: "absent" as const });
        return deliver({ kind: "complete", value: { reading, fixture: true }, revision: 0 });
      }
      return live.open(context, (part) =>
        deliver(
          part.kind === "complete" || part.kind === "part"
            ? {
                ...part,
                value: { reading: { state: "ready", observation: part.value }, fixture: false },
              }
            : part,
        ),
      );
    },
  },
};
