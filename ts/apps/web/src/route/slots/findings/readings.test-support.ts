import type { WorkKey } from "@pe/agent-contracts";
import type { RouteWorkspace } from "@pe/runtime";
import type { Readings } from "#/host/resource-stream";

/** The host's `work` Reading, answered by a real `RouteWorkspace`: the mount's `readings` port in a witness. */
export const workReadings = (
  workspace: RouteWorkspace,
  seen: unknown[] = [],
): Pick<Readings, "subscribe"> => ({
  subscribe(request, listener) {
    seen.push(request);
    if (request.kind !== "work")
      throw Error(`This witness answers the work Reading only, not ${request.kind}`);
    const { kind: _kind, admission: _admission, ...key } = request;
    const work: WorkKey = key;
    return workspace.observe(
      work,
      work.route,
      (answer) =>
        listener(
          "error" in answer
            ? { kind: "failure", key: "", error: answer.error }
            : { kind: "snapshot", key: "", value: answer.value },
        ),
      true,
    );
  },
});
