using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.ServiceProcess;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using EgoistShield.Service;

namespace NativeServiceRecoveryRegression;
internal static class Program
{
    private static readonly List<object> Checks = new();
    private static void Check(string name, bool condition)
    { if (!condition) throw new InvalidOperationException(name); Checks.Add(new { name, passed = true }); }
    private static void Refuses(string name, Action action, string? stage = null)
    {
        try { action(); throw new InvalidOperationException(name + " was accepted"); }
        catch (ServiceRecoveryReadException error) { Check(name, stage == null || error.Stage == stage); }
    }
    public static async Task<int> Main(string[] args)
    {
        string? work = args.Length == 2 && args[0] == "--work" ? args[1] : null;
        string? owner = Environment.GetEnvironmentVariable("LAGOM_TEST_TEMP") ?? Environment.GetEnvironmentVariable("RUNNER_TEMP");
        if (!OperatingSystem.IsWindows() || work == null || owner == null || !Path.IsPathFullyQualified(work) || !Path.IsPathFullyQualified(owner))
            throw new InvalidOperationException("Actual Windows and caller-owned absolute work are required.");
        string ownerPath = Path.GetFullPath(owner).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        if (!Path.GetFullPath(work).StartsWith(ownerPath, StringComparison.OrdinalIgnoreCase) || !Directory.Exists(work))
            throw new InvalidOperationException("Work must be an existing child of caller-owned temp.");
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(8));
        var timer = Stopwatch.StartNew();
        var actual = WindowsServiceRecoverySnapshot.Read("EventLog", deadline.Token);
        Check("real EventLog SCM basic+failure-actions+delayed+flag snapshot", actual.Installed && actual.Actions.Length <= 128);
        using (var service = new ServiceController("EventLog"))
            Check("real ServiceController start type agrees", (uint)service.StartType == actual.StartType);
        Check("real repeated query stable", WindowsServiceRecoverySnapshot.Equivalent(actual, WindowsServiceRecoverySnapshot.Read("EventLog", deadline.Token)));
        var missing = WindowsServiceRecoverySnapshot.Read("LagomRecoveryTestAbsent_" + Guid.NewGuid().ToString("N"), deadline.Token);
        Check("real absent service remains absence not persistence", !missing.Installed);
        using (var cancelled = new CancellationTokenSource())
        {
            cancelled.Cancel();
            try { WindowsServiceRecoverySnapshot.Read("EventLog", cancelled.Token); throw new InvalidOperationException("Cancelled read accepted"); }
            catch (OperationCanceledException) { Check("cancellation before SCM access refuses", true); }
        }
        var fixture = new WindowsServiceRecoverySnapshot.Observation(WindowsServiceRecoverySnapshot.TelegramServiceName, true, 16, 2,
            @"C:\Foreign\egoistshield-telegram-proxy-service.exe", "LocalSystem", false, 3600,
            new[] {new WindowsServiceRecoverySnapshot.Action(1,5000),new WindowsServiceRecoverySnapshot.Action(1,10000),new WindowsServiceRecoverySnapshot.Action(1,60000)}, true);
        Check("policy difference cannot equal matching reads", !WindowsServiceRecoverySnapshot.Equivalent(fixture, fixture with {ResetPeriodSeconds=0}));
        Check("image difference cannot equal matching reads", !WindowsServiceRecoverySnapshot.Equivalent(fixture, fixture with {BinaryCommand=@"C:\Other\file.exe"}));
        Refuses("foreign matching-name service image refused", () => WindowsServiceRecoverySnapshot.VerifyTelegramIdentity(fixture, deadline.Token), "service-identity-image");
        Refuses("foreign account refused", () => WindowsServiceRecoverySnapshot.VerifyTelegramIdentity(fixture with {Account="ForeignUser"}, deadline.Token), "service-identity");
        Refuses("other service name refused", () => WindowsServiceRecoverySnapshot.VerifyTelegramIdentity(fixture with {ServiceName="Foreign"}, deadline.Token), "service-identity");
        IntPtr memory = Marshal.AllocHGlobal(256);
        try
        {
            int size = Marshal.SizeOf<WindowsServiceRecoverySnapshot.FailureConfig>();
            var config = new WindowsServiceRecoverySnapshot.FailureConfig {ResetPeriod=3600,Count=3,Actions=IntPtr.Add(memory,size)};
            Marshal.StructureToPtr(config,memory,false);
            for(int index=0;index<3;index++){Marshal.WriteInt32(config.Actions,index*8,1);Marshal.WriteInt32(config.Actions,index*8+4,new[]{5000,10000,60000}[index]);}
            var decoded = WindowsServiceRecoverySnapshot.DecodeFailure(memory,256);
            Check("controlled buffer decodes complete real layout", decoded.Reset == 3600 && decoded.Actions.Length == 3 && decoded.Actions[2].DelayMs == 60000);
            Refuses("truncated failure buffer refused",()=>WindowsServiceRecoverySnapshot.DecodeFailure(memory,size-1),"failure-actions-size");
            config.Count=129;Marshal.StructureToPtr(config,memory,false);
            Refuses("oversized action count refused",()=>WindowsServiceRecoverySnapshot.DecodeFailure(memory,256),"failure-actions-count");
            config.Count=3;config.Actions=IntPtr.Add(memory,252);Marshal.StructureToPtr(config,memory,false);
            Refuses("out-of-buffer action pointer refused",()=>WindowsServiceRecoverySnapshot.DecodeFailure(memory,256),"failure-actions-range");
            config.Actions=IntPtr.Zero;Marshal.StructureToPtr(config,memory,false);
            Refuses("null action pointer refused",()=>WindowsServiceRecoverySnapshot.DecodeFailure(memory,256),"failure-actions-range");
            config.Actions=IntPtr.Add(memory,size);Marshal.StructureToPtr(config,memory,false);Marshal.WriteInt32(config.Actions,4);
            Refuses("unknown action enum refused",()=>WindowsServiceRecoverySnapshot.DecodeFailure(memory,256),"failure-actions-type");
            Marshal.WriteInt32(memory,2);Refuses("malformed BOOL refused",()=>WindowsServiceRecoverySnapshot.DecodeBoolean(memory,4),"flag-value");
            Refuses("truncated BOOL refused",()=>WindowsServiceRecoverySnapshot.DecodeBoolean(memory,3),"flag-size");
        }
        finally { Marshal.FreeHGlobal(memory); }
        var cliTimer = Stopwatch.StartNew();
        var real = await Capture(new[]{"--telegram-service-recovery"});
        cliTimer.Stop();
        using var document = JsonDocument.Parse(real.Output);
        var payload = document.RootElement;
        Check("actual fixed Telegram CLI schema and name", payload.GetProperty("schemaVersion").GetInt32()==1 && payload.GetProperty("serviceName").GetString()==WindowsServiceRecoverySnapshot.TelegramServiceName);
        Check("actual CLI exit is bound to complete or unavailable observation", real.Exit==0 ? payload.GetProperty("snapshotAvailable").GetBoolean() && payload.GetProperty("stable").GetBoolean() : !payload.GetProperty("snapshotAvailable").GetBoolean() && !payload.GetProperty("stable").GetBoolean());
        File.WriteAllText(Path.Combine(work,"actual-telegram-recovery.json"),real.Output);
        foreach(var invalid in new[]{new[]{"--telegram-service-recovery","--service-name","EventLog"},new[]{"--telegram-service-recovery","--console"},new[]{"--telegram-service-recovery","--install-root",work}})
        {
            var rejected=await Capture(invalid);Check("mixed or arbitrary CLI refused: "+string.Join(' ',invalid),rejected.Exit==1&&string.IsNullOrWhiteSpace(rejected.Output));
        }
        Console.WriteLine(JsonSerializer.Serialize(new { kind="actual-readonly-native-service-recovery", actualNativeApis=true,
            checks=Checks,elapsedMs=timer.Elapsed.TotalMilliseconds,telegramReadMs=cliTimer.Elapsed.TotalMilliseconds,
            telegramInstalled=payload.GetProperty("installed").ValueKind==JsonValueKind.True,
            telegramSnapshotAvailable=payload.GetProperty("snapshotAvailable").GetBoolean(),scmWrites=false,registryWrites=false,dnsWrites=false,
            serviceInstallationVerified=false,policyLifetimeVerified=false }));
        return 0;
    }
    private static async Task<(int Exit,string Output)> Capture(string[] args)
    {
        var oldOut=Console.Out;var oldError=Console.Error;using var output=new StringWriter();using var error=new StringWriter();
        try {Console.SetOut(output);Console.SetError(error);int result=await EgoistShield.Service.Program.Main(args);return(result,output.ToString());}
        finally {Console.SetOut(oldOut);Console.SetError(oldError);}
    }
}
