using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;

namespace Pe.Revit.Space;

internal sealed class SceneLimitException(string reason) : Exception(reason) {
    internal string Reason { get; } = reason;
}

/// <summary>Conservative protection defaults between opaque native calls, not an OS allocation guarantee.</summary>
internal sealed class SceneBudget(int maxTriangles, CancellationToken cancellationToken = default) : IDisposable {
    private const long GiB = 1024L * 1024 * 1024;
    private static long BaselinePrivate;
    private readonly long _start = RegisterBaseline();
    private Stopwatch? _contextClock;
    internal long PeakPrivateBytes { get; private set; }
    internal int NativeCalls { get; private set; }
    internal int NativeTriangles { get; private set; }
    internal int PeakRetainedTriangles { get; private set; }

    internal void Native() {
        cancellationToken.ThrowIfCancellationRequested();
        if (this._contextClock is not null) this.Context();
        var current = this.Observe();
        Interlocked.CompareExchange(ref BaselinePrivate, this._start, 0);
        if (current - Interlocked.Read(ref BaselinePrivate) >= GiB) throw new SceneLimitException("memory-growth");
        this.Headroom();
        this.NativeCalls++;
    }
    internal void AfterNative() {
        cancellationToken.ThrowIfCancellationRequested();
        if (this._contextClock is not null) this.Context();
        var current = this.Observe();
        if (current - Interlocked.Read(ref BaselinePrivate) >= GiB) throw new SceneLimitException("memory-growth");
        this.Headroom();
    }
    internal void Headroom() {
        cancellationToken.ThrowIfCancellationRequested();
        var status = new MemoryStatus { Length = (uint)Marshal.SizeOf(typeof(MemoryStatus)) };
        if (GlobalMemoryStatusEx(ref status) && status.AvailablePhysical < 2UL * (ulong)GiB)
            throw new SceneLimitException("memory-headroom");
    }
    internal void Mesh(int triangles, int buffered) {
        this.NativeTriangles = checked(this.NativeTriangles + triangles);
        if (this.NativeTriangles > 2L * maxTriangles) throw new SceneLimitException("acquisition-budget");
        if ((long)triangles + buffered > maxTriangles) throw new SceneLimitException("element-acquisition-limit");
    }
    internal void Retained(int triangles) => this.PeakRetainedTriangles = Math.Max(this.PeakRetainedTriangles, triangles);
    internal void Context() {
        this._contextClock ??= Stopwatch.StartNew();
        cancellationToken.ThrowIfCancellationRequested();
        if (this._contextClock.Elapsed >= TimeSpan.FromSeconds(30)) throw new SceneLimitException("time-budget");
    }
    internal SceneMemory Diagnostics() {
        var end = this.Observe();
        return new SceneMemory(this._start, end, this.PeakPrivateBytes, Interlocked.Read(ref BaselinePrivate), GiB, 2 * GiB, GC.GetTotalMemory(false));
    }
    private static long RegisterBaseline() {
        var current = PrivateBytes();
        Interlocked.CompareExchange(ref BaselinePrivate, current, 0);
        return current;
    }
    private long Observe() {
        var current = PrivateBytes();
        this.PeakPrivateBytes = Math.Max(this.PeakPrivateBytes, current);
        return current;
    }
    private static long PrivateBytes() {
        // Process.PrivateMemorySize64 refresh enumerates the system process table on Windows.
        // This guard runs between geometry calls; query only our own counters.
        var counters = new ProcessMemoryCounters { Size = (uint)Marshal.SizeOf(typeof(ProcessMemoryCounters)) };
        if (!GetProcessMemoryInfo(new IntPtr(-1), ref counters, counters.Size))
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        return checked((long)counters.PrivateUsage.ToUInt64());
    }
    public void Dispose() { }
    [DllImport("psapi.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetProcessMemoryInfo(IntPtr process, ref ProcessMemoryCounters counters, uint size);
    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessMemoryCounters {
        public uint Size, PageFaultCount;
        public UIntPtr PeakWorkingSetSize, WorkingSetSize, QuotaPeakPagedPoolUsage, QuotaPagedPoolUsage,
            QuotaPeakNonPagedPoolUsage, QuotaNonPagedPoolUsage, PagefileUsage, PeakPagefileUsage, PrivateUsage;
    }
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GlobalMemoryStatusEx(ref MemoryStatus status);
    [StructLayout(LayoutKind.Sequential)]
    private struct MemoryStatus {
        public uint Length, Load;
        public ulong TotalPhysical, AvailablePhysical, TotalPageFile, AvailablePageFile, TotalVirtual, AvailableVirtual, AvailableExtendedVirtual;
    }
}
