import type { WorkbenchState } from "@pe/agent-contracts";
import type { WorkbenchCommands } from "../../workbench/use-workbench.ts";

export function ModelModePanel({
  state,
  commands,
}: {
  state: WorkbenchState;
  commands: WorkbenchCommands;
}) {
  const canModel =
    state.agent.info?.capabilities.modelSwitching && state.models.availableModels.length > 0;
  const canMode =
    state.agent.info?.capabilities.sessionModes && state.modes.availableModes.length > 0;
  const canAccess =
    state.agent.info?.capabilities.accessLevels && state.access.availableAccessLevels.length > 0;
  return (
    <section className="section-subpanel">
      <h3>Model / Mode / Access</h3>
      <label>
        Model
        <select
          value={state.models.currentModelId ?? ""}
          disabled={!canModel}
          onChange={(event) => void commands.setModel(event.target.value)}
        >
          <option value="">{state.models.currentModelId ?? "Unavailable"}</option>
          {state.models.availableModels.map((model) => (
            <option key={model.id} value={model.id} disabled={model.disabled}>
              {model.displayName ?? model.id}
            </option>
          ))}
        </select>
      </label>
      <label>
        Mode
        <select
          value={state.modes.currentModeId ?? ""}
          disabled={!canMode}
          onChange={(event) => void commands.setMode(event.target.value)}
        >
          <option value="">{state.modes.currentModeId ?? "Unavailable"}</option>
          {state.modes.availableModes.map((mode) => (
            <option key={mode.id} value={mode.id}>
              {mode.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Access
        <select
          value={state.access.currentAccessLevel ?? ""}
          disabled={!canAccess}
          onChange={(event) => {
            const accessLevel = state.access.availableAccessLevels.find(
              (candidate) => candidate.id === event.target.value,
            )?.id;
            if (accessLevel) void commands.setAccessLevel(accessLevel);
          }}
        >
          <option value="">{state.access.currentAccessLevel ?? "Unavailable"}</option>
          {state.access.availableAccessLevels.map((accessLevel) => (
            <option key={accessLevel.id} value={accessLevel.id}>
              {accessLevel.name}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}
