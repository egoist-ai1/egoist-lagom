using System.Reflection;
using EgoistShield.Service;
namespace CoreDnsFastRecoveryRegression;
internal static class Program
{
 static void Require(bool value,string reason){if(!value)throw new Exception(reason);}
 static async Task<int> Main(string[] args)
 {
  if(args.Length!=2 || args[0]!="--work")return 2;
  string root=Path.Combine(Path.GetFullPath(args[1]),"fast-policy-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(root);
  int passed=0,failed=0;
  async Task Check(string name,Func<Task> test){try{await test();Console.WriteLine("PASS: "+name);passed++;}catch(Exception error){Console.WriteLine("FAIL: "+name+" -> "+error);failed++;}}
  await Check("exact DNS gets 0/1/60, addons retain 5/10/60 and repair never changes startup",async()=>{
   foreach(string service in new[]{"EgoistShieldSystemDoH","EgoistShieldZapret","EgoistShieldTelegramProxy","EgoistShieldVpn"}){
    var calls=new List<string[]>();
    await OwnedServiceController.ConfigureRecoveryAsync(service,"fixture",(argv,token)=>{token.ThrowIfCancellationRequested();calls.Add(argv.ToArray());return Task.FromResult(new ProcessResult(0,"",""));},CancellationToken.None);
    Require(calls.Count==4,"bounded four repair operations");
    Require(calls[1].SequenceEqual(new[]{"failure",service,"reset=","3600","actions=",service=="EgoistShieldSystemDoH"?"restart/0/restart/1000/restart/60000":"restart/5000/restart/10000/restart/60000"}),"exact per-component recovery actions");
    Require(calls.All(c=>!c.Contains("start=")),"repair preserves manual/disabled startup");
    Require(calls[0].SequenceEqual(new[]{"config",service,"depend=","Tcpip/Afd"})&&calls[2].SequenceEqual(new[]{"failureflag",service,"1"}),"dependencies and non-crash failure flag retained");
   }
  });
  await Check("actual existing startup guard regression: disabled races, SCM failures and cancellation",async()=>{
   var method=typeof(SelfTest).GetMethod("VerifyRecoveryStartupPolicyAsync",BindingFlags.NonPublic|BindingFlags.Static)??throw new Exception("missing actual guard fixture");
   await ((Task)(method.Invoke(null,new object[]{root})??throw new Exception("missing task")));
  });
  Console.WriteLine($"RESULT: {passed} passed; {failed} failed");return failed==0?0:1;
 }
}
