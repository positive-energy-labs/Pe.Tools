import { createInstruments } from '../../pages/tour/instruments.mjs';
import { SCHEMA_VERSION, initialCircuitState, circuitReduce } from '../../pages/tour/circuits.mjs';

// The build embeds the original authored text for the Source instrument.
const authoredSources = /* AUTHORED SOURCES */ {};

export const version = 2;
export const initial = initialCircuitState;
export const reducer = circuitReduce;
export const fixtures = {
  calculator: { title: "Manual voltage drop calculator", state: initialCircuitState },
};
export const fields = {
  reading: 'Circuit reading', selectedId: 'Selected circuit', overrides: 'Calculation overrides',
  inputs: 'Manual inputs', target: 'Design target', tab: 'Artifact view', theme: 'Theme',
  proposal: 'Reviewed wire change', receipt: 'Wire change receipt',
};

/** The SPA supplies its React, kit, canonical Work state, and exact-target doors. */
export function create(api) {
  return createInstruments({
    ...api,
    sources: api.sources || authoredSources,
    onState: state => api.kit.writeTheme(state.theme),
  });
}

/** This Pod authors its stages and pane arrangement; the kernel supplies the host doors. */
export function register({ graph, adapters, field, z, pane }) {
  return {
    graph: {
      ...graph,
      subject: () => "Electrical circuit voltage drop",
      directory: { ...graph.directory, category: "Calculate loads & airflow", aliases: ["circuit", "voltage", "conductor"] },
      fields: { ...graph.fields, stage: { ...field(z.enum(["calculate", "history"]).default("calculate"), {}), role: "stage" } },
      layout: graph.layout,
      stages: {
        calculate: { word: "Calculate", panes: ["instrument"], verbs: ["reset", "execute"], teach: "Compare conductor voltage drop using authored inputs." },
        history: { word: "History", panes: ["history"], verbs: [], teach: "Inspect retained edits and action receipts." },
      },
      stageOrder: ["calculate", "history"],
    },
    adapters,
  };
}
