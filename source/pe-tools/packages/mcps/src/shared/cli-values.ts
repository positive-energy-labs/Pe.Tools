export function firstNonBlank(...values: unknown[]): string | undefined {
  return values
    .map(asOptionalString)
    .find((value) => value != null && value.trim().length > 0)
    ?.trim();
}

export function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
