using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Win32;

namespace Pe.Host.Tray;

internal sealed record InstalledPwa(string AppId, string UserDataRoot, string Profile);
internal sealed record PwaRegistration(string Command, string Icon);
internal sealed record PackagedPwa(string AppId, string Profile, string StartUrl, string EdgeIdentity);

internal static class PwaLauncher {
    internal static string StandardProfileRoot => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Microsoft", "Edge", "User Data");
    internal static async Task<InstalledPwa?> ResolveAsync(string origin, CancellationToken stop = default) {
        if (EdgeExecutable is not { } edge) throw new InvalidOperationException("Microsoft Edge is unavailable");
        using var http = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false }) { Timeout = TimeSpan.FromSeconds(2) };
        using var response = await http.GetAsync(origin + "/manifest.json", stop);
        response.EnsureSuccessStatusCode();
        using var manifest = JsonDocument.Parse(await response.Content.ReadAsStringAsync(stop));
        var identity = ManifestIdentity(origin, manifest.RootElement);
        if (identity is null) throw new InvalidDataException("Frontend manifest identity is unavailable");
        var privateRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Positive Energy", "Pe.Tools", "edge-app");
        var roots = new[] { StandardProfileRoot, privateRoot }.Concat(Directory.Exists(privateRoot)
            ? Directory.EnumerateDirectories(privateRoot, "dev-*") : []);
        return Match(identity, edge, roots, Registrations(), File.Exists)
            ?? MatchPackaged(identity, await PackagedRegistrationsAsync(stop), StandardProfileRoot, Directory.Exists);
    }

    internal static async Task<int> LaunchWindowAsync(string destination) {
        if (!Uri.TryCreate(destination, UriKind.Absolute, out var uri) || uri.Scheme != "http" || !uri.IsLoopback
            || !TrayContext.TryGetWindowUrl(destination, uri.GetLeftPart(UriPartial.Authority), out var canonical)
            || EdgeExecutable is not { } edge) return 1;
        var origin = uri.GetLeftPart(UriPartial.Authority);
        var installed = await ResolveAsync(origin);
        Process.Start(Launch(edge, origin, canonical, installed, StandardProfileRoot))?.Dispose();
        return 0;
    }
    internal static string? EdgeExecutable => new[] { Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles) }
        .Select(root => Path.Combine(root, "Microsoft", "Edge", "Application", "msedge.exe")).FirstOrDefault(File.Exists);

    // Chromium GenerateAppIdFromManifestId hashes twice; this is identity verification, never installation evidence.
    internal static string AppId(Uri manifestId) {
        var bytes = SHA256.HashData(SHA256.HashData(Encoding.UTF8.GetBytes(manifestId.AbsoluteUri)));
        return string.Concat(bytes.Take(16).SelectMany(value => new[] { (char)('a' + (value >> 4)), (char)('a' + (value & 15)) }));
    }

    internal static Uri? ManifestIdentity(string origin, JsonElement manifest) {
        var basis = new Uri(origin + "/manifest.json");
        if (!manifest.TryGetProperty("id", out var id) || id.ValueKind != JsonValueKind.String
            || !manifest.TryGetProperty("start_url", out var start) || start.ValueKind != JsonValueKind.String
            || !Uri.TryCreate(basis, start.GetString(), out var startUrl)
            || !Uri.TryCreate(startUrl, id.GetString(), out var identity)
            || startUrl.GetLeftPart(UriPartial.Authority) != origin || identity.GetLeftPart(UriPartial.Authority) != origin
            || identity.UserInfo.Length != 0 || identity.Fragment.Length != 0) return null;
        return identity;
    }

    internal static IEnumerable<PwaRegistration> Registrations() {
        using var registrations = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall");
        if (registrations is null) yield break;
        foreach (var name in registrations.GetSubKeyNames()) {
            using var registration = registrations.OpenSubKey(name);
            if (registration?.GetValue("UninstallString") is string command && registration.GetValue("DisplayIcon") is string icon)
                yield return new(command, icon.Trim('"'));
        }
    }

    internal static async Task<IReadOnlyList<PackagedPwa>> PackagedRegistrationsAsync(CancellationToken stop) {
        // Edge's Windows-integrated PWAs do not have an HKCU Uninstall registration.
        const string script = "@(Get-AppxPackage | ForEach-Object { $p = Get-AppxPackageManifest -Package $_; foreach ($e in $p.Package.Applications.Application.Extensions.Extension.AppExtension) { if ($e.Name -ne 'com.ms.webapp.internals.4') { continue }; $d = $e.Description; $a = [regex]::Match($d, '--app-id=([a-p]{32})'); $b = [regex]::Match($d, '--ip-edge-aumid=([^; ]+)'); $c = [regex]::Match($d, 'profile-directory[?]([^;]+)'); $u = [regex]::Match($d, 'start-url[?]([^;]+)'); if ($a.Success -and $b.Success -and $c.Success -and $u.Success) { [pscustomobject]@{AppId=$a.Groups[1].Value; Profile=$c.Groups[1].Value; StartUrl=$u.Groups[1].Value; EdgeIdentity=$b.Groups[1].Value} } } }) | ConvertTo-Json -Compress";
        var start = new ProcessStartInfo(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),
            "WindowsPowerShell", "v1.0", "powershell.exe")) {
            UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true
        };
        start.ArgumentList.Add("-NoProfile"); start.ArgumentList.Add("-NonInteractive");
        start.ArgumentList.Add("-EncodedCommand"); start.ArgumentList.Add(Convert.ToBase64String(Encoding.Unicode.GetBytes(script)));
        using var process = Process.Start(start) ?? throw new IOException("PWA registration discovery did not start");
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(stop);
        timeout.CancelAfter(TimeSpan.FromSeconds(8));
        var output = process.StandardOutput.ReadToEndAsync(timeout.Token);
        var errors = process.StandardError.ReadToEndAsync(timeout.Token);
        try {
            await process.WaitForExitAsync(timeout.Token);
            var json = await output; await errors;
            if (process.ExitCode != 0) throw new IOException("PWA registration discovery failed");
            if (string.IsNullOrWhiteSpace(json)) return [];
            using var document = JsonDocument.Parse(json);
            return document.RootElement.ValueKind == JsonValueKind.Array
                ? JsonSerializer.Deserialize<PackagedPwa[]>(json) ?? []
                : [JsonSerializer.Deserialize<PackagedPwa>(json)!];
        } catch (OperationCanceledException) {
            if (!process.HasExited) process.Kill();
            throw;
        }
    }

    internal static InstalledPwa? MatchPackaged(Uri identity, IEnumerable<PackagedPwa> registrations,
        string profileRoot, Func<string, bool> exists) {
        var expected = AppId(identity);
        foreach (var registration in registrations) {
            if (registration.AppId != expected || registration.EdgeIdentity != "Microsoft.MicrosoftEdge.Stable_8wekyb3d8bbwe!MSEDGE"
                || !Regex.IsMatch(registration.Profile, @"^(Default|Profile \d+)$")
                || !Uri.TryCreate(registration.StartUrl, UriKind.Absolute, out var start)
                || start.GetLeftPart(UriPartial.Authority) != identity.GetLeftPart(UriPartial.Authority)) continue;
            var appRoot = Path.Combine(profileRoot, registration.Profile, "Web Applications");
            if (exists(Path.Combine(appRoot, "_crx_" + expected))
                || exists(Path.Combine(appRoot, "Manifest Resources", expected)))
                return new(expected, profileRoot, registration.Profile);
        }
        return null;
    }

    internal static InstalledPwa? Match(Uri identity, string edge, IEnumerable<string> allowedRoots,
        IEnumerable<PwaRegistration> registrations, Func<string, bool> exists) {
        var expected = AppId(identity);
        foreach (var registration in registrations) {
            var command = Regex.Match(registration.Command, "^\"([^\"]+)\"\\s+(.*)$");
            if (!command.Success || !command.Groups[1].Value.Equals(edge, StringComparison.OrdinalIgnoreCase)) continue;
            var app = Regex.Match(command.Groups[2].Value, @"(?:^|\s)--uninstall-app-id=([a-p]{32})(?:\s|$)");
            var profile = Regex.Match(command.Groups[2].Value, "(?:^|\\s)--profile-directory=(?:\"([^\"]+)\"|([^\\s]+))(?:\\s|$)");
            if (!app.Success || app.Groups[1].Value != expected || !profile.Success || !exists(registration.Icon)) continue;
            var profileName = profile.Groups[1].Success ? profile.Groups[1].Value : profile.Groups[2].Value;
            if (!Regex.IsMatch(profileName, @"^(Default|Profile \d+)$")) continue;
            foreach (var root in allowedRoots) {
                var appRoot = Path.Combine(root, profileName, "Web Applications");
                var legacy = Path.Combine(appRoot, "_crx_" + expected) + Path.DirectorySeparatorChar;
                var current = Path.Combine(appRoot, "Manifest Resources", expected) + Path.DirectorySeparatorChar;
                var icon = Path.GetFullPath(registration.Icon);
                if (icon.StartsWith(Path.GetFullPath(legacy), StringComparison.OrdinalIgnoreCase)
                    || icon.StartsWith(Path.GetFullPath(current), StringComparison.OrdinalIgnoreCase))
                    return new(expected, Path.GetFullPath(root), profileName);
            }
        }
        return null;
    }

    internal static ProcessStartInfo Launch(string edge, string origin, string destination, InstalledPwa? installed,
        string installProfileRoot) {
        if (!TrayContext.TryGetWindowUrl(destination, origin, out var canonical)) throw new ArgumentException("Invalid PWA destination");
        var start = new ProcessStartInfo(edge) { UseShellExecute = false };
        start.ArgumentList.Add("--user-data-dir=" + (installed?.UserDataRoot ?? installProfileRoot));
        start.ArgumentList.Add("--profile-directory=" + (installed?.Profile ?? "Default"));
        if (installed is not null) {
            start.ArgumentList.Add("--app-id=" + installed.AppId);
            start.ArgumentList.Add("--app-launch-url-for-shortcuts-menu-item=" + canonical);
        } else start.ArgumentList.Add(origin + "/settings?subject=machine&section=startup");
        return start;
    }
}
