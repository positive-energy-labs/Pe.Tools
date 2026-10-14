import { z } from "zod";

/** Protocol support does not establish that a native shell is present. */
export const NATIVE_ADAPTER_VERSION = 1;
const text = z.string().min(1);
const color = z.int().min(0).max(0xffffff);

export const machineNoticeSchema = z.strictObject({
  id: text,
  revision: z.int().min(0),
  title: z.string(),
  body: z.string(),
  href: text.optional(),
  act: z
    .discriminatedUnion("kind", [
      z.strictObject({
        kind: z.literal("permission"),
        threadId: text,
        requestId: text,
        options: z.array(z.strictObject({ optionId: text, name: z.string(), kind: text })),
      }),
      z.strictObject({
        kind: z.literal("question"),
        threadId: text,
        requestId: text,
        message: z.string(),
        requestedSchema: z.record(z.string(), z.unknown()),
      }),
      z.strictObject({ kind: z.literal("reply"), threadId: text }),
      z.strictObject({ kind: z.literal("automatic-updates") }),
    ])
    .optional(),
});
export type NativeNotice = z.infer<typeof machineNoticeSchema>;

export const rendererMessageSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("chrome-ready") }),
  z.strictObject({
    type: z.literal("chrome-theme"),
    background: color,
    foreground: color,
    dark: z.boolean(),
  }),
  z.strictObject({ type: z.literal("navigate-history"), direction: z.enum(["back", "forward"]) }),
  z.strictObject({ type: z.literal("open-window"), url: text }),
  z.strictObject({ type: z.literal("notice-ready") }),
  z.strictObject({ type: z.literal("notice-card"), height: z.int().min(0).max(2147483647) }),
  z.strictObject({ type: z.literal("notice-hide") }),
  z.strictObject({ type: z.literal("notice-panel") }),
]);
export const nativeMessageSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("titlebar-geometry"),
    visible: z.boolean(),
    rect: z.strictObject({
      x: z.number().min(0),
      y: z.number().min(0),
      width: z.number().min(0),
      height: z.number().min(0),
    }),
  }),
  z.strictObject({
    type: z.literal("navigation-history"),
    canGoBack: z.boolean(),
    canGoForward: z.boolean(),
  }),
  z.strictObject({ type: z.literal("navigation-request"), url: text }),
  z.strictObject({ type: z.literal("notice"), notice: machineNoticeSchema.nullable() }),
]);
export const nativeAdapterSchema = z.strictObject({
  renderer: rendererMessageSchema,
  native: nativeMessageSchema,
  notice: machineNoticeSchema.nullable(),
});
export type RendererMessage = z.infer<typeof rendererMessageSchema>;
export type NativeMessage = z.infer<typeof nativeMessageSchema>;
export interface NativeMessageEvent {
  data: unknown;
}

export interface NativeWebView {
  postMessage(message: string): void;
  addEventListener(event: "message", listener: (event: NativeMessageEvent) => void): void;
  removeEventListener(event: "message", listener: (event: NativeMessageEvent) => void): void;
}

export function postRendererMessage(
  webview: Pick<NativeWebView, "postMessage"> | undefined,
  message: RendererMessage,
): boolean {
  if (!webview) return false;
  const parsed = rendererMessageSchema.safeParse(message);
  if (!parsed.success) return false;
  webview.postMessage(JSON.stringify(parsed.data));
  return true;
}
