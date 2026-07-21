// PeServiceDiscovery.cs — the SDK-owned platform-neutral C# discovery client (SDK-LEDGER A10).
//
// OWNED BY Pe.Revit.Sdk — DO NOT FORK. Copy this file verbatim into a consumer that CANNOT
// reference Pe.Revit.Loader (platform-neutral Shared projects under the D8 build guard); the SDK
// ships it inside the Pe.Revit.Sdk nupkg under clients/csharp/ so there is exactly ONE
// implementation per language. Dependency-free — BCL only, net48-safe, no BCL-JSON.
//
// READ-ONLY projection of the service primitive: discovery (which port does the live owner of
// service <name> hold?) and worktree-scoped naming. Writing, claiming, eviction, and spawn stay
// with Pe.Revit.Loader (C#) / pe-service.ts (TS) — this file must never grow a write path.
//
// Liveness is pid-existence only — cheap enough for per-call URL resolution; a reused pid can alias
// briefly, and the caller's next HTTP request is the real probe. A dead owner's leftover file reads
// as null — never as an address.
//
// SourceServiceName is a cross-language byte contract (clients/contract-vectors.json
// `sourceServiceName` cases): normalization is full-path → forward slashes → no trailing slash →
// lowercase(invariant), then sha256 over UTF-8, first 12 hex chars.

#nullable enable

using System;
using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace Pe.Revit.ServiceClient;

/// <summary>The live owner's coordinates projected from a service file: the actually bound port.</summary>
public sealed class DiscoveredService {
    public DiscoveredService(int pid, int port, string lane, string version) {
        Pid = pid;
        Port = port;
        Lane = lane;
        Version = version;
    }

    public int Pid { get; }
    public int Port { get; }
    public string Lane { get; }
    public string Version { get; }
}

public static class PeServiceDiscovery {
    private const int SchemaVersion = 2;

    /// <summary>Canonical checkout-root form for identity hashing: absolute, forward slashes, no
    /// trailing slash, lowercase. Byte-identical to the TS client's <c>normalizeSourceRoot</c>.</summary>
    public static string NormalizeSourceRoot(string sourceRoot) =>
        Path.GetFullPath(sourceRoot)
            .Replace('\\', '/')
            .TrimEnd('/')
            .ToLowerInvariant();

    /// <summary>Worktree-scoped service name for a source-run service:
    /// <c>&lt;baseName&gt;-source-&lt;12 hex of sha256(normalized root)&gt;</c>.</summary>
    public static string SourceServiceName(string baseName, string sourceRoot) {
        using var sha256 = SHA256.Create();
        var hash = sha256.ComputeHash(Encoding.UTF8.GetBytes(NormalizeSourceRoot(sourceRoot)));
        var suffix = new StringBuilder(12);
        for (var i = 0; i < 6; i++)
            suffix.Append(hash[i].ToString("x2"));
        return $"{baseName}-source-{suffix}";
    }

    /// <summary>The service file path: <c>&lt;appBase&gt;/state/service/&lt;name&gt;.json</c>.</summary>
    public static string ServiceFilePath(string appBase, string name) =>
        Path.Combine(appBase, "state", "service", name + ".json");

    /// <summary>Discover the live owner of service <paramref name="name"/> under
    /// <paramref name="appBase"/>: the file's pid/port IFF the schema matches and the recorded pid
    /// still exists. Absent, unreadable, schema-mismatched, or dead-owner files all read as null —
    /// never throws, never an address without a live owner.</summary>
    public static DiscoveredService? TryDiscover(string appBase, string name) {
        string text;
        try {
            var path = ServiceFilePath(appBase, name);
            if (!File.Exists(path))
                return null;
            text = File.ReadAllText(path);
        } catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) {
            return null;
        }

        // Regex-field parse (net48 has no BCL JSON) — the same minimal projection the loader uses.
        var schema = IntField(text, "schemaVersion");
        var pid = IntField(text, "pid");
        var port = IntField(text, "port");
        if (schema != SchemaVersion || pid is null || port is null || port.Value <= 0)
            return null;
        if (!PidIsAlive(pid.Value))
            return null;
        return new DiscoveredService(
            pid.Value,
            port.Value,
            StringField(text, "lane") ?? "",
            StringField(text, "version") ?? ""
        );
    }

    private static bool PidIsAlive(int pid) {
        try {
            using var process = Process.GetProcessById(pid);
            return true;
        } catch (ArgumentException) {
            return false;
        } catch (InvalidOperationException) {
            return false;
        }
    }

    private static int? IntField(string json, string name) {
        var match = Regex.Match(json, $"\"{Regex.Escape(name)}\"\\s*:\\s*(-?\\d+)");
        return match.Success && int.TryParse(match.Groups[1].Value, out var value) ? value : null;
    }

    private static string? StringField(string json, string name) {
        var match = Regex.Match(json, $"\"{Regex.Escape(name)}\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"");
        return match.Success ? Regex.Unescape(match.Groups[1].Value) : null;
    }
}
