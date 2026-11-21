// @vitest-environment jsdom
import { act, waitFor } from "@testing-library/react";
import { expect, test } from "vite-plus/test";
import { stableFanKey } from "@pe/ducts-web/calc/model";
import { elementSubject } from "@pe/ducts-domain/work-subject";
import { product } from "@pe/fans-contract/product";
import { module } from "../route.ts";
import {
  roster,
  snapshot,
  closedFan,
  recordedTables,
  backRestores,
  pin,
  targetChange,
  targetJourney,
  targetPaths,
  type JourneyDoc,
  type TargetProduct,
  typedSubjectDoor,
} from "../../../../tests/e2e/mounted.test-support.tsx";

// The recorded Chadds walk, and the same walk under another fan mark standing in for Snowdon.
const marks = { chadds: "MUAS-1", again: "MUAS-1", snowdon: "SNOW-1" } satisfies Record<
  JourneyDoc,
  string
>;
const fans: TargetProduct = {
  module,
  reads: Object.values(product.readings).map(({ handle }) => handle.key),
  native: (doc) => (key) => {
    const capture = key === "ducts.snapshot.roster" ? roster : snapshot;
    return JSON.parse(JSON.stringify(capture).replaceAll("MUAS-1", marks[doc]));
  },
  // The roster is a virtual list and jsdom has no layout, so no row is drawn to press: the fan is
  // opened through the subject door a row press calls, from this document's own roster reading.
  async use(doc, j) {
    const slow = { timeout: 20000 };
    const mount = j.mount()!;
    const option = await waitFor(() => {
      const read = mount.value(module.spec.subject!.read);
      const found =
        "value" in read &&
        module.spec
          .subject!.options(read.value as never)
          .find((row) => row.label.includes(marks[doc]));
      expect(found).toBeTruthy();
      return found as { id: string };
    }, slow);
    await act(() => typedSubjectDoor(mount)!.toggle(option.id));
    await waitFor(() => expect(j.search().get("fan")).toContain(option.id), slow);
  },
  shows: (doc) => new RegExp(marks[doc]),
};

test.each(targetPaths)("Fans: %s leaves the old document's fan behind", (path) =>
  targetChange(fans, path),
);
test("Fans: Back restores the fan its entry names, and Forward the other document's", () =>
  backRestores(fans));

test("Fans: reload restores the pinned fan and its airflow cell after inventory settles", async () => {
  // Pair the recorded roster's exact fan port with a complete native walk for that port.
  const unit = roster.nodes.find(({ id }) => id === 14577391)!;
  const walk = closedFan(unit.id, { requiredEsp: roster.slots.requiredEsp ?? undefined });
  const fan = walk.nodes.find(({ id }) => id === unit.id)!;
  fan.uniqueId = unit.uniqueId;
  fan.flowParameter = roster.slots.fanFlow;
  walk.slots.fanFlow = roster.slots.fanFlow;
  fan.connectors[0]!.index = 2;
  for (const element of [...walk.nodes, ...walk.segments])
    for (const port of element.connectors)
      if (port.connectedTo?.elementId === unit.id && port.connectedTo.connector === 0)
        port.connectedTo.connector = 2;
  const terminal = walk.nodes.find(({ kind }) => kind === "terminal")!;
  const fanId = stableFanKey({ uniqueId: unit.uniqueId, portIndex: 2 });
  const airflow = `[data-sheet-address=${JSON.stringify(`flows:${elementSubject(terminal)}`)}] input`;
  const j = await targetJourney(
    module,
    fans.reads,
    () => (key) =>
      key === "ducts.tables" ? recordedTables() : key === "ducts.snapshot.roster" ? roster : walk,
    { open: ["chadds"], search: new URLSearchParams({ target: pin("chadds") }) },
  );
  try {
    const mount = await j.bound("chadds");
    const slow = { timeout: 20000 };
    await waitFor(() => {
      const read = mount.value(module.spec.subject!.read);
      expect(read.state).toBe("ready");
      if (read.state === "ready")
        expect(module.spec.subject!.options(read.value).map(({ id }) => id)).toContain(fanId);
    }, slow);
    const selection = { kind: "ids", ids: [fanId] };
    await act(() => typedSubjectDoor(mount)!.select([fanId]));
    await waitFor(
      () => expect(document.querySelector(airflow)).toHaveProperty("value", "200"),
      slow,
    );
    terminal.connectors[0]!.flowCfm = 400;
    terminal.facts = terminal.facts.map((fact) =>
      fact.key === "flow" ? { ...fact, value: 400 } : fact,
    );
    j.hosts.chadds.host.documentChanged();
    await j.reload();
    const live = await j.bound("chadds", false);
    expect(j.search().get("target")).toBe(pin("chadds"));
    expect(JSON.parse(j.search().get("fan") ?? "null")).toEqual(selection);
    expect(live.page.read()).toMatchObject({ fan: selection });
    await waitFor(
      () => expect(document.querySelector(airflow)).toHaveProperty("value", "400"),
      slow,
    );
  } finally {
    await j.close();
  }
});
