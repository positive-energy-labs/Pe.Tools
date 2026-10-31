import { z } from "zod";
import type { FieldDecl } from "./route-graph.ts";

export type SettingField = FieldDecl & { role: "setting" };
/** No route declares per-user settings yet. Project ducts inputs remain Work. */
export const routeSettingFields: Readonly<Record<string, Readonly<Record<string, SettingField>>>> =
  {};
export const settingsSchema = (fields: Readonly<Record<string, SettingField>>) =>
  z.strictObject(Object.fromEntries(Object.entries(fields).map(([key, f]) => [key, f.schema])));

export const routeSettingsSnapshotSchema = z.strictObject({
  revision: z.number().int().nonnegative(),
  values: z.record(z.string(), z.json()),
});
export type RouteSettingsSnapshot = z.infer<typeof routeSettingsSnapshotSchema>;
