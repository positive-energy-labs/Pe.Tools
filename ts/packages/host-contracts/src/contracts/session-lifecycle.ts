// Hand-authored request contract for the host's POST /sessions lifecycle relay.
// One shape, shared by the host route (parse/validate) and the web client (build) —
// the field requirements mirror the pe-revit CLI's own invocation contract.
import type { HostLane } from "../service-identity.js";

export type SessionAction = "start" | "stop" | "restart";

export type SessionActionRequest = {
  readonly action: SessionAction;
  readonly id?: string;
  readonly year?: string;
  /**
   * Payload source for `start`, the CLI's own words: `installed` (default, a project-less start)
   * or `dev` (the host's checkout Pe.App; refused on a host with no checkout). Explicit, never
   * inferred from the host's lane (BB-1 F-14).
   */
  readonly lane?: HostLane;
  readonly doc?: string;
  /** Required by the CLI when `doc` is a cloud target: the explicit cloud conflict answer. */
  readonly conflictPolicy?: "keep" | "discard-latest";
  readonly force?: boolean;
  readonly timeoutSeconds?: number;
};
