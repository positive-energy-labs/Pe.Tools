import { describe, expect, it } from "vite-plus/test";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import { emptyScope } from "@pe/agent-contracts";

import { scopeSession, type SessionFacts } from "#/host/target";
import { documentTrunk, openLocalDocuments } from "#/targeting/world";
import { liveTakeoffsStoreKey } from "#/takeoff/route";
import { takeoffsWorkingCopyPath } from "./takeoffs";

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
    const rvt = documentTrunk.feed(
      AsyncResult.success({
        value: { documentId: "model-a", title: "projectA.rvt" },
        at: 100,
        basis: ["bridge-25"],
        bound: true,
      }),
    );

    expect(scopeSession(emptyScope, sessions)).toBe(sessions[0]);
    expect(rvt.options).toEqual([{ id: "model-a", label: "projectA.rvt" }]);
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
      { id: "C:\\Models\\Active.rvt", label: "Active.rvt", active: true },
      { id: "C:\\Models\\Other.rvt", label: "Other.rvt", active: false },
    ]);
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
