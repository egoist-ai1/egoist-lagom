using EgoistShield.Service;
using System.Diagnostics;

internal static class Program
{
 private static int Passed, Failed;
 private const string Name = "EgoistShieldSystemDoH";
 private sealed class Fixture
 {
  internal string State = "running";
  internal int GraceCalls, Cleanups, WrapperKills, Guards;
  internal bool Graceful = true, GenerationChanged, RuntimeReleases = true, Denied, Installed = true;
  internal Func<Task>? CleanupHook;
  internal Task<OwnedServiceStatus> Status(CancellationToken token) { token.ThrowIfCancellationRequested(); return Task.FromResult(new OwnedServiceStatus(Name, State, "auto", Installed)); }
  internal Task Guard(CancellationToken token) { token.ThrowIfCancellationRequested(); Guards++; if (GenerationChanged) throw new IOException("Generation changed"); return Task.CompletedTask; }
  internal async Task Grace(CancellationToken token)
  {
   GraceCalls++;
   await OwnedServiceTransition.ChangeAsync(Name, false, Status, (_, _) => { State = Graceful ? "stopped" : "stop_pending"; return Task.FromResult(new ProcessResult(0, "", "")); }, TimeSpan.FromMilliseconds(30), token, TimeSpan.FromMilliseconds(1));
  }
  internal async Task Cleanup(CancellationToken token) { token.ThrowIfCancellationRequested(); if (Denied) throw new UnauthorizedAccessException("Controlled unavailable identity"); Cleanups++; if (CleanupHook != null) await CleanupHook(); if (RuntimeReleases && State == "stop_pending") State = "stopped"; }
  internal Task Kill(CancellationToken token) { token.ThrowIfCancellationRequested(); WrapperKills++; State = "stopped"; return Task.CompletedTask; }
 }
 private static async Task Stop(Fixture f, CancellationToken token = default)
 { await OwnedSystemDohStop.StopAsync(f.Status, f.Grace, f.Guard, f.Cleanup, f.Kill, token, TimeSpan.FromMilliseconds(4), TimeSpan.FromMilliseconds(4)); }
 private static void Assert(bool result, string message) { if (!result) throw new InvalidOperationException(message); }
 private static async Task Check(string name, Func<Task> run) { try { await run(); Passed++; Console.WriteLine("PASS: " + name); } catch(Exception e) { Failed++; Console.WriteLine("FAIL: " + name + ": " + e.GetType().Name + " " + e.Message); } }
 private static async Task Refuses<T>(Func<Task> run) where T:Exception { try { await run(); } catch(T) { return; } throw new Exception("Expected " + typeof(T).Name); }
 private static string NewRoot() { var work=Environment.GetEnvironmentVariable("TEMP") ?? throw new ArgumentException("Caller-owned TEMP required"); if(!Path.IsPathFullyQualified(work)) throw new ArgumentException("Absolute caller-owned TEMP required"); string root=Path.Combine(work,"dns-stop-generation-"+Guid.NewGuid().ToString("N")); Directory.CreateDirectory(root); return root; }
 private static async Task<int> Main()
 {
  await Check("healthy graceful stop never kills wrapper", async () => { var f = new Fixture(); await Stop(f); Assert(f.GraceCalls == 1 && f.WrapperKills == 0, "Premature wrapper termination"); });
  await Check("persistent stop pending releases exact owned runtime", async () => { var f = new Fixture { Graceful=false }; await Stop(f); Assert(f.Cleanups > 0 && f.State == "stopped" && f.WrapperKills == 0, "Runtime fallback missing"); });
  await Check("stopped service cleans orphan runtime before publishing success", async () => { var f = new Fixture { State="stopped" }; await Stop(f); Assert(f.Cleanups == 1 && f.WrapperKills == 0, "Orphan runtime remains"); });
  await Check("wrapper fallback only follows runtime cleanup", async () => { var f = new Fixture { Graceful=false, RuntimeReleases=false }; await Stop(f); Assert(f.Cleanups >= 2 && f.WrapperKills == 1 && f.Guards >= 3, "Owned wrapper fallback missing"); });
  await Check("changed configuration refuses fallback before killing", async () => { var f = new Fixture { Graceful=false, GenerationChanged=true }; await Refuses<IOException>(() => Stop(f)); Assert(f.Cleanups == 0 && f.WrapperKills == 0, "Changed generation changed a process"); });
  await Check("unreadable identity is surfaced and wrapper remains", async () => { var f = new Fixture { State="stopped", Denied=true }; await Refuses<UnauthorizedAccessException>(() => Stop(f)); Assert(f.WrapperKills == 0, "Access denial ignored"); });
  await Check("cancellation before stop never cleans runtime", async () => { var f = new Fixture { Graceful=false }; using var c = new CancellationTokenSource(); c.Cancel(); await Refuses<OperationCanceledException>(() => Stop(f,c.Token)); Assert(f.Cleanups == 0 && f.WrapperKills == 0, "Cancelled stop kills process"); });
  await Check("configuration change during runtime cleanup prevents wrapper kill", async () => { var f = new Fixture { Graceful=false, RuntimeReleases=false }; f.CleanupHook = () => { f.GenerationChanged=true; return Task.CompletedTask; }; await Refuses<IOException>(() => Stop(f)); Assert(f.WrapperKills == 0, "Late generation change kills wrapper"); });
  await Check("start pending has no termination permission before stop control is accepted", async () => { var f = new Fixture { State="start_pending", Graceful=false }; await Refuses<IOException>(() => Stop(f)); Assert(f.Cleanups == 0 && f.WrapperKills == 0, "Start-pending process terminated"); });
  await Check("missing registration still cleans a protected orphan without wrapper termination", async () => { var f = new Fixture { State="not-installed", Installed=false }; await Stop(f); Assert(f.Cleanups == 1 && f.WrapperKills == 0, "Unregistered owned orphan not cleaned"); });
  await Check("held real configuration blocks concurrent replacement and releases handles after stop", async () => {
   string root=NewRoot(); File.WriteAllText(Path.Combine(root,"state.json"),"{}"); File.WriteAllText(Path.Combine(root,"config.json"),"{}");
   using(var generation=new OwnedSystemDohStop.Generation(root,root)) { await generation.AssertAsync(default); await Refuses<IOException>(()=>{File.WriteAllText(Path.Combine(root,"state.json"),"changed");return Task.CompletedTask;}); await generation.AssertAsync(default); }
   File.WriteAllText(Path.Combine(root,"state.json"),"changed"); Assert(File.ReadAllText(Path.Combine(root,"state.json"))=="changed","Held generation leaked its handle");
  });
  await Check("a missing state created during stop invalidates the generation", async () => {
   string root=NewRoot(); File.WriteAllText(Path.Combine(root,"config.json"),"{}"); using var generation=new OwnedSystemDohStop.Generation(root,root); File.WriteAllText(Path.Combine(root,"state.json"),"{}"); await Refuses<IOException>(()=>generation.AssertAsync(default));
  });
  await Check("oversized protected config refuses stopping and releases failed-capture handles", async () => {
   string root=NewRoot(); string config=Path.Combine(root,"config.json"); File.WriteAllText(Path.Combine(root,"state.json"),"{}"); File.WriteAllBytes(config,new byte[65537]); await Refuses<InvalidDataException>(()=>{using var generation=new OwnedSystemDohStop.Generation(root,root);return Task.CompletedTask;}); File.WriteAllText(config,"{}"); File.WriteAllText(Path.Combine(root,"state.json"),"{}");
  });
  Console.WriteLine($"Core DNS stop: passed={Passed}, failed={Failed}"); return Failed == 0 ? 0 : 1;
 }
}


