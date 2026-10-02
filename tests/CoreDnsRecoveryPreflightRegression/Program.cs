using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Security.AccessControl;
using System.Security.Principal;
using EgoistShield.Service;
namespace CoreDnsRecoveryPreflightRegression;
internal static class Program
{
 const string Name="EgoistShieldSystemDoH";
 static string Work="",Xray=""; static int Passed,Failed;
 static readonly ClientIdentity Identity=new(Environment.ProcessId,Environment.ProcessPath!,true,"isolated-preflight-test");
 static void Require(bool value,string why){if(!value)throw new Exception(why);}
 static async Task Check(string name,Func<Task> run){try{await run();Passed++;Console.WriteLine("PASS: "+name);}catch(Exception e){Failed++;Console.WriteLine("FAIL: "+name+" -> "+e);}}
 sealed class Fixture:IDisposable
 {
  internal readonly string Root=Path.Combine(Work,"policy-"+Guid.NewGuid().ToString("N"));
  internal readonly OwnedServiceIntentStore Store;internal readonly OperationDispatcher Dispatcher;internal readonly OwnedServiceSupervisor Supervisor;
  internal int Recoveries,Preflights;internal double Second=60;internal bool CacheWorks=true,Ready,Online=true,NativeRunning=true;internal string StartType="auto";
  internal Func<CancellationToken,Task<bool>>? Candidate;internal Func<CancellationToken,Task>? Recovery;internal readonly List<string> Events=[];
  internal Fixture(bool mutationScope=false){Directory.CreateDirectory(Root);Store=new(Root);
   Task<ProcessResult> Forbidden(string script,CancellationToken token)=>throw new Exception("Real SCM/DNS writes forbidden");
   Dispatcher=new(new ServiceOptions("unused",Root,true,true,null),new WindowsDnsController(Forbidden),new WindowsNativeDohController(Root,Forbidden),null,new TransactionJournal(Root),new ServiceLog(Root),
    componentExecutor:(p,q,t)=>{t.ThrowIfCancellationRequested();Require(NativeRunning,"Foreground reached worker with DNS stranded in stopped state");Events.Add("worker:"+p.GetProperty("method").GetString());return Task.FromResult(JsonDefaults.ToElement(new{controlled=true}));},
    systemDohStop:t=>{t.ThrowIfCancellationRequested();Events.Add("manual-native-stop");return Task.FromResult(new OwnedServiceStatus(Name,"stopped","auto",true));});
   Supervisor=new(Store,(n,_)=>Task.FromResult(n==Name?new OwnedServiceStatus(n,"running",StartType,true):new(n,"not-installed",null,false)),(_,t)=>{t.ThrowIfCancellationRequested();return Task.CompletedTask;},(_,t)=>{t.ThrowIfCancellationRequested();return Task.FromResult(LocalServiceHealth.Unresponsive);},async(_,_,t)=>{t.ThrowIfCancellationRequested();Recoveries++;CacheWorks=false;if(Recovery!=null)await Recovery(t);},_=>Task.CompletedTask,()=>Online,()=>TimeSpan.FromSeconds(Second),()=>DateTimeOffset.Parse("2026-10-02T00:00:00Z").AddSeconds(Second),dnsRecoveryPreflight:async t=>{Preflights++;return Candidate==null?Ready:await Candidate(t);},recoveryMutationScope:mutationScope?t=>Background.PausePreemption(t):null);}
  internal Task Start()=>Store.SetRunningAsync(Name,true,default);
  internal async Task Tick(double second,CancellationToken token=default){Second=second;await Supervisor.CheckAsync(token);}
  internal Task<ServiceResponse> Request(string operation,object payload,ClientIdentity? identity=null,CancellationToken token=default)=>Dispatcher.DispatchAsync(new(1,Guid.NewGuid().ToString("N"),operation,JsonDefaults.ToElement(payload)),identity??Identity,token);
  internal int Budget=>Store.ReadAsync(default).GetAwaiter().GetResult().Services[Name].DnsRecoveryAttempts;
  internal BackgroundSupervisionCancellation Background=>(BackgroundSupervisionCancellation)typeof(OperationDispatcher).GetField("_backgroundSupervision",BindingFlags.NonPublic|BindingFlags.Instance)!.GetValue(Dispatcher)!;
  internal SemaphoreSlim Gate=>(SemaphoreSlim)typeof(OperationDispatcher).GetField("_mutationLock",BindingFlags.NonPublic|BindingFlags.Instance)!.GetValue(Dispatcher)!;
  public void Dispose()=>Dispatcher.Dispose();
 }
 static async Task<int> Main(string[] args)
 {
  if(args.Length<2||args[0]!="--work"||!Path.IsPathFullyQualified(args[1]))throw new ArgumentException("--work <own work> [--xray <own fixture copy>] [--policy-only]");Work=args[1];Directory.CreateDirectory(Work);int xi=Array.IndexOf(args,"--xray");if(xi>=0)Xray=args[xi+1];
  await Check("failed Chrome candidate retains cached names and consumes zero durable attempts",async()=>{using var f=new Fixture();await f.Start();await f.Tick(60);await f.Tick(70);Require(f.Preflights==1&&f.Recoveries==0&&f.CacheWorks&&f.Budget==0,"Unready candidate destroyed cache/budget");await f.Tick(120);Require(f.Preflights==1,"Failed candidate cooldown ignored");await f.Tick(130);Require(f.Preflights==2&&f.CacheWorks&&f.Budget==0,"Retry destroyed cache/budget");});
  await Check("healthy Chrome candidate authorizes exactly one restart and durable attempt",async()=>{using var f=new Fixture{Ready=true};await f.Start();await f.Tick(60);await f.Tick(70);Require(f.Preflights==1&&f.Recoveries==1&&f.Budget==1,"Ready candidate not authorized once");});
  await Check("manual off cancels blocked candidate and releases real dispatcher mutation gate without automatic budget use",ManualCancellationAsync);
  await Check("next background generation is fresh and healthy candidate can recover",async()=>{var scope=new BackgroundSupervisionCancellation();var first=scope.TryBegin(default)!;using(scope.EnterForeground()){Require(first.IsCancellationRequested&&scope.TryBegin(default)==null,"Foreground failed exclusion");scope.End(first);}var next=scope.TryBegin(default)!;Require(!next.IsCancellationRequested,"Cancelled CTS poisoned next cycle");scope.End(next);using var f=new Fixture{Ready=true};await f.Start();await f.Tick(60);await f.Tick(70);Require(f.Recoveries==1,"Healthy next cycle failed");});
  await Check("pending foreground closes gate-acquire/background-start race",async()=>{var scope=new BackgroundSupervisionCancellation();using(scope.EnterForeground())Require(scope.TryBegin(default)==null,"Background passed queued foreground");var next=scope.TryBegin(default)!;scope.End(next);await Task.CompletedTask;});
  await Check("foreground cannot strand a committed native stop/start; later probes are cancelled",async()=>{var scope=new BackgroundSupervisionCancellation();var background=scope.TryBegin(default)!;var committed=scope.PausePreemption(background.Token);using(scope.EnterForeground()){Require(!background.IsCancellationRequested,"Committed native stop/start interrupted");committed.Dispose();Require(background.IsCancellationRequested,"Queued foreground did not cancel later probes");}scope.End(background);await Task.CompletedTask;});
  await Check("actual dispatcher foreground waits for committed supervisor stop/start and sees wanted DNS running",CommittedMutationAsync);
  await Check("queries, denied identity probes and invalid payloads never preempt",ValidationAsync);
  await Check("actual dispatcher status, denied identity and invalid arguments leave background token alive",async()=>{
   using var f=new Fixture();var background=f.Background.TryBegin(default)!;await f.Gate.WaitAsync();
   try{Require((await f.Request("component.query",new{component="SystemDoH",method="status",args=Array.Empty<object>()})).Ok,"Status did not complete independently");
    var denied=await f.Request("component.execute",new{component="SystemDoH",method="stop",args=Array.Empty<object>()},Identity with{IdentityProbe=true});Require(!denied.Ok&&denied.Error?.Code=="IDENTITY_PROBE_SCOPE","Identity scope was not denied");
    using var stop=new CancellationTokenSource(150);try{await f.Request("component.execute",new{component="SystemDoH",method="restart",args=new object[]{new{bad=true}}},token:stop.Token);}catch(OperationCanceledException)when(stop.IsCancellationRequested){}
    Require(!background.IsCancellationRequested&&f.Events.SequenceEqual(new[]{"worker:status"}),"Status/denied/invalid request cancelled background or mutated");}
   finally{f.Background.End(background);f.Gate.Release();}});
  await Check("manual-off, disabled and offline changes during candidate win without budget use",async()=>{for(int variant=0;variant<3;variant++){using var f=new Fixture();await f.Start();int v=variant;f.Candidate=async t=>{if(v==0)await f.Store.SetRunningAsync(Name,false,t);if(v==1)f.StartType="disabled";if(v==2)f.Online=false;return true;};await f.Tick(60);await f.Tick(70);Require(f.Recoveries==0&&f.Budget==0&&f.CacheWorks,"Final guard lost");}});
  if(!args.Contains("--policy-only")){
   await Check("candidate preserves exact private URI/pin/TLS/cache; changes only listener port/log",ConfigurationAsync);
   await Check("foreign native owner rows cannot authorize candidate",async()=>{var rows=new[]{new SystemDohRecoveryPreflight.EndpointRow("127.0.0.1",52000,10,true),new SystemDohRecoveryPreflight.EndpointRow("127.0.0.1",52000,11,false)};Require(!SystemDohRecoveryPreflight.OwnsEndpoints(rows,52000,10,false),"Foreign owner accepted");await Task.CompletedTask;});
   await Check("private ACL requires trusted owner and exact SYSTEM/Admin rules without users",async()=>{var acl=new FileSecurity();var admin=new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid,null);var system=new SecurityIdentifier(WellKnownSidType.LocalSystemSid,null);acl.SetOwner(admin);acl.AddAccessRule(new FileSystemAccessRule(admin,FileSystemRights.FullControl,AccessControlType.Allow));acl.AddAccessRule(new FileSystemAccessRule(system,FileSystemRights.FullControl,AccessControlType.Allow));SystemDohRecoveryPreflight.AssertPrivateAcl(acl);acl.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(WellKnownSidType.BuiltinUsersSid,null),FileSystemRights.Read,AccessControlType.Allow));bool refused=false;try{SystemDohRecoveryPreflight.AssertPrivateAcl(acl);}catch(UnauthorizedAccessException){refused=true;}Require(refused,"User-readable private file accepted");await Task.CompletedTask;});
   await Check("actual Xray stdin/high TCP UDP port/fresh forwarded question/held cleanup",()=>RealXrayAsync(false,false));
   await Check("actual Xray unready upstream timeout leaves no child/endpoints",()=>RealXrayAsync(true,false));
   await Check("actual Xray cancellation held cleanup stays within allowance",()=>RealXrayAsync(true,true));
   await Check("foreign UDP listener survives refused candidate",ForeignPortAsync);
  }
  Console.WriteLine($"Core DNS preflight: passed={Passed}, failed={Failed}; productionScmWrites=false; productionDnsWrites=false; providerFallback=false");return Failed==0?0:1;
 }
 static async Task ManualCancellationAsync(){using var f=new Fixture(true);await f.Start();await f.Tick(60);var entered=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);f.Candidate=async t=>{entered.SetResult();await Task.Delay(Timeout.InfiniteTimeSpan,t);return false;};var background=f.Background.TryBegin(default)!;await f.Gate.WaitAsync();var check=Task.Run(async()=>{try{await f.Tick(70,background.Token);}catch(OperationCanceledException)when(background.IsCancellationRequested){}finally{f.Background.End(background);f.Gate.Release();}});await entered.Task.WaitAsync(TimeSpan.FromSeconds(2));var clock=Stopwatch.StartNew();var response=await f.Request("component.execute",new{component="SystemDoH",method="stop",args=Array.Empty<object>()}).WaitAsync(TimeSpan.FromSeconds(2));await check;Require(response.Ok&&clock.Elapsed<TimeSpan.FromSeconds(1.5),"Manual off blocked by candidate");Require(f.Budget==0&&f.Recoveries==0&&!f.Store.ReadAsync(default).Result.Services[Name].Running&&f.Events.SequenceEqual(new[]{"manual-native-stop","worker:stop"}),"Manual off order/intent/budget changed");}
 static async Task CommittedMutationAsync()
 {
  using var f=new Fixture(true){Ready=true};await f.Start();await f.Tick(60);
  var stopped=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);var start=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
  f.Recovery=async token=>{f.NativeRunning=false;stopped.SetResult();await start.Task.WaitAsync(token);f.NativeRunning=true;};
  var background=f.Background.TryBegin(default)!;await f.Gate.WaitAsync();
  var check=Task.Run(async()=>{try{await f.Tick(70,background.Token);}catch(OperationCanceledException)when(background.IsCancellationRequested){}finally{f.Background.End(background);f.Gate.Release();}});
  await stopped.Task.WaitAsync(TimeSpan.FromSeconds(2));
  var foreground=f.Request("component.execute",new{component="TelegramProxy",method="stop",args=Array.Empty<object>()});
  await Task.Delay(100);Require(!background.IsCancellationRequested&&!foreground.IsCompleted&&!f.NativeRunning,"Foreground interrupted committed DNS stop/start");
  start.SetResult();await check;var response=await foreground.WaitAsync(TimeSpan.FromSeconds(2));
  Require(response.Ok&&f.NativeRunning&&f.Recoveries==1&&f.Budget==1&&f.Store.ReadAsync(default).Result.Services[Name].Running,"Foreground stranded wanted DNS or altered durable recovery budget");
 }
 static Task ValidationAsync(){var options=new ServiceOptions("unused",Work,true,true,null);bool Valid(string method,object[] args)=>ForegroundMutationPreemption.IsValid(new(1,"fixture","component.execute",JsonDefaults.ToElement(new{component="SystemDoH",method,args})),Identity,options);
  foreach(string url in new[]{"http://invalid.example","https://user:secret@fixture.example/path","https://fixture.example/path#fragment","https://fixture.example:99999/path"})Require(!Valid("apply",[url]),"Invalid URL can cancel");
  Require(!Valid("apply",["https://fixture.example/path","127.1.2.3"])&&!Valid("restart",[new{bad=true}])&&!Valid("unknown",[])&&!Valid("recover",[new{enabled=true,url="https://fixture.example/path",localAddress="garbage"}]),"Invalid args can cancel");
  var valid=new ServiceRequest(1,"fixed-stop","component.execute",JsonDefaults.ToElement(new{component="SystemDoH",method="stop",args=Array.Empty<object>()}));Require(ForegroundMutationPreemption.IsValid(valid,Identity,options)&&!ForegroundMutationPreemption.IsValid(valid with{Operation="component.query"},Identity,options)&&!ForegroundMutationPreemption.IsValid(valid with{ProtocolVersion=2},Identity,options)&&!ForegroundMutationPreemption.IsValid(valid,Identity with{IdentityProbe=true},options),"Denied/query/protocol can cancel");return Task.CompletedTask;}
 static Task ConfigurationAsync(){var state=JsonDefaults.ToElement(new{url="https://fixture.example:8443/private/profile?tenant=fixture",localAddress="127.0.0.1",localPort=53});var source=JsonDefaults.ToElement(new{log=new{loglevel="warning"},dns=new{tag="doh-upstream",hosts=new Dictionary<string,object>{["health.egoist.invalid"]="127.0.0.1",["fixture.example"]="203.0.113.44"},servers=new[]{new{address="https://fixture.example:8443/private/profile?tenant=fixture"}},serveStale=true,serveExpiredTTL=120},inbounds=new[]{new{tag="dns-in",listen="127.0.0.1",port=53,protocol="dokodemo-door",settings=new{network="tcp,udp",address="1.1.1.1",port=53}}},outbounds=new[]{new{protocol="freedom",streamSettings=new{security="tls",tlsSettings=new{fingerprint="chrome",allowInsecure=false,serverName="fixture.example"}}}}});Require(SystemDohRecoveryPreflight.TryBuildConfiguration(state,source,52347,out var text,out var ipv6)&&!ipv6,"Exact config refused");var parsed=JsonNode.Parse(text!)!;parsed["log"]=JsonNode.Parse(source.GetProperty("log").GetRawText());parsed["inbounds"]![0]!["port"]=53;Require(JsonNode.DeepEquals(parsed,JsonNode.Parse(source.GetRawText())),"Candidate changed provider/pin/TLS/cache");Require(!SystemDohRecoveryPreflight.TryBuildConfiguration(state,source,53,out _,out _),"Production port candidate accepted");return Task.CompletedTask;}
 static int Port(){using var tcp=new TcpListener(IPAddress.Loopback,0);tcp.Start();int port=((IPEndPoint)tcp.LocalEndpoint).Port;Require(port>=49152,"Expected high ephemeral port");return port;}
 static string Candidate(int port,int upstream)=>JsonSerializer.Serialize(new{log=new{loglevel="none"},dns=new{tag="upstream",servers=new[]{new{address="127.0.0.1",port=upstream}},disableCache=true,queryStrategy="UseIPv4"},inbounds=new[]{new{tag="dns-in",listen="127.0.0.1",port,protocol="dokodemo-door",settings=new{address="1.1.1.1",port=53,network="tcp,udp"}}},outbounds=new[]{new{tag="dns-out",protocol="dns"},new{tag="direct",protocol="freedom"}},routing=new{rules=new[]{new{type="field",inboundTag=new[]{"upstream"},outboundTag="direct"},new{type="field",inboundTag=new[]{"dns-in"},outboundTag="dns-out"}}}});
 static async Task RealXrayAsync(bool fail,bool cancel)
 {
  Require(File.Exists(Xray)&&Path.GetFullPath(Xray).StartsWith(Path.GetFullPath(Work),StringComparison.OrdinalIgnoreCase),"Use own isolated Xray copy");
  using var upstream=new UdpClient(new IPEndPoint(IPAddress.Loopback,0));using var stop=new CancellationTokenSource();int received=0;
  var seen=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
  var reader=Task.Run(async()=>{try{while(true){var m=await upstream.ReceiveAsync(stop.Token);received++;seen.TrySetResult();if(!fail){var answer=m.Buffer.ToArray();answer[2]=0x81;answer[3]=0x83;Array.Clear(answer,6,6);await upstream.SendAsync(answer,m.RemoteEndPoint,stop.Token);}}}catch(OperationCanceledException){}});
  int port=Port();using var deadline=new CancellationTokenSource(4500);var cleanup=Stopwatch.StartNew();
  Task? cancelling=cancel?Task.Run(async()=>{await seen.Task.WaitAsync(TimeSpan.FromSeconds(3));cleanup.Restart();deadline.Cancel();}):null;
  bool ready=false;
  try{ready=await SystemDohRecoveryPreflight.ProbeCandidateAsync(Xray,Candidate(port,((IPEndPoint)upstream.Client.LocalEndPoint!).Port),port,false,deadline.Token);}
  catch(OperationCanceledException)when(cancel&&deadline.IsCancellationRequested){}
  finally{stop.Cancel();await reader;if(cancelling!=null)await cancelling;}
  Require(ready==!fail&&received>0,"Actual Xray readiness disagreed: ready="+ready+", received="+received);
  Require(SystemDohRecoveryPreflight.ReadRows(port,default).Length==0&&Process.GetProcessesByName(Path.GetFileNameWithoutExtension(Xray)).Length==0,"Candidate retained child/endpoints");
  if(cancel)Require(cleanup.Elapsed<TimeSpan.FromSeconds(1.5),"Cancellation cleanup exceeded allowance");
 }

 static async Task ForeignPortAsync(){int port=Port();using var foreign=new UdpClient(new IPEndPoint(IPAddress.Loopback,port));using var deadline=new CancellationTokenSource(3500);bool ready=await SystemDohRecoveryPreflight.ProbeCandidateAsync(Xray,Candidate(port,port),port,false,deadline.Token);Require(!ready&&SystemDohRecoveryPreflight.ReadRows(port,default).Any(row=>!row.Tcp&&row.ProcessId==Environment.ProcessId),"Foreign listener accepted/terminated");}
}
