/**
 * One source map for host serving and payload staging, relative to this module. A leaf with no host
 * imports, so payload staging can read it without resolving a host lane (row 5 build).
 */
export const PAGE_LIBRARY_SOURCES = {
  "pe.js": "./pages/pe.js",
  "pe.css": "./pages/pe.css",
  "base.css": "../../../packages/kit/src/base.css",
  "revit.js": "../../web/src/revit/revit.js",
  "revit.css": "../../web/src/revit/revit.css",
  "kit/pe-kit.js": "../../../packages/kit/dist/pe-kit.js",
  "kit/pe-kit.css": "../../../packages/kit/dist/pe-kit.css",
} as const;
