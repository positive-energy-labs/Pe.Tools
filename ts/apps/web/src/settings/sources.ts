import type { Machine, Reading } from "@pe/agent-contracts";
import { subscriptionSource } from "#/shell/readings-use";
import type { ReadingSource } from "#/shell/readings";

export type SettingsMachine = { reading: Reading<Machine>; fixture: boolean };
const live = subscriptionSource({
  request: () => ({ kind: "machine" }),
  decode: (value) => value as Machine,
});
export const settingsSources: Readonly<Record<string, ReadingSource>> = {
  "settings.machine": {
    kind: "use",
    open(context, deliver) {
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
