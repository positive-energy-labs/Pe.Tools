import { describe, expect, it } from "vite-plus/test";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import { address } from "@pe/agent-contracts";

import { resolveTarget, type SessionFacts } from "#/host/target";
import { documentTrunk, openLocalDocuments } from "#/targeting/world";
import { routeDocumentScope } from "#/workbench/route-document";
import { liveTakeoffsStoreKey } from "#/takeoff/route";
import { resolvedWorldBinding, takeoffsWorkingCopyPath } from "./takeoffs";

describe("takeoffs document scope", () => {
  it("uses one stable durable working-copy path", () => {
    expect(takeoffsWorkingCopyPath("C:\\Models\\projectA.rvt")).toBe(
      "C:\\Models\\projectA.PeTakeoffs.rvt",
    );
    expect(takeoffsWorkingCopyPath("C:\\Models\\projectA.PeTakeoffs.rvt")).toBe(
      "C:\\Models\\projectA.PeTakeoffs.rvt",
    );
  });

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

  it("offers every open local exact-path document and hands inactive selection to activation", () => {
    const open = openLocalDocuments({
      hasActiveDocument: true,
      openDocumentCount: 4,
      openDocuments: [
        document("C:\\Models\\Active.rvt", true),
        document("C:\\Models\\Other.rvt", false),
        { ...document(null, false), title: "Unsaved.rvt" },
        { ...document(null, false), title: "Cloud.rvt", isModelInCloud: true },
      ],
    });
    const active = AsyncResult.success({
      value: { documentId: "C:\\Models\\Active.rvt", title: "Active.rvt" },
      at: 100,
      basis: ["bridge-25"],
      bound: true,
    });
    const feed = documentTrunk.feed(active, AsyncResult.initial(), "live", open);

    expect(feed.options).toEqual([
      { id: "C:\\Models\\Active.rvt", label: "Active.rvt" },
      { id: "C:\\Models\\Other.rvt", label: "Other.rvt", active: false },
    ]);
    expect(
      routeDocumentScope(
        open.map(({ id, label, active: isActive }) => ({ at: address(id), label, active: isActive })),
        address("C:\\Models\\Other.rvt"),
      ),
    ).toMatchObject({ kind: "activate" });
  });

  it("remounts a same-path document when its Revit world changes", () => {
    const at = "C:\\Models\\Shared.rvt";
    expect(liveTakeoffsStoreKey("bridge-a", at)).not.toBe(liveTakeoffsStoreKey("bridge-b", at));
  });
});

const document = (path: string | null, isActive: boolean) => ({
  documentKey: path ?? "unsaved",
  title: path?.split("\\").at(-1) ?? "Untitled.rvt",
  path,
  isFamilyDocument: false,
  isWorkshared: false,
  isActive,
  isModifiable: false,
  isReadOnly: false,
  isModelInCloud: false,
});
