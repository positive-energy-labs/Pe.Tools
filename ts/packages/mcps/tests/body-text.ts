/** A fake host reads what the client sent: every `BodyInit` shape, decoded once, as text. */
export const bodyText = (init?: RequestInit): Promise<string> =>
  new Response(init?.body ?? null).text();
