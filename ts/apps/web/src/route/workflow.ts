/** One row of the confirmation sheet: what apply would do to one subject. */
export interface PlanEntry {
  id: string;
  name: string;
  /** Concrete edits the plan compiled. */
  actions: number;
  /** Where the edits came from, as the plan reported it. */
  detail: string;
  /** Why this row cannot be applied (a refusal, or nothing to do); null = applicable. */
  flag: string | null;
  warnings: readonly string[];
  /** The sealed plan's Apply selection key, when it differs from the displayed row identity. */
  hashKey?: string;
}

/** The plan apply confirms (dogma law 9), as the plan workflow returned it. */
export interface PlanSheet {
  entries: readonly PlanEntry[];
}

/** `$schema` is an absolute URL on whichever host served it; the path is what names the library. */
export const isSpecOf = (schema: string | null | undefined, path: string | readonly string[]) => {
  if (!schema) return false;
  try {
    return [path].flat().includes(new URL(schema, "http://host").pathname);
  } catch {
    return false;
  }
};
