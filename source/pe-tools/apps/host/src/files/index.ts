import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { Effect, FileSystem } from "effect";
import { LocalOpError } from "../local-error.ts";

export type DirectoryEntryInfo = { name: string; info: FileSystem.File.Info };

export const readFileString = Effect.fnUntraced(function* (path: string, operationKey: string) {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs
    .readFileString(path)
    .pipe(Effect.mapError((error) => localOpFileError(operationKey, error)));
});

export const readFileStringOrEmpty = Effect.fnUntraced(function* (
  path: string,
  operationKey: string,
) {
  const result = yield* Effect.result(readFileString(path, operationKey));
  return result._tag === "Success" ? result.success : "";
});

export const writeFileStringAtomic = Effect.fnUntraced(function* (
  path: string,
  content: string,
  operationKey: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const tempPath = `${path}.${randomUUID()}.tmp`;
  yield* fs
    .writeFileString(tempPath, content)
    .pipe(Effect.mapError((error) => new LocalOpError(operationKey, error.message)));
  return yield* fs
    .rename(tempPath, path)
    .pipe(Effect.mapError((error) => new LocalOpError(operationKey, error.message)));
});

export const makeDirectory = Effect.fnUntraced(function* (path: string, operationKey: string) {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs
    .makeDirectory(path, { recursive: true })
    .pipe(Effect.mapError((error) => new LocalOpError(operationKey, error.message)));
});

export const statFile = Effect.fnUntraced(function* (path: string, operationKey: string) {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs
    .stat(path)
    .pipe(Effect.mapError((error) => new LocalOpError(operationKey, error.message)));
});

export const statOrNull = Effect.fnUntraced(function* (path: string, operationKey: string) {
  const result = yield* Effect.result(statFile(path, operationKey));
  return result._tag === "Success" ? result.success : null;
});

export const readDirectoryEntriesOrEmpty = Effect.fnUntraced(function* (
  directory: string,
  operationKey: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const namesResult = yield* Effect.result(
    fs
      .readDirectory(directory)
      .pipe(Effect.mapError((error) => new LocalOpError(operationKey, error.message))),
  );
  if (namesResult._tag === "Failure") return [];
  const entries = yield* Effect.all(
    namesResult.success.map((name) =>
      statOrNull(join(directory, name), operationKey).pipe(
        Effect.map((info): DirectoryEntryInfo | null => (info ? { name, info } : null)),
      ),
    ),
  );
  return entries.filter((entry): entry is DirectoryEntryInfo => entry != null);
});

function localOpFileError(operationKey: string, error: unknown): LocalOpError {
  return new LocalOpError(operationKey, errorMessage(error), isNotFound(error) ? 404 : undefined);
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "reason" in error &&
    typeof error.reason === "object" &&
    error.reason !== null &&
    "_tag" in error.reason &&
    error.reason._tag === "NotFound"
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
