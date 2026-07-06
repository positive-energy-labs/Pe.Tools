using Nice3point.Revit.Toolkit.External;
using Pe.Revit.Loader;

namespace Pe.App;

/// <summary>
///     Dev-lane entry point: Revit loads Pe.App directly (classic deploy, hot reload intact) and
///     this adapter self-hosts <see cref="AppCore"/>. The installed lane never touches this class —
///     there, Pe.Revit.Loader instantiates AppCore from the current version dir and can live-swap it.
///     Note: the toolkit's Revit-facing OnShutdown(UIControlledApplication) calls the parameterless
///     virtual — the pre-migration `new Result OnShutdown(UIControlledApplication)` here was dead
///     code, so bridge/task-service teardown never ran on Revit exit until now.
/// </summary>
[UsedImplicitly]
public class Application : ExternalApplication {
    private AppCore? _core;

    public override void OnStartup() {
        this._core = new AppCore();
        this._core.Startup(PePayloadContext.CreateSelfHosted(this.Application));
    }

    public override void OnShutdown() => this._core?.Shutdown();
}
