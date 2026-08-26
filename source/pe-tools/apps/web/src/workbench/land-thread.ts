export interface ThreadLandingApi {
  session: {
    listThreads(): Promise<readonly { id: string; updatedAt?: string | null }[]>;
  };
}

export async function landThread(api: ThreadLandingApi): Promise<string | undefined> {
  const threads = await api.session.listThreads();
  const latest = [...threads].sort((left, right) =>
    (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""),
  )[0];
  return latest?.id;
}
