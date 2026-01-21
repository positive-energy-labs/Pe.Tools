using Autodesk.Revit.UI;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Pe.Global.Services.SignalR.Actions;
using Pe.Global.Services.SignalR.Hubs;
using ricaun.Revit.UI.Tasks;
using Serilog;

namespace Pe.Global.Services.SignalR;

/// <summary>
///     Self-hosted SignalR server for the settings editor frontend.
///     Runs as a Kestrel instance within the Revit add-in process.
/// </summary>
public class SettingsEditorServer : IDisposable {
    private WebApplication? _app;
    private readonly int _port;
    private bool _isRunning;

    /// <summary>
    ///     The default port for the settings editor server.
    /// </summary>
    public const int DefaultPort = 5150;

    public SettingsEditorServer(int port = DefaultPort) {
        this._port = port;
    }

    /// <summary>
    ///     Whether the server is currently running.
    /// </summary>
    public bool IsRunning => this._isRunning;

    /// <summary>
    ///     The URL the server is listening on.
    /// </summary>
    public string Url => $"http://localhost:{this._port}";

    /// <summary>
    ///     Start the SignalR server.
    /// </summary>
    /// <param name="uiApp">The Revit UIApplication instance</param>
    /// <param name="configureServices">Optional callback to configure additional services</param>
    /// <param name="configureActionRegistry">Optional callback to register action handlers</param>
    public async Task StartAsync(
        UIApplication uiApp,
        Action<IServiceCollection>? configureServices = null,
        Action<ActionRegistry>? configureActionRegistry = null) {
        if (this._isRunning) {
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
                .AddNewtonsoftJsonProtocol(options => options.PayloadSerializerSettings.NullValueHandling = Newtonsoft.Json.NullValueHandling.Ignore);

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
            
            // Create RevitTaskService for thread marshaling
            var revitTaskService = new RevitTaskService(uiApp);
            revitTaskService.Initialize();
            _ = builder.Services.AddSingleton(revitTaskService);
            _ = builder.Services.AddSingleton<RevitTaskQueue>();
            
            _ = builder.Services.AddSingleton<SettingsTypeRegistry>();

            // Register action registry and allow consumers to configure it
            var actionRegistry = new ActionRegistry();
            configureActionRegistry?.Invoke(actionRegistry);
            _ = builder.Services.AddSingleton(actionRegistry);

            // Allow consumers to add additional services
            configureServices?.Invoke(builder.Services);

            // Configure Kestrel
            _ = builder.WebHost.UseUrls(this.Url);
            _ = builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = 10 * 1024 * 1024);

            this._app = builder.Build();

            // Configure middleware
            _ = this._app.UseCors();

            // Map hubs
            _ = this._app.MapHub<SchemaHub>("/hubs/schema");
            _ = this._app.MapHub<SettingsHub>("/hubs/settings");
            _ = this._app.MapHub<ActionsHub>("/hubs/actions");

            // Start the server
            await this._app.StartAsync();
            this._isRunning = true;

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
        if (!this._isRunning || this._app == null) return;

        try {
            await this._app.StopAsync();
            this._isRunning = false;
            Log.Information("SettingsEditorServer stopped");
        } catch (Exception ex) {
            Log.Error(ex, "Error stopping SettingsEditorServer");
        }
    }

    public void Dispose() {
        if (this._app != null) {
            this.StopAsync().Wait();
            this._app.DisposeAsync().AsTask().Wait();
            this._app = null;
        }
    }
}
