import assert from "node:assert/strict";
import test from "node:test";
import {
  adaptCircuits,
  initialCircuitState,
  circuitReduce,
  circuitCalculation,
  wireProposal,
  SCHEMA_VERSION,
} from "../../../../examples/pods/snowdon-circuits/pages/tour/circuits.mjs";

const catalog = {
  entries: [
    {
      circuitId: 91,
      circuitUniqueId: "c-91",
      panelName: "LP-1",
      circuitNumber: "7",
      loadName: "Lights",
      polesNumber: 1,
      wireSize: "2-#12, 1-#12 G",
      connectedElements: [{ elementId: 12 }],
      wires: [],
    },
  ],
};
const values = {
  v: 1,
  rows: [
    {
      circuitId: 91,
      amps: 10,
      voltage: 120,
      length: 200,
      material: "Copper",
      wireSize: "2-#12, 1-#12 G",
      wireParameter: {
        elementId: 91,
        parameterId: -114,
        parameterName: "Wire Size",
        storageType: "String",
        isReadOnly: true,
        hasValue: true,
        rawValue: "12",
      },
    },
  ],
};

test("typed identities join numeric readings by id and preserve missing facts", () => {
  const [row] = adaptCircuits(catalog, values);
  assert.equal(row.size, "12");
  assert.deepEqual(row.elementIds, [12]);
  assert.equal(row.phase, "1");
  assert.equal(circuitCalculation(row, {}, 3).status, "above");
  const [unknown] = adaptCircuits(catalog, { v: 1, rows: [] });
  assert.equal(unknown.amps, null);
  assert.equal(circuitCalculation(unknown, {}, 3).status, "unavailable");
});

test("localized display strings are never parsed as numeric measurements", () => {
  const [row] = adaptCircuits(
    { entries: [{ ...catalog.entries[0], voltage: "120,0 V", apparentCurrent: "10 A" }] },
    { v: 1, rows: [] },
  );
  assert.equal(row.voltage, null);
  assert.equal(row.amps, null);
  assert.equal(row.size, null);
});

test("an unsupported phase conductor cannot be replaced by its supported ground conductor", () => {
  for (const wireSize of ["3-#250, 1-#250, 1-#6", "3-#350, 1-#350, 1-#4"]) {
    const [row] = adaptCircuits(catalog, {
      v: 1,
      rows: [{ ...values.rows[0], wireSize }],
    });
    assert.equal(row.size, null);
    assert.equal(circuitCalculation(row, {}, 3).status, "unavailable");
  }
});

test("ambiguous, parallel and unsupported conductor facts require explicit overrides", () => {
  for (const wireSize of [null, "12/10", "2 sets of #12", "250 kcmil"]) {
    const [row] = adaptCircuits(catalog, { v: 1, rows: [{ ...values.rows[0], wireSize }] });
    assert.equal(row.size, null);
    assert.equal(circuitCalculation(row, {}, 3).status, "unavailable");
    assert.equal(circuitCalculation(row, { size: "10" }, 3).status, "above");
  }
  const [aluminum] = adaptCircuits(catalog, {
    v: 1,
    rows: [{ ...values.rows[0], material: "Aluminum" }],
  });
  assert.equal(circuitCalculation(aluminum, {}, 3).status, "unavailable");
  assert.equal(circuitCalculation(aluminum, { material: "Copper" }, 3).status, "above");
});

test("versioned replay selects real facts, keeps overrides per circuit and invalidates proposals", () => {
  const rows = adaptCircuits(catalog, values);
  const events = [
    {
      v: SCHEMA_VERSION,
      type: "reading",
      reading: {
        source: "test",
        at: 123,
        document: { session: "s", openId: "o", title: "Model" },
        rows,
      },
    },
    { v: SCHEMA_VERSION, type: "select", id: 91 },
    { v: 99, type: "set", key: "amps", value: "999" },
    { v: SCHEMA_VERSION, type: "override", key: "size", value: "10" },
  ];
  const state = events.reduce(circuitReduce, initialCircuitState);
  assert.equal(state.selectedId, 91);
  assert.equal(state.overrides[91].size, "10");
  assert.equal(state.reading.document.openId, "o");
  assert.equal(
    circuitReduce({ ...state, proposal: {} }, { v: 1, type: "override", key: "size", value: "8" })
      .proposal,
    null,
  );
});

test("wire proposals carry exact reviewed evidence and never invent a writable parameter", () => {
  const [row] = adaptCircuits(catalog, values);
  const review = wireProposal(row, "10", row.wireParameter);
  assert.match(review.blocked, /read-only/i);
  assert.equal(review.input, null);
  assert.throws(() => wireProposal(row, "10", null), /evidence/i);
  const evidence = { ...row.wireParameter, isReadOnly: false };
  const proposal = wireProposal(row, "10", evidence);
  assert.equal(proposal.key, "revit.apply.parameter-values");
  assert.equal(proposal.input.edits[0].parameterId, evidence.parameterId);
  assert.deepEqual(proposal.input.edits[0].expected, evidence);
});

test("overrides and selection cannot cross into another document with reused element ids", () => {
  const rows = adaptCircuits(catalog, values);
  const state = {
    ...initialCircuitState,
    reading: { document: { session: "s", openId: "one" }, rows },
    selectedId: 91,
    overrides: { 91: { size: "10" } },
  };
  const next = circuitReduce(state, {
    v: SCHEMA_VERSION,
    type: "reading",
    reading: { document: { session: "s", openId: "two" }, rows },
  });
  assert.equal(next.selectedId, null);
  assert.deepEqual(next.overrides, {});
});
