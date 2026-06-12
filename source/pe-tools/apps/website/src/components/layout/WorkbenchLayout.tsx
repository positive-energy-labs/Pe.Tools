import type { ReactNode } from "react";

export function WorkbenchLayout({
  header,
  left,
  center,
  right,
}: {
  header: ReactNode;
  left: ReactNode;
  center: ReactNode;
  right: ReactNode;
}) {
  return (
    <div className="workbench-shell">
      <header className="topbar">{header}</header>
      <main className="panes">
        <aside className="pane pane-left">{left}</aside>
        <section className="pane pane-center">{center}</section>
        <aside className="pane pane-right">{right}</aside>
      </main>
    </div>
  );
}
