using System.Runtime.InteropServices;
using System.Threading;

namespace Pe.Revit.Space;

internal sealed class SceneLimitException(string reason) : Exception(reason) {
    internal string Reason { get; } = reason;
}

/// <summary>Stops further acquisition after a native mesh reveals its triangle count; not a native allocation cap.</summary>
internal sealed class SceneBudget(int maxTriangles, CancellationToken cancellationToken = default) {
    private readonly long _start = PrivateBytes();
    internal long PeakPrivateBytes { get; private set; }
    internal int NativeCalls { get; private set; }
    internal int GeometryCalls { get; private set; }
    internal int NativeTriangles { get; private set; }
    internal int PeakRetainedTriangles { get; private set; }

    internal void Check() => cancellationToken.ThrowIfCancellationRequested();
    internal void Native() { this.Check(); this.Observe(); this.NativeCalls++; }
    internal void Geometry() { this.GeometryCalls++; this.Native(); }
    internal void AfterNative() { this.Check(); this.Observe(); }
    internal void Mesh(int triangles, int buffered) {
        // Triangulate has already allocated the face when Revit first exposes this count.
        this.NativeTriangles = checked(this.NativeTriangles + triangles);
        if (this.NativeTriangles > 2L * maxTriangles) throw new SceneLimitException("acquisition-budget");
        if ((long)triangles + buffered > maxTriangles) throw new SceneLimitException("element-acquisition-limit");
    }
    internal void Retained(int triangles) => this.PeakRetainedTriangles = Math.Max(this.PeakRetainedTriangles, triangles);
    internal SceneMemory Diagnostics() {
        var end = this.Observe();
        return new SceneMemory(this._start, end, this.PeakPrivateBytes, GC.GetTotalMemory(false));
    }
    private long Observe() {
        var current = PrivateBytes();
        this.PeakPrivateBytes = Math.Max(this._start, Math.Max(this.PeakPrivateBytes, current));
        return current;
    }
    private static long PrivateBytes() {
        var counters = new ProcessMemoryCounters { Size = (uint)Marshal.SizeOf(typeof(ProcessMemoryCounters)) };
        if (!GetProcessMemoryInfo(new IntPtr(-1), ref counters, counters.Size))
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        return checked((long)counters.PrivateUsage.ToUInt64());
    }
    [DllImport("psapi.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetProcessMemoryInfo(IntPtr process, ref ProcessMemoryCounters counters, uint size);
    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessMemoryCounters {
        public uint Size, PageFaultCount;
        public UIntPtr PeakWorkingSetSize, WorkingSetSize, QuotaPeakPagedPoolUsage, QuotaPagedPoolUsage,
            QuotaPeakNonPagedPoolUsage, QuotaNonPagedPoolUsage, PagefileUsage, PeakPagefileUsage, PrivateUsage;
    }
}
