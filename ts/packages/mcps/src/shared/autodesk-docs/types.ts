export const docsSources = ["api", "help", "blog", "tbc", "au"] as const;
export type DocsSource = (typeof docsSources)[number];

/** Uniform search hit shared by every non-API source. */
export type DocsHit = {
  source: Exclude<DocsSource, "api">;
  title: string;
  url: string;
  date?: string;
  snippet?: string;
};
