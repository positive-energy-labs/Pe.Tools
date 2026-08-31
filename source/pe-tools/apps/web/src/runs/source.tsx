import { createContext, useContext, type ReactNode } from "react";

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

export const liveRunsSource = {
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

export function RunsSourceProvider({
  source,
  children,
}: {
  source: RunsSource;
  children: ReactNode;
}) {
  return <RunsSourceContext.Provider value={source}>{children}</RunsSourceContext.Provider>;
}

export const useRunsSource = () => useContext(RunsSourceContext);
