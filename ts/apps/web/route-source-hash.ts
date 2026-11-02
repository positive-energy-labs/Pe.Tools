import { createHash } from "node:crypto";
/** Git checkouts may use LF or CRLF; source identity is independent of that setting. */
export const routeSourceHash = (source: string | Uint8Array) => createHash("sha256").update(source.toString().replaceAll("\r\n", "\n")).digest("hex");
