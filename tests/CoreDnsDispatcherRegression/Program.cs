using System.Diagnostics;
using System.Text.Json;
using EgoistShield.Service;
namespace CoreDnsDispatcherRegression;
internal static class Program
{
 private static string Work="";
 private static int Passed,Failed;
 private static readonly ClientIdentity Identity = new(Environment.ProcessId,Environment.ProcessPath!,true,"isolated-dns-dispatcher-test");
 private sealed class Fixture : IDisposable
 {
  internal readonly string Root;
  internal readonly List<string> Events=[];
  internal readonly OwnedServiceIntentStore Intents;
  internal readonly OperationDispatcher Dispatcher;
  internal Exception? NativeFailure, RepairFailure;
  internal string StopState="stopped";
  internal CancellationTokenSource? CancelInsideNative;
  internal Fixture()
  {
   Root=Path.Combine(Work,"dispatcher-"+Guid.NewGuid().ToString("N")); Directory.CreateDirectory(Root); Intents=new(Root);
   Task<ProcessResult> Forbidden(string script,CancellationToken token)=>throw new Exception("No SCM/DNS/registry calls allowed in this fixture");
   Dispatcher = new(new ServiceOptions("unused",Root,true,true,null),new WindowsDnsController(Forbidden),new WindowsNativeDohController(Root,Forbidden),null,new TransactionJournal(Root),new ServiceLog(Root),
    componentExecutor:async(payload,query,token)=>{token.ThrowIfCancellationRequested();Events.Add("worker:"+payload.GetProperty("method").GetString()); if(payload.GetProperty("method").GetString()=="restart") Require((await Intents.ReadAsync(token)).Services["EgoistShieldSystemDoH"].Running,"Restart intent was not committed before worker"); return JsonDefaults.ToElement(new{controlled=true});},
    systemDohStop:async token=>{ token.ThrowIfCancellationRequested(); Events.Add("native-stop"); if(CancelInsideNative!=null){CancelInsideNative.Cancel();token.ThrowIfCancellationRequested();} if(NativeFailure!=null)throw NativeFailure; await Task.Yield(); return new OwnedServiceStatus("EgoistShieldSystemDoH",StopState,"auto",true); },
    systemDohRepairRecovery:token=>{token.ThrowIfCancellationRequested();Events.Add("native-recovery-repair");return RepairFailure==null?Task.CompletedTask:Task.FromException(RepairFailure);});
  }
  internal Task<ServiceResponse> Run(string method,object[]? args=null,bool query=false,CancellationToken token=default)=>Dispatcher.DispatchAsync(new ServiceRequest(1,Guid.NewGuid().ToString("N"),query?"component.query":"component.execute",JsonDefaults.ToElement(new{component="SystemDoH",method,args=args??[]})),Identity,token);
  public void Dispose()=>Dispatcher.Dispose();
 }
 private static void Require(bool valid,string message){if(!valid)throw new Exception(message);}
 private static async Task Check(string name,Func<Task> run){try{await run();Passed++;Console.WriteLine("PASS: "+name);}catch(Exception error){Failed++;Console.WriteLine("FAIL: "+name+" -> "+error);}}
 private static async Task<int> Main(string[] args)
 {
  if(args is not ["--work",var selected] || !Path.IsPathFullyQualified(selected)) throw new ArgumentException("--work <absolute own task work>"); Work=selected;
  foreach(string method in new[]{"restart","stop","stopAndRemove"}) await Check("Core exact stop precedes installed worker for "+method,async()=>{using var f=new Fixture(); await f.Intents.SetRunningAsync("EgoistShieldSystemDoH",true,default); var reply=await f.Run(method); Require(reply.Ok,"Dispatcher operation failed: "+reply.Error?.Code);Require(f.Events.SequenceEqual(method=="restart"?new[]{"native-stop","native-recovery-repair","worker:"+method}:new[]{"native-stop","worker:"+method}),"Worker preceded native stop"); Require((await f.Intents.ReadAsync(default)).Services["EgoistShieldSystemDoH"].Running==(method=="restart"),"Manual desired intent lost");});
  await Check("recover explicit off persists off before native stop and worker",async()=>{using var f=new Fixture();await f.Intents.SetRunningAsync("EgoistShieldSystemDoH",true,default);Require((await f.Run("recover",[new{enabled=false}])).Ok,"Recovery off failed");Require(f.Events.SequenceEqual(new[]{"native-stop","worker:recover"}) && !(await f.Intents.ReadAsync(default)).Services["EgoistShieldSystemDoH"].Running,"Recover off was not durable");});
  foreach(var failure in new Exception[]{new UnauthorizedAccessException("foreign image"),new IOException("unknown SCM generation"),new TimeoutException("pending SCM never accepted stop")}) await Check("failed native stop refuses worker: "+failure.Message,async()=>{using var f=new Fixture{NativeFailure=failure};await f.Intents.SetRunningAsync("EgoistShieldSystemDoH",true,default);var result=await f.Run("stop");Require(!result.Ok&&f.Events.SequenceEqual(new[]{"native-stop"}),"Worker dispatched after native failure");Require(!(await f.Intents.ReadAsync(default)).Services["EgoistShieldSystemDoH"].Running,"Failed manual stop resurrected intent");});
  await Check("unconfirmed stopped result refuses worker",async()=>{using var f=new Fixture{StopState="stop_pending"};var result=await f.Run("restart");Require(!result.Ok&&result.Error?.Code=="SYSTEM_DOH_STOP_UNCONFIRMED"&&f.Events.SequenceEqual(new[]{"native-stop"}),"Unconfirmed stop entered worker");});
  await Check("cancellation during native stop refuses worker and preserves off intent",async()=>{using var f=new Fixture();using var c=new CancellationTokenSource();f.CancelInsideNative=c;await f.Intents.SetRunningAsync("EgoistShieldSystemDoH",true,default);try{await f.Run("stop",token:c.Token);}catch(OperationCanceledException){}Require(f.Events.SequenceEqual(new[]{"native-stop"}) && !(await f.Intents.ReadAsync(default)).Services["EgoistShieldSystemDoH"].Running,"Cancelled native stop allowed worker/re-enabled intent");});
  await Check("query and apply never acquire native stop authority",async()=>{using var f=new Fixture();Require((await f.Run("status",query:true)).Ok,"Status query failed");Require((await f.Run("apply",["https://private.example:8443/profile"])).Ok,"Controlled apply failed");Require(f.Events.SequenceEqual(new[]{"worker:status","worker:apply"}),"Query/apply stopped live resolver");});
  await Check("pending owned adapter restoration preserves resolver and running intent",async()=>{using var f=new Fixture();await f.Intents.SetRunningAsync("EgoistShieldSystemDoH",true,default);await AtomicJsonFile.WriteAsync(Path.Combine(f.Root,"dns-owned-state.json"),new DnsOwnedState(1,"EgoistShield",["127.0.0.1"],[]));var result=await f.Run("stopAndRemove");Require(!result.Ok&&result.Error?.Code=="DNS_RESTORE_REQUIRED"&&f.Events.Count==0 && (await f.Intents.ReadAsync(default)).Services["EgoistShieldSystemDoH"].Running,"Pending adapter lost resolver or intent");});
  await Check("malformed restart arguments acquire no pre-worker stop authority",async()=>{using var f=new Fixture();await f.Run("restart",[new{unexpected=true}]);Require(!f.Events.Contains("native-stop"),"Malformed restart arguments stopped service");});
  await Check("failed native recovery policy repair aborts worker restart and preserves desired-on intent",async()=>{using var f=new Fixture{RepairFailure=new IOException("SCM recovery readback rejected")};var result=await f.Run("restart");Require(!result.Ok&&f.Events.SequenceEqual(new[]{"native-stop","native-recovery-repair"}) && (await f.Intents.ReadAsync(default)).Services["EgoistShieldSystemDoH"].Running,"Policy repair failure dispatched worker or removed wanted restart");});
  await Check("existing integrated Core self-test remains compatible",async()=>{await SelfTest.RunAsync();});
  Console.WriteLine($"Core DNS dispatcher: passed={Passed}, failed={Failed}; realScmWrites=false; realDnsWrites=false");return Failed==0?0:1;
 }
}


