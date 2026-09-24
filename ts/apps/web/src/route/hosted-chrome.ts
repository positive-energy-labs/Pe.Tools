import { createContext, type ReactNode } from "react";

/**
 * The host pane's own controls (Chat's close and focus chip), drawn at the end of the hosted
 * route's head cluster so a hosted route has one head, not a pane rail above its own.
 */
export const HostedChrome = createContext<ReactNode>(null);
