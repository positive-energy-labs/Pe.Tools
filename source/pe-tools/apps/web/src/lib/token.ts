export function token(role: string): string {
  if (typeof document === "undefined") return "transparent";
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(`--pe-${role}`)
    .trim();
  if (!value || value.includes("var(")) throw new Error(`design token unavailable: ${role}`);
  return value;
}
