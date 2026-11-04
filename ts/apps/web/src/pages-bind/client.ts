import { callCompose } from "#/shell/readings-api";
export const readPageTarget = (slug: string, signal = new AbortController().signal) =>
  callCompose({ signal }, "page.target", { params: { slug } });
