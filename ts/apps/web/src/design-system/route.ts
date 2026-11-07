import { route } from "../route/typed-route";
import { draw } from "../route/draw";
export const module = route({
  key: "design-system",
  name: "Design System",
  needs: "browser",
  directory: {
    label: "Design language",
    exposure: "Preview",
    group: "Explore / maintain",
    icon: "Palette",
    runtimeNeed: "Browser component catalogue",
    summary: "Production design language, laws and component specimens",
    aliases: ["Design", "language"],
    listed: true,
    satellites: ["band", "list", "arming", "popovers", "swatch", "revit"].map((name) => ({
      to: `/design-system/${name}`,
      label: name,
    })),
    surfaces: { web: "full", pwa: "full", tray: false },
  },
  fields: {},
  panes: {
    main: {
      title: "Design System",
      purpose: "Browse laws and production specimens",
      draw: draw(() => import("./mount"), "DesignSystemBody"),
    },
  },
  layout: { kind: "pane", id: "main" },
});
