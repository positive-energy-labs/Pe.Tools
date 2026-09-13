/**
 * Whole-shell compositions under comparison. `?shell=<key>` on any route swaps the chrome while
 * the route body stays put. Baseline is `RouteShell` itself. Losers are deleted on verdict.
 */
import type { ComponentType } from "react";

import type { ShellProps } from "../shell";
import { SentenceShell } from "./sentence";
import { StandingShell } from "./standing";

export const SHELLS: Record<string, ComponentType<ShellProps<any, any, any, any>>> = {
  sentence: SentenceShell,
  standing: StandingShell,
};
