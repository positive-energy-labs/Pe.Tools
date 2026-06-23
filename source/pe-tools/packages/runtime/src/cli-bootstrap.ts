/** Parse an optional `--port` flag value into a validated port number. */
export function parseOptionalPort(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 0 || port > 65_535)
    throw new Error(`Invalid port: ${value}`);
  return port;
}
