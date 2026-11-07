import { callCompose } from "../host/catalog-client";
export const readPageTarget = (slug: string, signal = new AbortController().signal) =>
  callCompose({ signal }, "page.target", { params: { slug } });
