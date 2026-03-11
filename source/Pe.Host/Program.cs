using Pe.Host.Contracts;
using Pe.Host;
using Pe.Host.Hubs;

var builder = WebApplication.CreateBuilder(args);
var options = BridgeHostOptions.FromEnvironment();

builder.Services.AddSingleton(options);
builder.Services.AddSingleton<BridgeServer>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<BridgeServer>());

builder.Services
    .AddSignalR(signalROptions => {
        signalROptions.EnableDetailedErrors = true;
        signalROptions.MaximumReceiveMessageSize = 1024 * 1024;
    })
    .AddNewtonsoftJsonProtocol(protocolOptions => {
        var settings = HostJson.CreateSerializerSettings();
        protocolOptions.PayloadSerializerSettings.NullValueHandling = settings.NullValueHandling;
        protocolOptions.PayloadSerializerSettings.ContractResolver = settings.ContractResolver;
        foreach (var converter in settings.Converters)
            protocolOptions.PayloadSerializerSettings.Converters.Add(converter);
    });

builder.Services.AddCors(corsOptions => corsOptions.AddDefaultPolicy(policy => policy
    .WithOrigins(options.AllowedOrigins.ToArray())
    .AllowAnyHeader()
    .AllowAnyMethod()
    .AllowCredentials()));

var app = builder.Build();

app.UseCors();
app.MapHub<BridgeHub>(HubRoutes.Default);

app.Logger.LogInformation(
    "Host listening on {BaseUrl} using pipe {PipeName}",
    options.SignalRBaseUrl,
    options.PipeName
);

app.Run(options.SignalRBaseUrl);
