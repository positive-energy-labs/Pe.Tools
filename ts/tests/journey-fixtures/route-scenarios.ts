type Scenario = {
  path(input: { revit?: boolean; thread: string }): string;
  config: string;
  attach?: true;
  headless?: true;
  revit?: true;
};
export const scenarios: Partial<Record<string, Scenario>> = {
  chaos: {
    path: ({ thread }) => `/duct-systems?fixture=navigation&thread=${thread}`,
    config: "tests/e2e/route-chaos.config.ts",
    attach: true,
  },
  selection: {
    path: () => "/",
    config: "tests/e2e/product-selection.config.ts",
    headless: true,
  },
  "conversation-work": {
    path: () => "/pea",
    config: "tests/e2e/conversation-work.config.ts",
  },
  fans: {
    path: ({ revit }) => `/fans${revit ? "" : "?demo=navigation"}`,
    config: "products/fans/web/journeys/fans-reds.config.ts",
    attach: true,
    headless: true,
    revit: true,
  },
};
