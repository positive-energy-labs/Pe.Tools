using Pe.Shared.Product;
using Pe.Shared.HostContracts;
using System.Diagnostics;
using System.IO;
using System.Net.Sockets;

namespace Pe.App.Host;

internal static class TsHostLauncher {
    public static TsHostLaunchResult EnsureRunning() {
        try {
            if (CanConnectToHostPort())
                return new TsHostLaunchResult(true, true, false, "TS host is already listening.");

            var runtimeResolution = ProductRuntimeAuthority.ResolveForCurrentMachine(ProductRuntimeLane.Installed);
            var hostExecutablePath = runtimeResolution.HostExecutablePath;
            if (!File.Exists(hostExecutablePath))
                return new TsHostLaunchResult(
                    false,
                    false,
                    false,
                    $"Installed TS host was not found: {hostExecutablePath}"
                );

            return StartAndWait(
                new ProcessStartInfo(hostExecutablePath) {
                    WorkingDirectory = Path.GetDirectoryName(hostExecutablePath) ?? AppContext.BaseDirectory,
                    UseShellExecute = true,
                    CreateNoWindow = true,
                    WindowStyle = ProcessWindowStyle.Hidden
                },
                $"Started installed TS host: {hostExecutablePath}"
            );
        } catch (Exception ex) {
            return new TsHostLaunchResult(false, false, false, ex.Message);
        }
    }

    private static TsHostLaunchResult StartAndWait(ProcessStartInfo startInfo, string successMessage) {
        var process = Process.Start(startInfo);
        var timeout = TimeSpan.FromMilliseconds(HostRuntimeDefaults.DefaultHostStartupTimeoutMs);
        var deadlineUtc = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < deadlineUtc) {
            Thread.Sleep(250);
            if (CanConnectToHostPort())
                return new TsHostLaunchResult(true, false, true, successMessage);
        }

        return new TsHostLaunchResult(
            false,
            false,
            true,
            $"Started TS host process {process?.Id.ToString() ?? "unknown"}, but {HostProcessIdentity.ResolveHostBaseUrl()} did not listen within {timeout.TotalSeconds:0.#} seconds."
        );
    }

    private static bool CanConnectToHostPort() {
        var uri = new Uri(HostProcessIdentity.ResolveHostBaseUrl());
        using var client = new TcpClient();
        var task = client.ConnectAsync(uri.Host, uri.Port);
        return task.Wait(HostRuntimeDefaults.DefaultHostProbeTimeoutMs) && client.Connected;
    }
}

internal sealed record TsHostLaunchResult(
    bool Success,
    bool AlreadyRunning,
    bool StartedProcess,
    string Message
);
