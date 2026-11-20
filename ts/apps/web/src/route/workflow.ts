/** A stored `$schema` is the library path; a file written with an origin still names its library by path. */
export const isSpecOf = (schema: string | null | undefined, path: string | readonly string[]) => {
  if (!schema) return false;
  try {
    return [path].flat().includes(new URL(schema, "http://host").pathname);
  } catch {
    return false;
  }
};
