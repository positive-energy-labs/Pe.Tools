export type Queue = {
  items: { id: string; content: string; attachments: number }[];
  paused: boolean;
  error?: string;
};

export async function readQueue(url: string, signal: AbortSignal): Promise<Queue> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error("Could not read queued messages.");
  return (await response.json()) as Queue;
}

export async function writeQueue(url: string, body: object): Promise<Queue> {
  const response = await fetch(url, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const next = (await response.json()) as Queue;
  if (!response.ok) throw new Error(next.error ?? "Queue change failed.");
  return next;
}
