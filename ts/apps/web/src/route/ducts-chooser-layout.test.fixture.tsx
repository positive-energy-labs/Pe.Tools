import { VOCABULARY } from "@pe/ducts-domain/calc/scoped-snapshot";
import "../styles.css";
import { createRoot } from "react-dom/client";
import { useSyncExternalStore, type ReactNode } from "react";
import { RegistryContext } from "@effect/atom-react";
import { KeyScopeHost } from "@pe/kit/keys";
import { systemList } from "@pe/duct-systems-domain/system-list";
import recorded from "../../../../packages/host-contracts/src/fixtures/k2-roster.json";
import recordedNetwork from "../../../../packages/host-contracts/src/fixtures/k2-system-walk.json";
import { nativeResponseSchema } from "@pe/host-contracts/decoders";
import { module as ducts, roster, network } from "@pe/duct-systems-web/route";
import { SystemsPane } from "@pe/duct-systems-web/screen/screen";
import { mountTypedRoute } from "../shell/typed-mount";
import { makeAtomRegistry } from "../shell/owner";
import { SubjectDoor } from "@pe/web-kernel/shell/subject";
import { typedSubjectDoor } from "../shell/typed-mount.ts";
import { createWorkFeedClient } from "../shell/work-feed-client";
import { fixtureTimeline } from "../shell/fixture-work-door";
import { workFingerprintSchema } from "@pe/agent-contracts";
import type { ReadingDelivery } from "@pe/agent-contracts/route";

// Native boundary: replay the committed Chadds roster, holding network completion
// until the instrument has measured the usable chooser during Reading.
const snapshot = nativeResponseSchema("ducts.snapshot.walk").parse({
  ...recorded,
  vocabulary: VOCABULARY,
});
const value = { ...snapshot, rows: systemList(snapshot, null), sourceVersion: "layout-recording" };
const networkValue = nativeResponseSchema("ducts.snapshot.walk").parse({
  ...recordedNetwork,
  vocabulary: VOCABULARY,
});
const publication = (data: unknown) => ({
  key: "layout",
  generation: 1,
  version: 1,
  state: "current",
  value: {
    data,
    evaluation: "layout",
    inputs: "recorded",
    coverage: { requested: [], covered: [], unknown: [], refused: [] },
    origin: { kind: "fixture" },
    works: [],
    trace: [],
    freshness: "current",
  },
});
let complete: ReadingDelivery;
const registry = makeAtomRegistry();
const mount = mountTypedRoute(
  ducts,
  {
    target: { kind: "document", ref: { session: "layout", openId: "recorded" } },
    fixture: null,
    work: { address: null, open: null },
    custody: { current: () => true },
    memory: () => ({}),
    address: { read: () => new URLSearchParams(), write() {}, subscribe: () => () => {} },
  },
  workFingerprintSchema.parse(`builtin-closure:${"a".repeat(64)}`),
  {
    work: createWorkFeedClient(
      { subscribe: () => () => {}, dirty() {} },
      {
        write: async () => {
          throw Error("Layout replay cannot write Work");
        },
        submit: async () => {
          throw Error("Layout replay cannot run commands");
        },
      },
    ),
    sources: {
      [roster.key]: {
        kind: "use",
        open(_ctx, deliver) {
          deliver({ kind: "complete", value: publication(value), revision: 1 });
        },
      },
      [network.key]: {
        kind: "use",
        open(_ctx, deliver) {
          complete = deliver;
        },
      },
      [ducts.spec.core!.key]: { kind: "use", open() {} },
    },
    timeline: fixtureTimeline(),
  },
);
Object.assign(window, {
  settleChooser() {
    complete({
      kind: "complete",
      value: publication({
        ...networkValue,
        sourceVersion: "recorded-EX1",
        systemReads: { completed: networkValue.systems.map((s) => s.id), missing: [] },
      }),
      revision: 1,
    });
  },
  disposeChooser() {
    mount.dispose();
    registry.dispose();
  },
});
function Surface() {
  useSyncExternalStore(mount.subscribe, mount.revision, mount.revision);
  return (
    <RegistryContext value={registry}>
      <KeyScopeHost id="layout-journey">
        <SubjectDoor value={typedSubjectDoor(mount)}>
          <main className="flex flex-col" style={{ width: 420, height: 900 }}>
            {mount.draw("e-systems", (ctx) => <SystemsPane ctx={ctx} />) as ReactNode}
          </main>
        </SubjectDoor>
      </KeyScopeHost>
    </RegistryContext>
  );
}
createRoot(document.getElementById("root")!).render(<Surface />);
