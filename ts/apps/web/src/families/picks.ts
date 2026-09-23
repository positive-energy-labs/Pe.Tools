/** A matrix row's key: one family type, by name, so reloads cannot invalidate it. */
export const typeRowKey = (family: { familyName: string }, typeName: string) =>
  JSON.stringify([family.familyName, typeName]);
