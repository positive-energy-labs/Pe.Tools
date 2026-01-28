# Palette Dev and Best Practice

## Preview Panels

Preview panels use the `ISidebarPanel<TItem>` contract which the PaletteFactory
wires automatically.

Defaults handled by Palette

- Updates are scheduled at `DispatcherPriority.ApplicationIdle`.
- Selection changes debounce and provide a cancellation token.
- `Clear()` is called immediately on selection change.

Do

- Keep `Update()` lightweight; assume it runs on the UI thread.
- Check `CancellationToken` between expensive steps.
- Cache preview data per item when possible.
- Prefer quick summaries over full detail when data is heavy.
- Guard null/empty items early and return.

Avoid

- Manual `Dispatcher.BeginInvoke` in panels for priority scheduling.
- Long Revit API calls or heavy IO in preview; defer or summarize.
- Recomputing the same preview data for each selection.

Optional enhancements

- Split preview into quick vs. heavy sections.
- Defer heavy sections behind user action (expand button, “load details”).
