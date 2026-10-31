import { useSyncExternalStore } from "react";
import { publicRoutes } from "../route/builtin-routes";
import { GraphSettingsFields } from "./settings-fields";
import { settingFields } from "./settings";

/** Both surfaces enumerate the same registered graphs, including hosted and Pod graphs. */
export function RegisteredRouteSettings({ route }: { route?: string }) {
  useSyncExternalStore(publicRoutes.subscribe, publicRoutes.revision, publicRoutes.revision);
  return (
    <>
      {publicRoutes
        .entries()
        .flatMap(({ graph }) =>
          graph &&
          (route === undefined || graph.key === route) &&
          Object.keys(settingFields(graph)).length
            ? [<GraphSettingsFields key={graph.key} graph={graph} />]
            : [],
        )}
    </>
  );
}
