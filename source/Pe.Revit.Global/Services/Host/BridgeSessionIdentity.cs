using Pe.Shared.HostContracts.Bridge;
using Pe.Shared.Product;
using Serilog;

namespace Pe.Revit.Global.Services.Host;

/// <summary>
/// Resolves the identity + selector metadata this Revit session reports at bridge registration.
/// Identity is only the process tuple (pid + processStartUtc) — the broker hashes it into the
/// session id and returns it in the ack. Lane/sandboxId/buildStamp are selectors/metadata:
/// descriptor-launched sessions read them from the validated PE_REVIT_SESSION_DESCRIPTOR file;
/// descriptor-less sessions report installed metadata from the runtime descriptor beside the
/// loaded payload. PE_REVIT_LOADED_PAYLOAD_* supplies only the loaded payload path, never these
/// fields.
/// </summary>
internal sealed record BridgeSessionIdentity(
    long ProcessStartUtcUnixMs,
    string? SessionDescriptorPath,
    string? Lane,
    string? SandboxId,
    string? BuildStamp
) {
    private const string SessionDescriptorEnvironmentVariable = "PE_REVIT_SESSION_DESCRIPTOR";
    private const string InstalledLane = "installed";

    public static BridgeSessionIdentity Resolve() {
        long processStartUtcUnixMs = 0;
        try {
            using var process = Process.GetCurrentProcess();
            processStartUtcUnixMs = new DateTimeOffset(process.StartTime.ToUniversalTime())
                .ToUnixTimeMilliseconds();
        } catch (Exception ex) {
            // Absent identity keeps the broker's bridge-${uuid} fallback path; never fail registration.
            Log.Warning(ex, "Bridge session identity could not read the current process start time.");
        }

        var payloadDirectory = ResolvePayloadDirectory();
        return FromSessionDescriptor(processStartUtcUnixMs, payloadDirectory)
               ?? FromInstalledRuntimeContext(processStartUtcUnixMs, payloadDirectory);
    }

    /// <summary>Descriptor-launched session: PE_REVIT_SESSION_DESCRIPTOR names the launch receipt.</summary>
    private static BridgeSessionIdentity? FromSessionDescriptor(
        long processStartUtcUnixMs,
        string? payloadDirectory
    ) {
        var descriptorValue = Environment.GetEnvironmentVariable(SessionDescriptorEnvironmentVariable);
        if (string.IsNullOrWhiteSpace(descriptorValue))
            return null;

        string descriptorPath;
        string descriptorJson;
        try {
            descriptorPath = Path.GetFullPath(descriptorValue);
            if (!File.Exists(descriptorPath)) {
                Log.Warning(
                    "Session descriptor '{DescriptorPath}' does not exist; reporting installed runtime metadata instead.",
                    descriptorPath);
                return null;
            }

            descriptorJson = File.ReadAllText(descriptorPath);
        } catch (Exception ex) {
            Log.Warning(ex, "Session descriptor '{DescriptorValue}' could not be read.", descriptorValue);
            return null;
        }

        var descriptor = BridgeSessionDescriptor.TryParse(descriptorJson);
        if (descriptor is null) {
            Log.Warning("Session descriptor '{DescriptorPath}' is not valid JSON.", descriptorPath);
            return null;
        }

        // The env var belongs to the whole Revit process; only the payload the descriptor actually
        // describes may adopt its metadata (mirrors the loader's assembly gate).
        if (!descriptor.DescribesPayloadDirectory(payloadDirectory)) {
            Log.Information(
                "Session descriptor '{DescriptorPath}' describes payload '{DescriptorPayloadPath}', not this payload '{PayloadDirectory}'; ignoring it.",
                descriptorPath,
                descriptor.PayloadPath,
                payloadDirectory);
            return null;
        }

        // D6 observability: a sandbox descriptor does NOT get its own host/runtime lane — the
        // sandbox Pe.App shares the one installed host, port, and service file by design (the
        // ProductRuntimeLane enum answers "which binaries am I using", and for a sandbox that is
        // genuinely "installed"). The bridge still attributes the session as sandbox here; this log
        // makes the intentional sharing observable rather than silent. See docs/adr/0002.
        if (descriptor.Lane == "sandbox")
            Log.Information(
                "Sandbox session (descriptor '{DescriptorPath}') shares the one installed host, port, and service file by design; the bridge still attributes it as 'sandbox'.",
                descriptorPath);

        return new BridgeSessionIdentity(
            processStartUtcUnixMs,
            descriptorPath,
            descriptor.Lane,
            descriptor.SandboxId,
            descriptor.BuildStamp
        );
    }

    /// <summary>
    /// Descriptor-less session: report installed metadata from the runtime descriptor the build/
    /// installer wrote beside the loaded payload (Pe.App.runtime.json).
    /// </summary>
    private static BridgeSessionIdentity FromInstalledRuntimeContext(
        long processStartUtcUnixMs,
        string? payloadDirectory
    ) {
        if (payloadDirectory is null)
            return new BridgeSessionIdentity(processStartUtcUnixMs, null, InstalledLane, null, null);

        var runtimeDescriptorPath = Path.Combine(
            payloadDirectory,
            RevitDeploymentIdentity.RuntimeDescriptorFileName
        );
        try {
            if (File.Exists(runtimeDescriptorPath)) {
                var descriptor = BridgeSessionDescriptor.TryParse(File.ReadAllText(runtimeDescriptorPath));
                if (descriptor is not null) {
                    return new BridgeSessionIdentity(
                        processStartUtcUnixMs,
                        null,
                        descriptor.Lane ?? InstalledLane,
                        descriptor.SandboxId,
                        descriptor.BuildStamp
                    );
                }
            }
        } catch (Exception ex) {
            Log.Warning(ex, "Runtime descriptor '{RuntimeDescriptorPath}' could not be read.", runtimeDescriptorPath);
        }

        return new BridgeSessionIdentity(processStartUtcUnixMs, null, InstalledLane, null, null);
    }

    private static string? ResolvePayloadDirectory() {
        try {
            var location = typeof(BridgeSessionIdentity).Assembly.Location;
            return string.IsNullOrWhiteSpace(location) ? null : Path.GetDirectoryName(location);
        } catch (Exception ex) {
            Log.Warning(ex, "Bridge session identity could not resolve the loaded payload directory.");
            return null;
        }
    }
}
