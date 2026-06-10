export type RuntimeAuthSource = string;

export type RuntimeAuthMethod =
  | {
      id: string;
      kind: "env_var";
      name: string;
      description: string;
      envName: string;
      optional: boolean;
    }
  | {
      id: string;
      kind: "agent";
      name: string;
      description: string;
    };

export interface RuntimeAuthDescriptor {
  source: RuntimeAuthSource;
  methods: RuntimeAuthMethod[];
  logoutSupported: boolean;
  metadata?: Record<string, unknown>;
}

export interface RuntimeAuthProfile {
  descriptor: RuntimeAuthDescriptor;
  logout?: () => Promise<void>;
}

export function createRuntimeAuthDescriptor(options: {
  source: RuntimeAuthSource;
  methods: RuntimeAuthMethod[];
  logoutSupported?: boolean;
  metadata?: Record<string, unknown>;
}): RuntimeAuthDescriptor {
  return stripUndefined({
    source: options.source,
    methods: options.methods,
    logoutSupported: options.logoutSupported === true,
    metadata: options.metadata,
  });
}

export function authenticateRuntimeMethod(
  descriptor: RuntimeAuthDescriptor,
  methodId: string,
): void {
  if (!descriptor.methods.some((method) => method.id === methodId)) {
    throw new Error(`Unsupported runtime auth method '${methodId}'.`);
  }
}

export async function logoutRuntimeAuth(profile: RuntimeAuthProfile | undefined): Promise<void> {
  if (!profile?.descriptor.logoutSupported || !profile.logout) {
    throw new Error("Runtime logout is not supported for this auth profile.");
  }

  await profile.logout();
}

function stripUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}
