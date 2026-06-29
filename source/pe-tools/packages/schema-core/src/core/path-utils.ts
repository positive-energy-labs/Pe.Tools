import type { Path } from "./path.ts";

function decodePointerSegment(segment: string): string {
  return segment.replaceAll("~1", "/").replaceAll("~0", "~");
}

function encodePointerSegment(segment: string): string {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}

export function jsonPointerToPath(pointer: string): string[] {
  const normalized = pointer.startsWith("#") ? pointer.slice(1) : pointer;
  if (!normalized) {
    return [];
  }
  if (!normalized.startsWith("/")) {
    return [];
  }
  return normalized.slice(1).split("/").map(decodePointerSegment);
}

export function jsonPointerToPathTyped(pointer: string): Path {
  return jsonPointerToPath(pointer).map((segment) =>
    /^\d+$/.test(segment) ? Number.parseInt(segment, 10) : segment,
  );
}

export function pathToJsonPointer(path: Path): string {
  if (path.length === 0) {
    return "";
  }
  const encoded = path.map((part) => encodePointerSegment(String(part)));
  return `/${encoded.join("/")}`;
}

export function parsePathString(path: string): Path {
  if (!path) {
    return [];
  }

  return path.split(".").map((segment) => {
    if (/^\d+$/.test(segment)) {
      return Number.parseInt(segment, 10);
    }
    return segment;
  });
}
