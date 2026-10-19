/** Host extensions observe the harness. They receive no inference, dispatch, caller or grant API. */
export interface PluginHooks {
  "turn.before": { readonly threadId: string; readonly turnId: string };
  "turn.after": { readonly threadId: string; readonly turnId: string; readonly outcome: string };
  "harness.session.started": { readonly threadId: string; readonly sessionId: string };
  "harness.session.stopped": { readonly threadId: string; readonly sessionId: string };
  "op.after": {
    readonly receiptId: string;
    readonly revision: number;
    readonly kind: string;
    readonly key: string;
    readonly outcome: string;
    /** Present only when the committed local action receipt holds a result. */
    readonly result?: unknown;
  };
}
export type PluginHookName = keyof PluginHooks;
export type PluginRegistration = { dispose(): void };
export interface PluginContext<T> {
  readonly id: string;
  /** Keys share one namespace. A duplicate refuses activation; registrations end with their scope. */
  contribute(key: string, value: T): PluginRegistration;
  hook<N extends PluginHookName>(
    name: N,
    observer: (event: Readonly<PluginHooks[N]>) => void | Promise<void>,
  ): PluginRegistration;
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
