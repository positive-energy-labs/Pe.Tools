using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Pe.Global.Services.SignalR.Hubs;
using Pe.Global.Services.Storage.Modules;
using ricaun.Revit.UI.Tasks;
using Serilog;

namespace Pe.Global.Services.SignalR;

/// <summary>
///     Self-hosted SignalR server for the external settings-editor frontend.
///     Runs as a Kestrel instance within the Revit add-in process.
/// </summary>
public class SettingsEditorServer : IDisposable {
    /// <summary>
    ///     The default port for the settings editor server.
    /// </summary>
    public const int DefaultPort = 5150;

    private readonly int _port;
    private WebApplication? _app;

    public SettingsEditorServer(int port = DefaultPort) => this._port = port;

    /// <summary>
    ///     Whether the server is currently running.
    /// </summary>
    public bool IsRunning { get; private set; }

    /// <summary>
    ///     The URL the server is listening on.
    /// </summary>
    public string Url => $"http://localhost:{this._port}";

    public void Dispose() {
        if (this._app != null) {
            this.StopAsync().Wait();
            this._app.DisposeAsync().AsTask().Wait();
            this._app = null;
        }
    }

    /// <summary>
    ///     Start the SignalR server.
    /// </summary>
    /// <param name="uiApp">The Revit UIApplication instance</param>
    /// <param name="configureServices">Optional callback to configure additional services</param>
    /// <param name="configureActionRegistry">Optional callback to register action handlers</param>
    /// <param name="configureModules">Optional callback to register settings modules</param>
    public async Task StartAsync(
        UIApplication uiApp,
        Action<IServiceCollection>? configureServices = null,
        Action<SettingsModuleRegistry>? configureModules = null) {
        if (this.IsRunning) {
            Log.Warning("SettingsEditorServer is already running");
            return;
        }

        try {
            var builder = WebApplication.CreateBuilder();

            // Configure logging to use Serilog
            _ = builder.Logging.ClearProviders();
            _ = builder.Logging.AddSerilog();

            // Configure SignalR
            _ = builder.Services.AddSignalR(options => {
                options.EnableDetailedErrors = true;
                options.MaximumReceiveMessageSize = 1024 * 1024; // 1MB
            })
                .AddNewtonsoftJsonProtocol(SettingsEditorJson.ConfigureProtocol);

            // Configure CORS for development
            _ = builder.Services.AddCors(options => options.AddDefaultPolicy(policy => _ = policy.WithOrigins(
                    "http://localhost:5173", // Vite dev server
                    "http://localhost:3000", // Create React App
                    "http://127.0.0.1:5173",
                    "http://127.0.0.1:3000"
                )
                .AllowAnyHeader()
                .AllowAnyMethod()
                .AllowCredentials()));

            // Register core services
            var revitContext = new RevitContext(uiApp);
            _ = builder.Services.AddSingleton(revitContext);
            _ = builder.Services.AddSingleton(uiApp.Application);

            // Create RevitTaskService for thread marshaling
            var revitTaskService = new RevitTaskService(uiApp);
            revitTaskService.Initialize();
            _ = builder.Services.AddSingleton(revitTaskService);
            _ = builder.Services.AddSingleton<RevitTaskQueue>();

            // Register module registry
            var moduleRegistry = new SettingsModuleRegistry();
            configureModules?.Invoke(moduleRegistry);

            _ = builder.Services.AddSingleton(moduleRegistry);
            _ = builder.Services.AddSingleton<DocumentStateNotifier>();
            _ = builder.Services.AddSingleton<EndpointThrottleGate>();

            // Allow consumers to add additional services
            configureServices?.Invoke(builder.Services);

            // Configure Kestrel
            _ = builder.WebHost.UseUrls(this.Url);
            _ = builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = 10 * 1024 * 1024);

            this._app = builder.Build();
            this._app.Services.GetRequiredService<DocumentStateNotifier>().InitializeSubscriptions();

            // Configure middleware
            _ = this._app.UseCors();

            // Map hub
            _ = this._app.MapHub<SettingsEditorHub>("/hubs/settings-editor");

            // Start the server
            await this._app.StartAsync();
            this.IsRunning = true;

            Log.Information("SettingsEditorServer started on {Url}", this.Url);
        } catch (Exception ex) {
            Log.Error(ex, "Failed to start SettingsEditorServer");
            throw;
        }
    }

    /// <summary>
    ///     Stop the server.
    /// </summary>
    public async Task StopAsync() {
        if (!this.IsRunning || this._app == null) return;

        try {
            await this._app.StopAsync();
            this.IsRunning = false;
            Log.Information("SettingsEditorServer stopped");
        } catch (Exception ex) {
            Log.Error(ex, "Error stopping SettingsEditorServer");
        }
    }
}