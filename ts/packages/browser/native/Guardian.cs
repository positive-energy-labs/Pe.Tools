
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
public static class PeBrowserJob {
 [StructLayout(LayoutKind.Sequential)] struct STARTUPINFO { public int cb; public IntPtr reserved, desktop, title; public int x,y,xs,ys,xc,yc,fill,flags; public short show,reserved2; public IntPtr reserved3,stdin,stdout,stderr; }
 [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION { public IntPtr process, thread; public uint pid,tid; }
 [StructLayout(LayoutKind.Sequential)] struct BASIC { public long perProcess,perJob; public uint flags; public UIntPtr min,max; public uint active; public UIntPtr affinity; public uint priority,scheduling; }
 [StructLayout(LayoutKind.Sequential)] struct IO { public ulong a,b,c,d,e,f; }
 [StructLayout(LayoutKind.Sequential)] struct EXTENDED { public BASIC basic; public IO io; public UIntPtr processMemory,jobMemory,peakProcess,peakJob; }
 [DllImport("kernel32", SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr a,string n);
 [DllImport("kernel32", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr j,int c,ref EXTENDED i,uint n);
 [DllImport("kernel32", SetLastError=true,CharSet=CharSet.Unicode)] static extern bool CreateProcess(string app,StringBuilder cmd,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr env,string cwd,ref STARTUPINFO si,out PROCESS_INFORMATION pi);
 [DllImport("kernel32", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr j,IntPtr p);
 [DllImport("kernel32")] static extern uint ResumeThread(IntPtr t);
 [DllImport("kernel32")] static extern bool TerminateProcess(IntPtr p,uint e);
 [DllImport("kernel32")] public static extern bool CloseHandle(IntPtr h);
 [DllImport("kernel32")] static extern uint WaitForSingleObject(IntPtr h,uint ms);
 [DllImport("kernel32",SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr j,int c,IntPtr data,uint size,out uint length);
 [DllImport("kernel32",SetLastError=true)] static extern IntPtr OpenProcess(uint access,bool inherit,uint pid);
 [DllImport("kernel32",SetLastError=true)] static extern bool TerminateJobObject(IntPtr j,uint code);
 static System.Collections.Generic.List<IntPtr> observed = new System.Collections.Generic.List<IntPtr>();
 static System.Collections.Generic.List<uint> observedIds = new System.Collections.Generic.List<uint>();
 public static string Timeline;
 static void CaptureJob() {
  IntPtr data=Marshal.AllocHGlobal(8+IntPtr.Size*1024); uint length;
  try { if(!QueryInformationJobObject(job,3,data,(uint)(8+IntPtr.Size*1024),out length)) throw new Win32Exception();
   int count=Marshal.ReadInt32(data,4); for(int i=0;i<count;i++) { uint pid=(uint)Marshal.ReadIntPtr(data,8+i*IntPtr.Size).ToInt64(); if(observedIds.Contains(pid)) continue; IntPtr h=OpenProcess(0x100000,false,pid); if(h!=IntPtr.Zero) { observed.Add(h); observedIds.Add(pid); } }
  } finally { Marshal.FreeHGlobal(data); }
 }
 public static void Observe(string phase) {
  var active=new System.Collections.Generic.List<uint>(); for(int i=0;i<observed.Count;i++) if(WaitForSingleObject(observed[i],0)==258) active.Add(observedIds[i]);
  System.IO.File.AppendAllText(Timeline,"{\"phase\":\""+phase+"\",\"when\":\""+DateTime.UtcNow.ToString("o")+"\",\"jobActive\":"+(job==IntPtr.Zero ? 0 : ActiveProcesses())+",\"outstanding\":["+string.Join(",",active)+"],\"jobMembers\":["+string.Join(",",observedIds)+"]}\n");
 }
 static IntPtr job, browser;
 public static uint Start(string exe,string command) {
  job=CreateJobObject(IntPtr.Zero,null); if(job==IntPtr.Zero) throw new Win32Exception();
  var limits=new EXTENDED(); limits.basic.flags=0x2000;
  if(!SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(limits))) throw new Win32Exception();
  var si=new STARTUPINFO(); si.cb=Marshal.SizeOf(si); PROCESS_INFORMATION pi;
  if(!CreateProcess(exe,new StringBuilder(command),IntPtr.Zero,IntPtr.Zero,false,4,IntPtr.Zero,null,ref si,out pi)) throw new Win32Exception();
  if(!AssignProcessToJobObject(job,pi.process)) { TerminateProcess(pi.process,1); CloseHandle(pi.process); CloseHandle(pi.thread); throw new Win32Exception(); }
  ResumeThread(pi.thread); CloseHandle(pi.thread); browser=pi.process; return pi.pid;
 }
 static DateTime stopDeadline;
 static bool ObservedActive() { foreach(IntPtr h in observed) if(WaitForSingleObject(h,0)==258) return true; return false; }
 static int Remaining() { return Math.Max(0,(int)(stopDeadline-DateTime.UtcNow).TotalMilliseconds); }
 static uint ActiveProcesses() {
  IntPtr data=Marshal.AllocHGlobal(48); uint length;
  try { if(!QueryInformationJobObject(job,1,data,48,out length)) throw new Win32Exception(); return (uint)Marshal.ReadInt32(data,40); } finally { Marshal.FreeHGlobal(data); }
 }
 public static bool Stop(bool graceful,int budget) {
  stopDeadline=DateTime.UtcNow.AddMilliseconds(budget);
  if(job!=IntPtr.Zero) CaptureJob(); Observe("stop.begin");
  uint root=browser==IntPtr.Zero ? 0 : WaitForSingleObject(browser,graceful ? (uint)Math.Min(budget/2,Remaining()) : 0); Observe("root.wait."+root);
  if(job!=IntPtr.Zero) {
   CaptureJob();
   if(!TerminateJobObject(job,0)) throw new Win32Exception();
   Observe("job.terminate.requested");
   while(ObservedActive()) { if(Remaining()==0) throw new TimeoutException("Owned process handles did not reach completed exit"); System.Threading.Thread.Sleep(10); }
   Observe("process.handles.signalled");
   foreach(IntPtr h in observed) CloseHandle(h); observed.Clear();
   if(browser!=IntPtr.Zero) { CloseHandle(browser); browser=IntPtr.Zero; }
   // Job accounting retains exited process references; release our signalled handles first.
   while(ActiveProcesses()!=0) { if(Remaining()==0) throw new TimeoutException("Owned job accounting did not reach zero after joined handles were released"); System.Threading.Thread.Sleep(10); }
   Observe("job.empty"); CloseHandle(job); job=IntPtr.Zero;
  }
  if(browser!=IntPtr.Zero) { CloseHandle(browser); browser=IntPtr.Zero; }
  Observe("job.handle.closed"); return !graceful || root==0;
 }
 public static void ProfileAvailable(string profile) {
  try {
   string normalized=System.IO.Path.GetFullPath(profile).Replace('\\','/').ToLowerInvariant();
   using(var searcher=new System.Management.ManagementObjectSearcher("SELECT CommandLine FROM Win32_Process WHERE Name='chrome.exe' OR Name='msedge.exe'"))
   using(var processes=searcher.Get()) foreach(System.Management.ManagementObject process in processes) using(process) {
    string command=process["CommandLine"] as string;
    if(command!=null && command.Replace('\\','/').ToLowerInvariant().Contains(normalized)) { Environment.ExitCode=2; return; }
   }
  } catch(Exception e) { Console.Error.WriteLine(e); Environment.ExitCode=1; }
 }

 [DllImport("kernel32")] static extern IntPtr GetStdHandle(int n);
 [DllImport("kernel32")] static extern bool ReadFile(IntPtr h,byte[] b,uint n,out uint read,IntPtr ov);
 public static void Main(string[] a) {
  if(a.Length==2 && a[0]=="--profile-available") { ProfileAvailable(a[1]); return; }
  Timeline=System.IO.Path.Combine(System.IO.Path.GetDirectoryName(a[6]),"guardian-timeline.jsonl");
  bool graceful=false; int budget=int.Parse(a[7]);
  try { uint pid=Start(a[0],a[1]); Console.WriteLine(pid); Console.Out.Flush(); uint read; byte[] next=new byte[1]; var command=new StringBuilder(); while(ReadFile(GetStdHandle(-10),next,1,out read,IntPtr.Zero) && read>0 && next[0]!=10 && command.Length<32) command.Append((char)next[0]); if(command.Length>1 && command[0]=='C') { graceful=true; int parsed; if(int.TryParse(command.ToString().Substring(1),out parsed)) budget=Math.Max(1,Math.Min(budget,parsed)); } }
  finally {
   bool gracefulExit=Stop(graceful,budget);
   bool owned=a[4]=="true" && System.IO.Directory.Exists(a[3]) && System.IO.File.Exists(System.IO.Path.Combine(a[3],".pe-browser-owner")) && System.IO.File.ReadAllText(System.IO.Path.Combine(a[3],".pe-browser-owner"))==a[2];
   string profile=a[3].StartsWith(@"\\?\") ? a[3] : @"\\?\"+a[3];
   bool cleaned=false;
   for(int i=0;i<100 && Remaining()>0;i++) { try {
    if(owned && System.IO.Directory.Exists(profile)) System.IO.Directory.Delete(profile,true);
    if(System.IO.File.Exists(a[5]) && System.IO.File.ReadAllText(a[5])==a[2]) System.IO.File.Delete(a[5]);
    Observe("profile.lock.released");
    System.IO.File.WriteAllText(a[6],gracefulExit ? "clean" : "Owned browser required forced termination; graceful profile flush is unproven"); cleaned=true; break;
   } catch(Exception e) { System.IO.File.WriteAllText(a[6],e.ToString()); System.Threading.Thread.Sleep(100); } }
   if(!cleaned) System.IO.File.WriteAllText(a[6],"Owned profile cleanup did not finish within its shutdown budget");
  }
  Observe("guardian.exit");
 }
}
