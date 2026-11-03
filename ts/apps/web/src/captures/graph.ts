import type { RouteDirectory } from "@pe/agent-contracts";
export { capturesData as capturesGraph } from "./kernel";
export const capturesDirectory = {
  path: "/captures",
  title: "Captures",
  label: "Revit data",
  exposure: "Preview",
  runtimeNeed: "Host retained view images",
  icon: "Image",
  category: "Coordinate model data",
  blurb:
    "Every picture taken of a Revit view, newest first — who took it, which view, the receipt, and the URL a page or a chat links.",
  aliases: ["Revit", "data"],
  listed: true,
  satellites: [],
  surfaces: {
    web: "full",
    pwa: "full",
    tray: false,
  },
} satisfies RouteDirectory;
