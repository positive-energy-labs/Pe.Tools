export interface ThreadLandingApi {
  session: {
    listThreads(): Promise<readonly { id: string; updatedAt?: string | null }[]>;
    createThread(): Promise<{ id: string }>;
  };
}

export async function landThread(api: ThreadLandingApi): Promise<string> {
  const threads = await api.session.listThreads();
  const latest = [...threads].sort((left, right) =>
    (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""),
  )[0];
  return latest?.id ?? (await api.session.createThread()).id;
}
