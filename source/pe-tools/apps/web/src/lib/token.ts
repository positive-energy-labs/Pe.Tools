export function token(role: string): string {
  const name = role.startsWith("viz-") ? `--${role}` : `--pe-${role}`;
  if (typeof document === "undefined") return `var(${name})`;

  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!value || value.includes("var(")) {
    throw new Error(`design token unavailable: ${role}`);
  }
  return value;
}
