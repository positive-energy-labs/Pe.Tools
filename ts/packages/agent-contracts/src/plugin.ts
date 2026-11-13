export type PluginRegistration = { dispose(): void };
export interface PluginContext<T> {
  readonly id: string;
  /** Keys share one namespace. A duplicate refuses activation; registrations end with their scope. */
  contribute(key: string, value: T): PluginRegistration;
}
export interface Plugin<T = unknown> {
  readonly id: string;
  readonly setup: (
    context: PluginContext<T>,
  ) => void | (() => void | Promise<void>) | Promise<void | (() => void | Promise<void>)>;
}
export type PluginStatus = { id: string; status: "active" | "disabled" | "error"; error?: string };
import { z } from "zod";
export const pluginStatusSchema = z.strictObject({
  id: z.string().min(1),
  status: z.enum(["active", "disabled", "error"]),
  error: z.string().optional(),
});
