export async function saveApiKey(origin: string, provider: string, apiKey: string) {
  const response = await fetch(`${origin}/pe/credentials/${encodeURIComponent(provider)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ apiKey }),
  });
  if (!response.ok) throw new Error(`credentials ${response.status}`);
}
