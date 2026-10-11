import {
  HOST_RUNTIME_SERVICE_HEADER,
  HOST_RUNTIME_SERVICE_QUERY,
} from "@pe/host-contracts/contracts";

// Frozen into the served page's module graph: a reused port must never change its owner.
const serviceName: string = import.meta.env.PE_RUNTIME_SERVICE;

export function hostFetch(url: string, init?: RequestInit): Promise<Response> {
  if (!serviceName) throw new Error("This page has no runtime owner.");
  const headers = new Headers(init?.headers);
  headers.set(HOST_RUNTIME_SERVICE_HEADER, serviceName);
  return fetch(url, { ...init, headers });
}

export function runtimeStreamUrl(url: string): string {
  if (!serviceName) throw new Error("This page has no runtime owner.");
  const bound = new URL(url, window.location.href);
  bound.searchParams.set(HOST_RUNTIME_SERVICE_QUERY, serviceName);
  return bound.href;
}
