import { createFileRoute, stripSearchParams, type SearchSchemaInput } from "@tanstack/react-router";
import { Directory } from "#/navigation/directory";
import {
  directorySearch,
  DIRECTORY_DEFAULTS,
  type DirectorySearch,
} from "#/navigation/directory-search";

export const Route = createFileRoute("/")({
  validateSearch: (search: SearchSchemaInput & Partial<DirectorySearch>) =>
    directorySearch({ ...search }),
  search: { middlewares: [stripSearchParams(DIRECTORY_DEFAULTS)] },
  component: Directory,
});
