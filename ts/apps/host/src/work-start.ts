import { hostState } from "./host-ownership.ts";
import { workAuthorOf } from "./control.ts";
import { hostAuthoredRefusal, refusalText } from "@pe/agent-contracts";
import { commands } from "@pe/mcps/product-actions";

import { command, io, refused, StepFailure } from "@pe/host-internal/command-executor";
import { Effect } from "effect";
import type { RouteWorkspace } from "@pe/runtime";

export const workStartExecutor = (workspace: RouteWorkspace | undefined) =>
  command(commands["work.start"], commands["work.start"].input, {
    async bind({ admission: { input }, work }) {
      if (!workspace) throw refused("Work storage is unavailable");
      // A seed is a caller-authored doc: a host-authored Work (findings) starts only through its own command.
      const hostAuthored = hostAuthoredRefusal(workspace.spec(input.key.route));
      if (hostAuthored) throw refused(hostAuthored);
      workspace.validateSeed(input.key, input.seed);
      if (await work.read(input.key, input.key.route)) throw refused("Work already exists");
      return {
        effects: [{ kind: "directory", path: hostState().work }],
        prepare: async () => input,
      };
    },
    run({ caller, admission }, execution) {
      if (!workspace) return Effect.fail(refused("Work storage is unavailable"));
      const { key, seed } = execution.prepared;
      return execution.step("publication", "work.start", { key }, () =>
        io(async () => {
          const result = await workspace.start(key, seed, workAuthorOf(caller), admission.id);
          if (!result.ok) throw new StepFailure(refusalText(result), 409, "refused", result);
          return result;
        }),
      );
    },
  });
