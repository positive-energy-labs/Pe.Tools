import { z } from "zod";
import { field } from "./route-field.ts";
import type { FieldDecl } from "./route-graph.ts";

export type SettingField = FieldDecl & { role: "setting" };
const slot = (label: string, value: string): SettingField => ({
  ...field(z.string().trim().min(1).max(240).default(value), {}),
  role: "setting",
  label,
});
const colour = (label: string, value: string): SettingField => ({
  ...field(
    z
      .string()
      .regex(/^#[0-9a-f]{6}$/i)
      .default(value),
    {},
  ),
  role: "setting",
  label,
  control: "color",
});

/** Shared declarations: the host validates exactly the fields mounted by the graph. */
export const ductsSettingFields = {
  terminalFlow: slot("Grille airflow", "PE_M_Grd_AirFlow"),
  fanFlow: slot("Unit airflow", "PE_M_Fan_AirFlowDesign"),
  fanStatic: slot("Unit ESP", "PE_M_Fan_ExternalStaticPressure"),
  terminalDrop: slot("Grille drop", "PE_M_Grd_ExternalStaticPressure"),
  componentDrop: slot("Component drop", "Pressure Drop"),
  fittingCoefficient: slot("Fitting coefficient", "Pe_C"),
  supplyColour: colour("Supply air colour", "#0569a5"),
  returnColour: colour("Return air colour", "#02bba4"),
  exhaustColour: colour("Exhaust air colour", "#fea665"),
  freshColour: colour("Fresh / outdoor air colour", "#1cbcd5"),
  unknownColour: colour("Unknown / mixed colour", "#808080"),
} satisfies Record<string, SettingField>;

export const routeSettingFields: Readonly<Record<string, Readonly<Record<string, SettingField>>>> =
  {
    ducts: ductsSettingFields,
  };
export const settingsSchema = (fields: Readonly<Record<string, SettingField>>) =>
  z.strictObject(Object.fromEntries(Object.entries(fields).map(([key, f]) => [key, f.schema])));

export const defaultDuctSettings = settingsSchema(ductsSettingFields).parse({});
export function ductsParameterSlots(
  values: Readonly<Record<string, unknown>> = defaultDuctSettings,
) {
  return {
    terminalFlow: String(values.terminalFlow ?? defaultDuctSettings.terminalFlow),
    fanFlow: String(values.fanFlow ?? defaultDuctSettings.fanFlow),
    fanStatic: String(values.fanStatic ?? defaultDuctSettings.fanStatic),
    terminalDrop: String(values.terminalDrop ?? defaultDuctSettings.terminalDrop),
    componentDrop: String(values.componentDrop ?? defaultDuctSettings.componentDrop),
    fittingCoefficient: String(values.fittingCoefficient ?? defaultDuctSettings.fittingCoefficient),
  };
}

export const routeSettingsSnapshotSchema = z.strictObject({
  revision: z.number().int().nonnegative(),
  values: z.record(z.string(), z.json()),
});
export type RouteSettingsSnapshot = z.infer<typeof routeSettingsSnapshotSchema>;
