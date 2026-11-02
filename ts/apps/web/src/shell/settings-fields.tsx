import { useEffect, useSyncExternalStore } from "react";
import type { RouteGraph } from "@pe/agent-contracts";
import { Input, Label } from "@pe/kit/lang/input";
import { Button } from "@pe/kit/lang/button";
import { OutcomeLine } from "@pe/kit/lang/outcome";
import { SwitchRow } from "@pe/kit/lang/switch-row";
import { graphSettings, settingFields, type SettingsOwner } from "./settings";

export function GraphSettingsFields({
  graph,
  owner = graphSettings(graph),
}: {
  graph: RouteGraph<any, any>;
  owner?: SettingsOwner;
}) {
  const state = useSyncExternalStore(owner.subscribe, owner.read, owner.read);
  useEffect(() => owner.connect(), [owner]);
  const fields = Object.entries(settingFields(graph));
  if (!fields.length) return null;
  return (
    <section aria-label={`${graph.name} settings`} className="hairline-t flex flex-col gap-2 p-2">
      <h2 className="t-head">{graph.name}</h2>
      {fields.map(([key, field]) =>
        field.control === "switch" ? (
          <SwitchRow
            key={key}
            label={field.label ?? key}
            says={field.label ?? key}
            checked={state.values[key] === true}
            disabled={state.revision < 0 || state.pending}
            onCheckedChange={(checked) => void owner.set({ [key]: checked }).catch((error) => { console.error("settings-fields: asynchronous operation failed", error); })}
          />
        ) : (
          <Label key={key}>
            {field.label ?? key}
            <Input
              key={`${key}:${field.codec.encode(state.values[key])}`}
              aria-label={field.label ?? key}
              type={field.control === "color" ? "color" : "text"}
              {...(field.control === "color"
                ? { value: field.codec.encode(state.values[key]) }
                : { defaultValue: field.codec.encode(state.values[key]) })}
              disabled={state.revision < 0 || state.pending}
              onChange={
                field.control === "color"
                  ? (event) => {
                      void owner.set({ [key]: event.currentTarget.value }).catch((error) => { console.error("settings-fields: asynchronous operation failed", error); });
                    }
                  : undefined
              }
              onBlur={(event) => {
                if (field.control === "color") return;
                const value = field.codec.decode(event.currentTarget.value);
                if (value !== state.values[key]) void owner.set({ [key]: value }).catch((error) => { console.error("settings-fields: asynchronous operation failed", error); });
              }}
            />
          </Label>
        ),
      )}
      {state.error && (
        <>
          <OutcomeLine kind="refused" label={state.error} />
          <Button label="Read settings again" onClick={() => void owner.refresh()}>
            Read again
          </Button>
        </>
      )}
    </section>
  );
}
