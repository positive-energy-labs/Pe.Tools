import { createInstruments } from '../../pages/tour/instruments.mjs';
import { SCHEMA_VERSION, initialCircuitState, circuitReduce } from '../../pages/tour/circuits.mjs';

// The build embeds the original authored text for the Source instrument.
const authoredSources = /* AUTHORED SOURCES */ {};

export const version = SCHEMA_VERSION;
export const initial = initialCircuitState;
export const reducer = circuitReduce;
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
