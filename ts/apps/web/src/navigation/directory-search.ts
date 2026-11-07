/** The directory draws only its own filters; the shell owns the rest of Page. */
export interface DirectorySearch {
  readonly query: string;
  readonly exposure: "All" | "Main" | "Preview" | "Archive";
  readonly sort: "workflow" | "name";
  readonly folded: readonly string[];
}
