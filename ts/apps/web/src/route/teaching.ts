import { declaredTeaching, type TeachingLayout } from "@pe/kit/lang/teach";
import { graphTeaching } from "@pe/kit";
import { publicRoutes } from "./route-discovery";
import { tutorialProducts } from "./tutorial-products.generated";
export const SHELL_REGIONS = {
  navigation: {
    id: "navigation",
    label: "Global navigation",
    purpose: "Choose a tool, work or Pea thread. Tutorial explains the current tool.",
  },
  workspace: {
    id: "workspace",
    label: "Workspace",
    purpose:
      "The selected tool opens here after host admission. Document access requires a local or paired device.",
  },
} as const;
const SHELL_LAYOUT = {
  id: "shell",
  axis: "vertical",
  target: "start",
  size: 56,
  start: SHELL_REGIONS.navigation,
  end: SHELL_REGIONS.workspace,
} as const satisfies TeachingLayout;
export const STARTUP_TEACHING = declaredTeaching(SHELL_LAYOUT);
export const tutorialProduct = (pathname: string) => {
  const key = publicRoutes.byAddress(pathname)?.manifest.key;
  return key && tutorialProducts.find(({ routes }) => Object.hasOwn(routes, key));
};
/** Single SPA index knows no requested route. First hydration always matches its public shell. */
export const referenceTeaching = (pathname: string) => {
  const route = publicRoutes.byAddress(pathname);
  return route ? graphTeaching(route.typed.data) : STARTUP_TEACHING;
};
