/** The one runtime token read. `viz-*` and `dash-*` are their own raw families in base.css;
 * everything else is a `--pe-*` role. */
export function token(role: string): string {
  const name = role.startsWith("viz-") || role.startsWith("dash-") ? `--${role}` : `--pe-${role}`;
  if (typeof document === "undefined") return `var(${name})`;

  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!value || value.includes("var(")) {
    throw new Error(`design token unavailable: ${role}`);
  }
  return value;
}

/** Read a dash role this way only where a class cannot reach — a drawing serialized to a
 * standalone .svg carries no stylesheet. Everywhere else, wear the `dash-*` class. */
export type DashRole = "seam" | "reference" | "void";

export const dash = (role: DashRole): string => token(`dash-${role}`);
