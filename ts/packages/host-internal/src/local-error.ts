export class LocalOpError {
  readonly _tag = "LocalOpError";
  constructor(
    readonly key: string,
    readonly note: string,
    readonly statusCode?: number,
  ) {}
  get message() {
    return `${this.key} failed in @pe/host: ${this.note}`;
  }
}

export function localOpHttpStatus(error: unknown): number {
  return error instanceof LocalOpError && error.statusCode ? error.statusCode : 500;
}
