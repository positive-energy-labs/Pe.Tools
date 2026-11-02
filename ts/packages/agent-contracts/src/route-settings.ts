import { z } from "zod";
import { field } from "./route-field.ts";
import type { FieldDecl } from "./route-graph.ts";

export type SettingField = FieldDecl & { role: "setting" };
/**
 * Pea's run consent (ADR 0027 rule 11). On: the first consequential command in a thread shows a
 * "Reject?" notice that applies at its deadline. Off: a person must allow it. Pea cannot set it
 * (`agent: false`): an agent must not widen its own consent.
 */
export const peaSettingFields = {
  autoApprove: {
    ...field(z.boolean().default(true), {}),
    role: "setting",
    agent: false,
    label: "Auto-approve Pea writes",
    control: "switch",
  },
} as const satisfies Record<string, SettingField>;
export type PeaSettings = { autoApprove: boolean };
/** Host-persisted per-user settings, per route key. Project ducts inputs remain Work. */
export const routeSettingFields: Readonly<Record<string, Readonly<Record<string, SettingField>>>> =
  { chat: peaSettingFields };
export const settingsSchema = (fields: Readonly<Record<string, SettingField>>) =>
  z.strictObject(Object.fromEntries(Object.entries(fields).map(([key, f]) => [key, f.schema])));

export const routeSettingsSnapshotSchema = z.strictObject({
  revision: z.number().int().nonnegative(),
  values: z.record(z.string(), z.json()),
});
export type RouteSettingsSnapshot = z.infer<typeof routeSettingsSnapshotSchema>;
