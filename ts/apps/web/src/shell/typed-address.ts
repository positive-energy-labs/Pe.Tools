export type AddressHistory = "push" | "replace";

/** Application/router adapter. Search values are codec text, never router-decoded JSON. */
export interface AdmittedAddressPort {
  read(): URLSearchParams;
  write(search: URLSearchParams, history: AddressHistory): void;
  subscribe(listener: () => void): () => void;
}
