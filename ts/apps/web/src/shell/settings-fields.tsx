import { useEffect, useSyncExternalStore } from "react";
import type { RouteGraph } from "@pe/agent-contracts";
import { Input, Label } from "@pe/kit/lang/input";
import { Button } from "@pe/kit/lang/button";
import { OutcomeLine } from "@pe/kit/lang/outcome";
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
      {fields.map(([key, field]) => (
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
                    void owner.set({ [key]: event.currentTarget.value }).catch(() => {});
                  }
                : undefined
            }
            onBlur={(event) => {
              if (field.control === "color") return;
              const value = field.codec.decode(event.currentTarget.value);
              if (value !== state.values[key]) void owner.set({ [key]: value }).catch(() => {});
            }}
          />
        </Label>
      ))}
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
