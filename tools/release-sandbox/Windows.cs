using System;
using System.Collections.Generic;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
public static class PeConsoleObserver {
  public delegate bool Callback(IntPtr hwnd, IntPtr lparam);
  [DllImport("user32.dll")] static extern bool EnumWindows(Callback callback, IntPtr lparam);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd, StringBuilder name, int count);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
  [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hwnd, int attribute, out int value, int size);
  delegate void EventCallback(IntPtr hook, uint evt, IntPtr hwnd, int objectId, int childId, uint threadId, uint time);
  [DllImport("user32.dll")] static extern IntPtr SetWinEventHook(uint min, uint max, IntPtr module, EventCallback callback, uint process, uint thread, uint flags);
  [DllImport("user32.dll")] static extern bool UnhookWinEvent(IntPtr hook);
  [DllImport("user32.dll")] static extern int GetMessage(out Message msg, IntPtr hwnd, uint min, uint max);
  [DllImport("user32.dll")] static extern bool PostThreadMessage(uint id, uint msg, IntPtr wparam, IntPtr lparam);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int size);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("kernel32.dll")] static extern uint GetTickCount();
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr handle, uint flags, StringBuilder text, ref uint length);
  [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr handle, int kind, ref BasicInfo info, int size, out int returned);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CreateProcess(string app, StringBuilder command, IntPtr processAttributes, IntPtr threadAttributes, bool inherit, uint flags, IntPtr environment, string cwd, ref Startup startup, out ProcessInfo process);
  [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr handle, uint code);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
  [StructLayout(LayoutKind.Sequential)] struct Message { public IntPtr Hwnd; public uint Msg; public IntPtr Wparam, Lparam; public uint Time; public int X,Y; public uint Private; }
  [StructLayout(LayoutKind.Sequential)] struct BasicInfo { public IntPtr ExitStatus, Peb, Affinity, Priority, Pid, ParentPid; }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct Startup { public uint Size; public string Reserved,Desktop,Title; public uint X,Y,Width,Height,CharsX,CharsY,Fill,Flags; public ushort Show,ReservedSize; public IntPtr ReservedPointer,Input,Output,Error; }
  [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr Process,Thread; public uint Pid,ThreadId; }
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  public sealed class Window {
    public string Handle, Class, Title;
    public uint Pid;
    public bool Visible, Minimized, OnScreen, Displayed;
    public int Cloaked;
    public Rect Bounds;
    public bool ControlSentinel;
  }
  public sealed class ProcessEvidence { public uint Pid, ParentPid; public string Executable, StartUtc, Error; }
  public sealed class EventEvidence { public string AtUtc, Kind; public uint OsEventTimeMs, CallbackDelayMs; public Window Window; public ProcessEvidence[] Ancestry; }
  static readonly ConcurrentQueue<EventEvidence> events = new ConcurrentQueue<EventEvidence>();
  static EventCallback callback;
  static Thread pump;
  static uint pumpId;
  static IntPtr eventHook;
  static int dropped;
  static Exception startError;
  static Window ReadWindow(IntPtr hwnd) {
    var cls = new StringBuilder(256); GetClassName(hwnd, cls, cls.Capacity);
    var name = cls.ToString();
    if (name != "ConsoleWindowClass" && name != "CASCADIA_HOSTING_WINDOW_CLASS" && name != "PseudoConsoleWindow") return null;
    uint pid; GetWindowThreadProcessId(hwnd, out pid);
    Rect rect; GetWindowRect(hwnd, out rect);
    int cloaked; if (DwmGetWindowAttribute(hwnd, 14, out cloaked, 4) != 0) cloaked = -1;
    var visible = IsWindowVisible(hwnd); var minimized = IsIconic(hwnd);
    var left = GetSystemMetrics(76); var top = GetSystemMetrics(77);
    var onScreen = rect.Right > left && rect.Left < left + GetSystemMetrics(78) && rect.Bottom > top && rect.Top < top + GetSystemMetrics(79);
    var title = new StringBuilder(256); GetWindowText(hwnd,title,title.Capacity);
    return new Window { Handle=hwnd.ToInt64().ToString("X"), Class=name, Title=title.ToString(), Pid=pid, Visible=visible, Minimized=minimized, Cloaked=cloaked, Bounds=rect, OnScreen=onScreen, Displayed=visible && !minimized && cloaked == 0 && onScreen, ControlSentinel=IsControlTitle(title.ToString()) };
  }
  public static ProcessEvidence ProcessAt(uint pid) {
    var result = new ProcessEvidence { Pid=pid };
    try { using(var process=Process.GetProcessById((int)pid)) result.StartUtc=process.StartTime.ToUniversalTime().ToString("o"); } catch(Exception e) { result.Error=e.GetType().Name; }
    var handle=OpenProcess(0x1400,false,pid);
    if(handle==IntPtr.Zero) { result.Error="OpenProcess:"+Marshal.GetLastWin32Error(); return result; }
    try {
      var path=new StringBuilder(32768); uint length=(uint)path.Capacity;
      if(QueryFullProcessImageName(handle,0,path,ref length)) result.Executable=path.ToString();
      var info=new BasicInfo(); int returned;
      if(NtQueryInformationProcess(handle,0,ref info,Marshal.SizeOf(typeof(BasicInfo)),out returned)==0) result.ParentPid=(uint)info.ParentPid.ToInt64();
    } finally { CloseHandle(handle); }
    return result;
  }
  static ProcessEvidence[] Chain(uint pid) {
    var chain=new List<ProcessEvidence>(); var seen=new HashSet<uint>();
    while(pid!=0 && seen.Add(pid) && chain.Count<20) {
      var item=ProcessAt(pid);
      if(chain.Count>0 && item.StartUtc!=null && chain[chain.Count-1].StartUtc!=null && DateTime.Parse(item.StartUtc).ToUniversalTime()>DateTime.Parse(chain[chain.Count-1].StartUtc).ToUniversalTime()) break;
      chain.Add(item); pid=item.ParentPid;
    }
    return chain.ToArray();
  }
  public static void StartEvents() {
    if(pump!=null) throw new InvalidOperationException("Hook already started");
    var ready=new ManualResetEvent(false);
    pump=new Thread(()=> {
      pumpId=GetCurrentThreadId();
      callback=(hook,evt,hwnd,obj,child,thread,time)=> {
        if((evt!=0x8000 && evt!=0x8002) || obj!=0 || child!=0 || hwnd==IntPtr.Zero) return;
        var window=ReadWindow(hwnd); if(window==null) return;
        if(events.Count>=20000) { Interlocked.Increment(ref dropped); return; }
        events.Enqueue(new EventEvidence { AtUtc=DateTime.UtcNow.ToString("o"), Kind=evt==0x8002?"show":"create", OsEventTimeMs=time, CallbackDelayMs=unchecked(GetTickCount()-time), Window=window, Ancestry=Chain(window.Pid) });
      };
      eventHook=SetWinEventHook(0x8000,0x8002,IntPtr.Zero,callback,0,0,0);
      if(eventHook==IntPtr.Zero) startError=new InvalidOperationException("SetWinEventHook failed");
      ready.Set();
      if(eventHook!=IntPtr.Zero) { Message msg; while(GetMessage(out msg,IntPtr.Zero,0,0)>0) {} UnhookWinEvent(eventHook); }
    });
    pump.IsBackground=true; pump.SetApartmentState(ApartmentState.STA); pump.Start();
    if(!ready.WaitOne(5000)) throw new TimeoutException("Hook startup");
    if(startError!=null) throw startError;
  }
  public static EventEvidence[] DrainEvents() { var result=new List<EventEvidence>(); EventEvidence item; while(events.TryDequeue(out item)) result.Add(item); return result.ToArray(); }
  public static int DroppedEvents() { return dropped; }
  public static void StopEvents() { if(pump!=null) { PostThreadMessage(pumpId,0x12,IntPtr.Zero,IntPtr.Zero); if(!pump.Join(5000)) throw new TimeoutException("Hook retirement"); pump=null; } }
  static string controlTitle;
  static bool IsControlTitle(string title) {
    var active=Volatile.Read(ref controlTitle);
    return active!=null && title!=null && title.Trim()==active;
  }
  static bool MatchesControl(EventEvidence item, string handle, DateTime started) {
    return item.Window.Handle==handle && item.Window.Displayed && IsControlTitle(item.Window.Title) && DateTime.Parse(item.AtUtc).ToUniversalTime()>=started;
  }
  static void WaitForControl(Func<bool> displayed, int timeoutMilliseconds) {
    var elapsed=Stopwatch.StartNew();
    while(elapsed.ElapsedMilliseconds<timeoutMilliseconds) {
      if(displayed()) return;
      Thread.Sleep(20);
    }
    throw new TimeoutException("Control console was not displayed before the calibration deadline");
  }
  public static uint PulseControl() {
    var startup=new Startup(); startup.Size=(uint)Marshal.SizeOf(typeof(Startup));
    var process=new ProcessInfo();
    var cmd=Environment.GetEnvironmentVariable("ComSpec");
    var caption="PE_CONSOLE_OBSERVER_CONTROL_"+Guid.NewGuid().ToString("N");
    if(Interlocked.CompareExchange(ref controlTitle,caption,null)!=null) throw new InvalidOperationException("Control pulse already active");
    var started=DateTime.UtcNow;
    try {
      if(!CreateProcess(cmd,new StringBuilder("\""+cmd+"\" /c \"title "+caption+" & pause >nul\""),IntPtr.Zero,IntPtr.Zero,false,0x10,IntPtr.Zero,null,ref startup,out process)) throw new InvalidOperationException("Control CreateProcess:"+Marshal.GetLastWin32Error());
      WaitForControl(()=> {
        foreach(var window in Read()) {
          if(!window.Displayed || !window.ControlSentinel) continue;
          foreach(var item in events)
            if(MatchesControl(item,window.Handle,started)) return true;
        }
        return false;
      },5000);
      return process.Pid;
    }
    finally {
      try {
        if(process.Process!=IntPtr.Zero) {
          if(WaitForSingleObject(process.Process,0)!=0 && !TerminateProcess(process.Process,0)) throw new InvalidOperationException("Control termination failed");
          if(WaitForSingleObject(process.Process,5000)!=0) throw new TimeoutException("Control retirement");
        }
      }
      finally { CloseHandle(process.Thread); CloseHandle(process.Process); Interlocked.Exchange(ref controlTitle,null); }
    }
  }
  public static Window[] Read() {
    var found = new List<Window>();
    EnumWindows((hwnd, unused) => {
      var window=ReadWindow(hwnd); if(window!=null) found.Add(window);
      return true;
    }, IntPtr.Zero);
    return found.ToArray();
  }
}
