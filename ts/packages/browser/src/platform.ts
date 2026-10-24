import { spawn, type ChildProcess } from "node:child_process";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { BrowserError } from "./errors.ts";
import { CLOSE_BUDGET_MS } from "./receipts.ts";
import { productRoot } from "@pe/host-contracts/service-identity";

export const browserHome = (home?: string) =>
  resolve(home ?? join(productRoot(), "state", "browser"));
export const defaultChromeProfile = () =>
  process.platform === "win32"
    ? join(
        process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"),
        "Google",
        "Chrome",
        "User Data",
      )
    : process.platform === "darwin"
      ? join(homedir(), "Library", "Application Support", "Google", "Chrome")
      : join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "google-chrome");
export async function chromeExecutable(explicit?: string): Promise<string> {
  const candidates = explicit
    ? [explicit]
    : process.platform === "win32"
      ? [
          join(
            process.env.PROGRAMFILES ?? "C:/Program Files",
            "Google/Chrome/Application/chrome.exe",
          ),
          join(
            process.env["PROGRAMFILES(X86)"] ?? "C:/Program Files (x86)",
            "Microsoft/Edge/Application/msedge.exe",
          ),
        ]
      : process.platform === "darwin"
        ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
        : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return resolve(candidate);
    } catch {}
  }
  throw new BrowserError(
    "ExecutableNotFound",
    "Chrome executable not found; supply executablePath",
    { outcome: "not-sent" },
  );
}

export async function activeEndpoint(profile: string): Promise<string> {
  // ChromeDevTools/chrome-devtools-mcp BrowserManager.ts: explicit userDataDir discovery.
  // Only this endpoint file is read, never profile credentials or preferences.
  const [port, path] = (await readFile(join(profile, "DevToolsActivePort"), "utf8"))
    .trim()
    .split(/\r?\n/);
  if (
    !/^\d+$/.test(port ?? "") ||
    Number(port) < 1 ||
    Number(port) > 65535 ||
    !path?.startsWith("/devtools/browser/")
  )
    throw new Error("Invalid DevToolsActivePort");
  return `ws://127.0.0.1:${port}${path}`;
}

export async function assertProfileAvailable(profile: string): Promise<void> {
  let commands: string[] = [];
  if (process.platform === "win32") {
    const source = `[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false);ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='msedge.exe'" | Select-Object -ExpandProperty CommandLine)`;
    commands = await new Promise<string[]>((done, reject) => {
      const census = spawn(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", source],
        { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] },
      );
      let output = "";
      census.stdout?.on("data", (data) => {
        output += String(data);
      });
      const timer = setTimeout(() => {
        census.kill();
        reject(new Error("Profile process census timed out; launch refused"));
      }, 10000);
      census.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      census.once("exit", (code) => {
        clearTimeout(timer);
        if (code !== 0) reject(new Error("Profile process census failed; launch refused"));
        else {
          try {
            done(JSON.parse(output));
          } catch (error) {
            reject(error);
          }
        }
      });
    });
  } else if (process.platform === "linux") {
    for (const pid of await readdir("/proc"))
      if (/^\d+$/.test(pid)) {
        try {
          commands.push((await readFile(`/proc/${pid}/cmdline`, "utf8")).replaceAll("\0", " "));
        } catch {}
      }
  } else {
    try {
      await access(join(profile, "SingletonLock"));
      throw new BrowserError("ProfileBusy", "Chrome profile has an existing singleton lock", {
        outcome: "not-sent",
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  const normalized = resolve(profile).replaceAll("\\", "/").toLowerCase();
  if (
    commands.some(
      (command) => command && command.replaceAll("\\", "/").toLowerCase().includes(normalized),
    )
  )
    throw new BrowserError("ProfileBusy", "Chrome already uses the requested profile; use attach", {
      outcome: "not-sent",
    });
}

const windowsGuardian = String.raw`
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
}
`;

const quoteWindows = (arg: string) =>
  `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1")}"`;
export interface Guardian {
  process: ChildProcess;
  pid: number;
  stop(timeoutMs?: number): Promise<void>;
}
export async function launchGuarded(config: {
  id: string;
  directory: string;
  executable: string;
  args: string[];
  profile: string;
  temporary: boolean;
  lock: string;
}): Promise<Guardian> {
  await mkdir(config.directory, { recursive: true });
  let child: ChildProcess;
  if (process.platform === "win32") {
    const sourceFile = join(config.directory, "guardian.cs");
    const executable = join(config.directory, "guardian.exe");
    const compiler = join(config.directory, "compile-guardian.ps1");
    const native = windowsGuardian;
    const main = String.raw`
 [DllImport("kernel32")] static extern IntPtr GetStdHandle(int n);
 [DllImport("kernel32")] static extern bool ReadFile(IntPtr h,byte[] b,uint n,out uint read,IntPtr ov);
 public static void Main(string[] a) {
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
`;
    await writeFile(sourceFile, native.slice(0, native.lastIndexOf("}")) + main + "}");
    await writeFile(
      executable + ".config",
      '<?xml version="1.0"?><configuration><runtime><AppContextSwitchOverrides value="Switch.System.IO.UseLegacyPathHandling=false;Switch.System.IO.BlockLongPaths=false" /></runtime></configuration>',
    );
    await writeFile(
      compiler,
      "param([string]$Source,[string]$Output)\n$ErrorActionPreference='Stop'\nAdd-Type -TypeDefinition (Get-Content -LiteralPath $Source -Raw) -OutputAssembly $Output -OutputType ConsoleApplication\n",
    );
    await new Promise<void>((done, reject) => {
      const compile = spawn(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          compiler,
          "-Source",
          sourceFile,
          "-Output",
          executable,
        ],
        { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] },
      );
      let errors = "";
      compile.stderr?.on("data", (chunk) => {
        errors += String(chunk);
      });
      compile.once("error", reject);
      compile.once("exit", (code) =>
        code === 0 ? done() : reject(new Error(`Native guardian compilation failed: ${errors}`)),
      );
    });
    // libuv's Windows child job must not kill the guardian with its keeper.
    child = spawn(
      executable,
      [
        config.executable,
        [config.executable, ...config.args].map(quoteWindows).join(" "),
        config.id,
        config.profile,
        String(config.temporary),
        config.lock,
        join(config.directory, "guardian-cleanup.txt"),
        String(CLOSE_BUDGET_MS),
      ],
      { detached: true, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
    );
  } else {
    const script = join(config.directory, "guardian.mjs");
    await writeFile(
      script,
      `import {spawn} from 'node:child_process';import fs from 'node:fs';const c=JSON.parse(process.argv[2]);const p=spawn(c.executable,c.args,{detached:true,stdio:'ignore'});console.log(p.pid);let stopped=false;function stop(){if(stopped)return;stopped=true;try{process.kill(-p.pid,'SIGKILL')}catch{};if(c.temporary&&fs.readFileSync(c.profile+'/.pe-browser-owner','utf8')===c.id)fs.rmSync(c.profile,{recursive:true,force:true});try{if(fs.readFileSync(c.lock,'utf8')===c.id)fs.unlinkSync(c.lock)}catch{};process.exit()}process.stdin.resume();process.stdin.on('end',stop);process.on('SIGTERM',stop);`,
    );
    child = spawn(process.execPath, [script, JSON.stringify(config)], {
      detached: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
  }
  let stderr = "";
  child.stderr?.on("data", (data) => {
    stderr = (stderr + String(data)).slice(-8000);
  });
  const pid = await new Promise<number>((accept, reject) => {
    let text = "";
    const timer = setTimeout(() => {
      child.stdin?.end();
      reject(new Error(`Guardian startup timed out: ${stderr}`));
    }, 15000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Guardian exited ${code}: ${stderr}`));
    });
    child.stdout?.on("data", (data) => {
      text += String(data);
      const match = text.match(/(?:^|\n)(\d+)\r?\n/);
      if (match) {
        clearTimeout(timer);
        accept(Number(match[1]));
      }
    });
  });
  return {
    process: child,
    pid,
    stop: async (timeoutMs = CLOSE_BUDGET_MS) => {
      child.stdin?.end(`C${Math.max(1, Math.ceil(timeoutMs))}\n`);
      if (child.exitCode === null)
        await new Promise<void>((accept, reject) => {
          const timer = setTimeout(
            () =>
              reject(
                new BrowserError(
                  "CleanupTimeout",
                  `Native guardian did not finish within its ${timeoutMs}ms shutdown budget`,
                  { outcome: "unknown" },
                ),
              ),
            timeoutMs + 1000,
          );
          child.once("exit", () => {
            clearTimeout(timer);
            accept();
          });
        });
      if (process.platform === "win32") {
        let result: string;
        try {
          result = await readFile(join(config.directory, "guardian-cleanup.txt"), "utf8");
        } catch (cause) {
          throw new BrowserError(
            "CleanupFailed",
            `Native guardian exited without a cleanup certificate: ${stderr}`,
            { outcome: "unknown", cause },
          );
        }
        if (result !== "clean")
          throw new BrowserError("CleanupFailed", result, { outcome: "unknown" });
      }
    },
  };
}
