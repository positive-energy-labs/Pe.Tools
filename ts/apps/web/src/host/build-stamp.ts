// The web build's trusted identity, baked by vite.config.ts from the host's one build-stamp source.
// `hostFetch` sends `build` as `x-pe-web-build`; the host admits it only when it equals the stamp it
// baked for the same web artifact.
declare const __PE_WEB_RECEIPT_BUILD__: { version: string; build: string; commit: string };
export const webBuildStamp = __PE_WEB_RECEIPT_BUILD__;
