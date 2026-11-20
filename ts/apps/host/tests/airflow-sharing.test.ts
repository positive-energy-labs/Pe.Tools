import { expect, test } from "vite-plus/test";
import { ductsRoster, ductsPricing } from "@pe/duct-systems-host/host";
import { fanRoster } from "@pe/fans-host/fan-calc";
import { closedFan, recordedTables } from "@pe/fans-host/tests/closed-fan.fixture";
import { nativeFixture } from "./fans/fans-work-fixture.ts";
import { calcPort } from "./ducts/ducts-read.fixture.ts";
import { resolveInputs } from "@pe/ducts-domain/calc/inputs";
import { TEST_FIRM } from "@pe/ducts-domain/test-inputs";
import { terminalFlows } from "@pe/ducts-domain/terminal-flows";
import { factOf, connOf, nodeOf, systemOf } from "@pe/ducts-domain/test-snapshot";
import { evaluate } from "@pe/host-internal/reads/evaluator";
import { settle, testDuctFiles } from "./effect-test.ts";

test.each(["coverage", "apply"] as const)(
  "P121 cross-route choice is independent of stored slots: %s",
  async (witness) => {
    const named = "PE_M_Grd_AirFlow";
    let stored = named;
    const capture = (slot = stored) => {
      const s = closedFan(100);
      return {
        ...s,
        systems: [systemOf(1, { name: "SA", classification: "SupplyAir" })],
        slots: { ...s.slots, terminalFlow: slot },
        nodes: [...s.nodes, nodeOf(6, "terminal", { connectors: [connOf(0)] })].map((n) =>
          n.kind !== "terminal"
            ? n
            : {
                ...n,
                flowParameter: slot,
                connectors: n.connectors.map((c) => ({ ...c, flowCfm: n.id === 3 ? 100 : 50 })),
                facts: [
                  ...(n.id === 3 ? [factOf(`slot:${named}`, 100)] : []),
                  ...(n.id === 3 || slot === "revit:Flow"
                    ? [factOf("flow", n.id === 3 ? 100 : 50)]
                    : []),
                ],
              },
        ),
      };
    };
    const f = await nativeFixture(
      "real",
      (_key, input) => capture(input.slots?.terminalFlow),
      null,
      {
        native: (key, input) => {
          if (key === "ducts.apply") stored = input.slots.terminalFlow;
          return key.startsWith("ducts.snapshot.")
            ? capture(input.slots?.terminalFlow)
            : key === "ducts.tables"
              ? recordedTables()
              : undefined;
        },
      },
    );
    try {
      const port = () =>
        calcPort(
          {
            firm: (owner) => settle(testDuctFiles().firm(owner)),
            catalogs: () => settle(testDuctFiles().catalogsFor(undefined)),
            workKey: async () => f.key,
            call: f.readDucts,
          },
          f.saved,
        );
      const roster = (await evaluate(fanRoster, { target: f.target.ref }, port())).data;
      expect(roster.activeSlot).toBe("revit:Flow");
      const before = (await evaluate(ductsRoster, { target: f.target.ref }, port())).data;
      const cfm = (snapshot: ReturnType<typeof capture>) =>
        [...terminalFlows(snapshot, {}).flows.values()].map((t) => t.cfm);
      expect(
        Object.values(
          resolveInputs({ snapshot: capture(roster.activeSlot), firm: TEST_FIRM }).terminals,
        ).map((t) => t.cfm.value),
      ).toEqual([100, 50, 50]);
      if (witness === "coverage") expect(cfm(before)).toEqual([100, 50, 50]);
      await evaluate(
        ductsPricing,
        { target: f.target.ref, system: before.systems.map(({ name }) => name) },
        port(),
      );
      expect(f.dispatched).toContainEqual(
        expect.objectContaining({
          key: "ducts.snapshot.walk",
          input: expect.objectContaining({
            selector: expect.objectContaining({ kind: "systems" }),
            slots: expect.objectContaining({ terminalFlow: roster.activeSlot }),
          }),
        }),
      );
      const key = { ...f.key, route: "fans" };
      const staged = await f.saved.apply(
        key,
        "fans",
        "human",
        [
          {
            path: ["writeIntent", "edit"],
            value: { value: { walk: { unitId: 100, portIndex: 0 } } },
          },
        ],
        0,
      );
      if (!staged.ok) throw Error(JSON.stringify(staged));
      for (const [id, command] of [
        ["airflow-plan", "sheet.plan"],
        ["airflow-apply", "sheet.apply"],
      ] as const) {
        await f.post("/actions", {
          id,
          key: command,
          target: f.target,
          input: { work: { key, revision: staged.revision } },
        });
        expect(await f.journal.wait(id), command).toMatchObject({
          state: "succeeded",
          result: { derivedRequest: { slots: { terminalFlow: roster.activeSlot } } },
        });
      }
      const after = (await evaluate(ductsRoster, { target: f.target.ref }, port())).data;
      expect(after.slots.terminalFlow).toBe(before.slots.terminalFlow);
      expect(cfm(after)).toEqual([100, 50, 50]);
      const fanAfter = (await evaluate(fanRoster, { target: f.target.ref }, port())).data;
      expect(fanAfter.activeSlot).toBe(after.slots.terminalFlow);
      expect(
        Object.values(
          resolveInputs({ snapshot: capture(fanAfter.activeSlot), firm: TEST_FIRM }).terminals,
        ).map((t) => t.cfm.value),
      ).toEqual([100, 50, 50]);
    } finally {
      await f.close();
    }
  },
);
