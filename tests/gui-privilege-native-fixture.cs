using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Security.Principal;
using System.Text.Json;
using System.Threading;

internal static class Program
{
    static int Main(string[] args)
    {
        if(args.Length==1 && args[0]=="--minimized")
        {
            File.WriteAllText(Path.Combine(Environment.CurrentDirectory,"owned-child-proof.json"),JsonSerializer.Serialize(new {pid=Environment.ProcessId, birth=Process.GetCurrentProcess().StartTime.ToUniversalTime(), administrator=new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator)}));
            return 0;
        }
        if(args.Length!=1 || !Path.IsPathRooted(args[0]))return 64;
        string root=Path.GetFullPath(Environment.CurrentDirectory);
        string marker=Path.Combine(root,"owned-child-proof.json");
        if(File.Exists(marker))return 65;
        Assembly production=Assembly.LoadFrom(args[0]);
        Type policy=production.GetType("EgoistShield.Service.GuiPrivilegePolicy",true)!;
        using var self=Process.GetCurrentProcess();
        object token=policy.GetMethod("Read",BindingFlags.NonPublic|BindingFlags.Static)!.Invoke(null,new object[]{self})!;
        Type fields=token.GetType();
        bool admitted=(bool)fields.GetProperty("Allowed",BindingFlags.NonPublic|BindingFlags.Instance)!.GetValue(token)!;
        bool elevated=(bool)fields.GetProperty("Elevated")!.GetValue(token)!;
        bool administrator=(bool)fields.GetProperty("Administrator")!.GetValue(token)!;
        bool restricted=(bool)fields.GetProperty("Restricted")!.GetValue(token)!;
        uint integrity=(uint)fields.GetProperty("IntegrityRid")!.GetValue(token)!;
        bool principal=new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator);
        bool rejected=false;
        try { policy.GetMethod("Require",BindingFlags.NonPublic|BindingFlags.Static)!.Invoke(null,new object[]{self}); }
        catch(TargetInvocationException error) when(error.InnerException is UnauthorizedAccessException){rejected=true;}
        var launcher=production.GetType("EgoistShield.Service.GuiElevationCommand",true)!;
        string child=Environment.ProcessPath!;
        bool launchRejected=false;
        try {
            launcher.GetMethod("StartVerifiedGui",BindingFlags.NonPublic|BindingFlags.Static)!.Invoke(null,new object[]{child,root,new[]{"--minimized"},self.SessionId,TimeSpan.FromSeconds(5)});
        } catch(TargetInvocationException error) when(error.InnerException is UnauthorizedAccessException){launchRejected=true;}
        for(int index=0;index<50 && admitted && !File.Exists(marker);index++)Thread.Sleep(100);
        bool executed=File.Exists(marker);
        bool ownedChildHigh=false;
        if(executed) {using var proof=JsonDocument.Parse(File.ReadAllText(marker));ownedChildHigh=proof.RootElement.GetProperty("administrator").GetBoolean();}
        // An expired startup must retire its own suspended child before resume,
        // including when this fixture runs under the real High CI token.
        bool expiredRejected=false;
        try {launcher.GetMethod("StartVerifiedGui",BindingFlags.NonPublic|BindingFlags.Static)!.Invoke(null,new object[]{child,root,new[]{"--minimized"},self.SessionId,TimeSpan.Zero});}
        catch(TargetInvocationException error) when(error.InnerException is TimeoutException || !admitted && error.InnerException is UnauthorizedAccessException){expiredRejected=true;}
        Console.WriteLine(JsonSerializer.Serialize(new {admitted,elevated,administrator,restricted,integrity,principal,requireRejected=rejected,launchRejected,executed,ownedChildHigh,expiredRejected,unrelatedProcessKills=0,networkMutations=0,scmMutations=0}));
        return admitted==!rejected && administrator==principal && executed==admitted && launchRejected==!admitted && (!admitted||ownedChildHigh) && expiredRejected ? 0 : 1;
    }
}