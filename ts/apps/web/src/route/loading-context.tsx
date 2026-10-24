import type { ReactNode } from "react";

export function LoadingContext({
  name,
  says,
  error,
  busy = true,
  children,
}: {
  name: string;
  says: ReactNode;
  error?: string | null;
  busy?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={`${name} loading`}
      aria-busy={busy && !error}
      className="flex flex-col gap-4 p-6 overflow-auto"
    >
      <header className="flex flex-col gap-2">
        <h1 className="t-title">{name}</h1>
        <p role={error ? "alert" : "status"} data-tone={error ? "caution" : undefined}>
          {error ?? says}
        </p>
      </header>
      {children}
    </section>
  );
}
