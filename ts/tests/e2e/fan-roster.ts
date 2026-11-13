const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Kind/status text follows the port without whitespace, so only another digit extends it. */
export const fanRosterLabel = (label: string) => new RegExp(`^${escape(label)}(?!\\d)`);

export const fanRosterRow = (mark: string, port: number) =>
  new RegExp(`^${escape(mark)}(?: · .*)? / port ${port}(?!\\d)`);
