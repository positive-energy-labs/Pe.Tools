import { paneLayout } from "@pe/web-kernel/route";
import { route } from "@pe/web-kernel/route";
import { draw } from "@pe/web-kernel/route/draw";
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
      body: "scroll",
      draw: draw("scroll", () => import("./mount"), "DesignSystemBody"),
    },
  },
  layout: paneLayout("main"),
});
