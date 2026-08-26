import { describe, expect, it } from "vite-plus/test";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";

import { resolveTarget, type SessionFacts } from "#/host/target";
import { documentTrunk } from "#/targeting/world";
import { resolvedWorldBinding } from "./takeoffs";

describe("takeoffs document scope", () => {
  it("binds an implicit sole world and offers its active document", () => {
    const sessions: SessionFacts[] = [
      {
        sessionId: "bridge-25",
        sdkSessionId: "pe.app-25",
        processId: 25,
        lane: "dev",
        custody: "controlled",
        openDocumentCount: 1,
      },
    ];
    const world = resolvedWorldBinding(resolveTarget(sessions, ""), sessions);
    const rvt = documentTrunk.feed(
      AsyncResult.success({
        value: { documentId: "model-a", title: "projectA.rvt" },
        at: 100,
        basis: ["bridge-25"],
        bound: true,
      }),
    );

    expect(resolveTarget(sessions, world!)).toMatchObject({ kind: "resolved" });
    expect(world && rvt.options).toEqual([{ id: "model-a", label: "projectA.rvt" }]);
  });
});
