type AddressHistory = "push" | "replace";

/** Application/router adapter. Search values are codec text, never router-decoded JSON. */
export interface AdmittedAddressPort {
  read(): URLSearchParams;
  entry?(): string | number | undefined;
  /** Changes on every address notification, including traversal between identical URLs. */
  revision?(): number;
  write(search: URLSearchParams, history: AddressHistory): void;
  /** `traversed`: the address was reached by Back or Forward, so the entry is not ours to rewrite. */
  subscribe(listener: (traversed?: boolean) => void): () => void;
}
