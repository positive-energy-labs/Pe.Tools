import { createContext, useContext } from "react";

import { runExport } from "./feedback/export";
import { hydrateFromSet } from "./feedback/hydrate";
import {
  fetchRunIndex,
  loadPlan,
  loadRaster,
  loadReplaySeedInk,
  loadRunReport,
  loadRunScores,
  loadSealClasses,
  loadZoneGeometry,
  poolModalZones,
} from "./world";

const liveRunsSource = {
  fetchRunIndex,
  loadRunReport,
  loadRunScores,
  poolModalZones,
  loadPlan,
  loadRaster,
  loadReplaySeedInk,
  loadSealClasses,
  loadZoneGeometry,
  hydrateFromSet,
  runExport,
  exportEnabled: true,
  initialLedgerOpen: false,
};

export type RunsSource = typeof liveRunsSource;

const RunsSourceContext = createContext<RunsSource>(liveRunsSource);

export const useRunsSource = () => useContext(RunsSourceContext);
