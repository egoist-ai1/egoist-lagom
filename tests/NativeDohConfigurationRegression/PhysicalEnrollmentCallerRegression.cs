using EgoistShield.Service;
using System.Reflection;
using System.Text.Json;

namespace NativeDohRegression;

internal static partial class Program
{
    private static readonly DnsAdapterSnapshot VirtualBaseline = Baseline with {
        InterfaceIndex=20, InterfaceAlias="vEthernet (nat)", InterfaceGuid="{22222222-2222-2222-2222-222222222222}",
        Ipv4=new[]{"198.51.100.53"}, Ipv4Static=false };
    private static DnsAdapterSnapshot Applied(DnsAdapterSnapshot adapter) => adapter with { Ipv4=new[]{"1.1.1.1"}, Ipv4Static=true };
    private static void Physical(Model model) => model.PhysicalGuids = new(StringComparer.OrdinalIgnoreCase) { Baseline.InterfaceGuid };
    private static string NativeFile(Model model) => Path.Combine(model.Root,"native-doh-state.json");
    private static string LocalFile(Model model) => Path.Combine(model.Root,"dns-owned-state.json");
    private static bool Mutated(Model model) => model.Events.Any(x => x is "dns.apply" or "dns.reset" or "dns.restore" or "native.configure" or "native.restore-or-remove");
    private static async Task<T> Invoke<T>(object instance,string name,params object[] args) {
        var method=instance.GetType().GetMethod(name,BindingFlags.Instance|BindingFlags.Public|BindingFlags.NonPublic) ?? throw new InvalidOperationException("Required actual method missing: "+name);
        return await ((Task<T>)method.Invoke(instance,args)!);
    }

    private static async Task PhysicalEnrollmentCallerRegressionAsync()
    {
        await Check("plain automatic apply excludes virtual while generic snapshot stays broad",async () => {
            using var model=new Model(new[]{Baseline,VirtualBaseline});Physical(model);
            Assert((await model.Dns.ReadSnapshotAsync()).Length==2,"Generic snapshot was narrowed.");
            var response=await model.Dispatch("dns.apply",new{servers=new[]{"9.9.9.9"}});
            Assert(response.Ok,"Automatic plain apply failed: "+response.Error?.Message);
            Assert(model.Adapters[0].Ipv4.SequenceEqual(new[]{"9.9.9.9"}) && model.Adapters[1].Ipv4.SequenceEqual(VirtualBaseline.Ipv4),"Automatic plain apply targeted a virtual adapter.");
            var saved=JsonSerializer.Deserialize<DnsOwnedState>(await File.ReadAllTextAsync(LocalFile(model)),JsonDefaults.StateOptions)!;
            Assert(saved.OriginalAdapters.Length==1 && model.Events.Contains("dns.physical"),"Plain automatic enrollment captured virtual ownership.");
        });
        await Check("native physical enrollment and exact owned health ignore unmanaged virtual",async () => {
            using var model=new Model(new[]{Baseline,VirtualBaseline});Physical(model);
            var response=await model.Dispatch("dns.doh.apply",new{url=OldUrl,servers=new[]{"1.1.1.1"}});
            Assert(response.Ok,"Native automatic enrollment failed: "+response.Error?.Message);
            Assert((await model.Native.ReadOwnedStateAsync())!.OriginalDnsAdapters!.Length==1 && model.Adapters[1].Ipv4.SequenceEqual(VirtualBaseline.Ipv4),"Native automatic enrollment captured virtual ownership.");
            var health=await model.Dispatch("dns.doh.status",new{});
            Assert(health.Ok && JsonDefaults.ToElement(health.Result).GetProperty("verified").GetBoolean() && JsonDefaults.ToElement(health.Result).GetProperty("adapters").GetArrayLength()==1,"Unmanaged virtual adapter contaminated owned health: "+health.Error?.Message);
        });
        await Check("saved disconnected virtual participates in exact health and removal",async () => {
            using var model=new Model(new[]{Applied(Baseline),Applied(VirtualBaseline)});Physical(model);model.DisconnectedGuids.Add(VirtualBaseline.InterfaceGuid);
            await model.Native.WriteOwnedStateAsync(Owned(baseline:new[]{Baseline,VirtualBaseline}));
            var health=await model.Dispatch("dns.doh.status",new{});
            Assert(health.Ok && JsonDefaults.ToElement(health.Result).GetProperty("verified").GetBoolean() && JsonDefaults.ToElement(health.Result).GetProperty("adapters").GetArrayLength()==2,"Saved virtual GUID was omitted from health.");
            var removed=await model.Dispatch("dns.doh.remove",new{});
            Assert(removed.Ok && model.Adapters[0].Ipv4.SequenceEqual(Baseline.Ipv4) && model.Adapters[1].Ipv4.SequenceEqual(VirtualBaseline.Ipv4),"Disconnected owned virtual baseline was not restored.");
            Assert(await model.Native.ReadOwnedStateAsync()==null && !model.Entries.ContainsKey("1.1.1.1"),"Successful full restore failed to retire ownership.");
        });
        await Check("provider IP migration keeps explicit disconnected old virtual targets",async () => {
            using var model=new Model(new[]{Applied(Baseline),Applied(VirtualBaseline)});Physical(model);model.DisconnectedGuids.Add(VirtualBaseline.InterfaceGuid);
            await model.Native.WriteOwnedStateAsync(Owned(baseline:new[]{Baseline,VirtualBaseline}));
            var response=await model.Dispatch("dns.doh.apply",new{url=NewUrl,servers=new[]{"9.9.9.9"}});
            Assert(response.Ok && model.Adapters.All(x=>x.Ipv4.SequenceEqual(new[]{"9.9.9.9"})),"Provider migration skipped old disconnected virtual ownership: "+response.Error?.Message);
            Assert((await model.Native.ReadOwnedStateAsync())!.OriginalDnsAdapters!.Length==2,"Provider migration lost old virtual baseline.");
        });
        await Check("missing saved GUID refuses health/remove before journal or retirement",async () => {
            using var model=new Model(new[]{Applied(Baseline)});Physical(model);
            await model.Native.WriteOwnedStateAsync(Owned(baseline:new[]{Baseline,VirtualBaseline}));string before=await File.ReadAllTextAsync(NativeFile(model));
            var health=await model.Dispatch("dns.doh.status",new{});Assert(!health.Ok,"Incomplete owned health was admitted.");
            var removed=await model.Dispatch("dns.doh.remove",new{});
            Assert(!removed.Ok && !Mutated(model) && await model.Journal.ReadActiveAsync()==null && await File.ReadAllTextAsync(NativeFile(model))==before && model.Entries.ContainsKey("1.1.1.1"),"Missing recorded adapter retired ownership or mutated DNS.");
        });
        await Check("owned reset touches recorded disconnected virtual but preserves outside physical",async () => {
            var outside=Baseline with{InterfaceIndex=30,InterfaceGuid="{33333333-3333-3333-3333-333333333333}",InterfaceAlias="outside",Ipv4=new[]{"203.0.113.53"},Ipv4Static=true};
            using var model=new Model(new[]{outside,Applied(VirtualBaseline)});model.PhysicalGuids=new(StringComparer.OrdinalIgnoreCase){outside.InterfaceGuid};model.DisconnectedGuids.Add(VirtualBaseline.InterfaceGuid);
            await File.WriteAllTextAsync(LocalFile(model),Json(new DnsOwnedState(1,"EgoistShield",new[]{"1.1.1.1"},new[]{VirtualBaseline})));
            var response=await model.Dispatch("dns.reset",new{});
            Assert(response.Ok && model.Adapters[0].Ipv4Static && model.Adapters[0].Ipv4.SequenceEqual(outside.Ipv4) && !model.Adapters[1].Ipv4Static && !File.Exists(LocalFile(model)),"Owned reset changed outside adapter or omitted saved virtual: "+response.Error?.Message);
        });
        await Check("missing local owned reset preserves exact ownership before writes",async () => {
            using var model=new Model(new[]{Baseline});Physical(model);
            await File.WriteAllTextAsync(LocalFile(model),Json(new DnsOwnedState(1,"EgoistShield",new[]{"1.1.1.1"},new[]{VirtualBaseline})));string before=await File.ReadAllTextAsync(LocalFile(model));
            var response=await model.Dispatch("dns.reset",new{});
            Assert(!response.Ok && !Mutated(model) && await model.Journal.ReadActiveAsync()==null && await File.ReadAllTextAsync(LocalFile(model))==before,"Missing reset target retired ownership or reset another device.");
        });
        await Check("central restore rejects incomplete transaction scope without extending it",async () => {
            using var model=new Model(new[]{Applied(Baseline),Applied(VirtualBaseline)});Physical(model);
            var state=Owned(baseline:new[]{Baseline,VirtualBaseline});bool refused=false;
            try{await Invoke<DnsAdapterSnapshot[]>(model.Dispatcher,"RestoreNativeDohDnsBaselineAsync",state,new[]{Applied(Baseline)},CancellationToken.None);}catch(InvalidOperationException){refused=true;}
            Assert(refused && !Mutated(model) && !model.Events.Contains("dns.readback"),"Central restore performed a write or extended incomplete journal scope.");
        });
        await Check("complete old virtual restore preserves externally changed peer family",async () => {
            var external=Applied(VirtualBaseline) with{Ipv4=new[]{"203.0.113.99"}};
            using var model=new Model(new[]{Applied(Baseline),external});Physical(model);model.DisconnectedGuids.Add(VirtualBaseline.InterfaceGuid);
            await model.Native.WriteOwnedStateAsync(Owned(baseline:new[]{Baseline,VirtualBaseline}));
            var health=await model.Dispatch("dns.doh.status",new{});
            Assert(health.Ok && !JsonDefaults.ToElement(health.Result).GetProperty("verified").GetBoolean() && !JsonDefaults.ToElement(health.Result).GetProperty("encrypted").GetBoolean(),"Externally changed owned virtual adapter was reported verified/encrypted.");
            var response=await model.Dispatch("dns.doh.remove",new{});
            Assert(response.Ok && model.Adapters[0].Ipv4.SequenceEqual(Baseline.Ipv4) && model.Adapters[1].Ipv4.SequenceEqual(external.Ipv4),"Restore overwrote an externally changed virtual DNS family.");
        });
        await Check("required GUID reader rejects missing/recycled/duplicate identities before writes",async () => {
            foreach(var rows in new[]{new[]{Baseline},new[]{VirtualBaseline with{InterfaceGuid="{99999999-9999-9999-9999-999999999999}"}},new[]{VirtualBaseline,VirtualBaseline}}){
                using var model=new Model(rows);bool refused=false;
                try{await Invoke<DnsAdapterSnapshot[]>(model.Dns,"ReadRequiredSnapshotAsync",new[]{VirtualBaseline},CancellationToken.None);}catch(InvalidOperationException){refused=true;}
                Assert(refused && !Mutated(model),"Required GUID reader accepted missing/recycled/duplicate identity.");
            }
        });
        await Check("actual uninstall refuses missing recorded baseline before any native flush",async () => {
            using var model=new Model(new[]{Applied(Baseline)}){ForbidDnsWrites=true,ForbidNativeWrites=true};Physical(model);
            await model.Native.WriteOwnedStateAsync(Owned(baseline:new[]{Baseline,VirtualBaseline}));
            string before=await File.ReadAllTextAsync(NativeFile(model));bool refused=false;
            try{await model.Native.RemoveForUninstallAsync(model.Dns);}catch(InvalidOperationException error){refused=error.Message.Contains("Recorded DNS adapters");}
            Assert(refused && !Mutated(model) && await File.ReadAllTextAsync(NativeFile(model))==before && model.Entries.ContainsKey("1.1.1.1"),"Uninstall bypassed required recorded identity or attempted a mutation.");
        });
        await Check("repair owned refuses missing baseline before health journal or retirement",async () => {
            using var model=new Model(new[]{Applied(Baseline)}){ForbidDnsWrites=true,ForbidNativeWrites=true};Physical(model);
            await model.Native.WriteOwnedStateAsync(Owned(baseline:new[]{Baseline,VirtualBaseline}));
            string before=await File.ReadAllTextAsync(NativeFile(model));
            var response=await model.Dispatch("network.repair-owned",new{});
            Assert(!response.Ok && response.Error?.Message.Contains("Recorded DNS adapters")==true && !Mutated(model) && await model.Journal.ReadActiveAsync()==null && await File.ReadAllTextAsync(NativeFile(model))==before,"Repair retired an incomplete recorded adapter baseline.");
        });
        await Check("empty physical selection fails before native journal or mutation",async () => {
            using var model=new Model(new[]{Baseline,VirtualBaseline});model.PhysicalGuids=new(StringComparer.OrdinalIgnoreCase);
            var response=await model.Dispatch("dns.doh.apply",new{url=OldUrl,servers=new[]{"1.1.1.1"}});
            Assert(!response.Ok && !Mutated(model) && await model.Journal.ReadActiveAsync()==null && await model.Native.ReadOwnedStateAsync()==null,"Empty physical selection was admitted or journaled.");
        });
        await Check("physical maintenance input preserves known virtual and foreign static ownership",async () => {
            var fresh=Baseline with{InterfaceIndex=30,InterfaceGuid="{33333333-3333-3333-3333-333333333333}",Ipv4Static=false};
            var foreign=Baseline with{InterfaceIndex=40,InterfaceGuid="{44444444-4444-4444-4444-444444444444}",Ipv4Static=true,Ipv4=new[]{"203.0.113.99"}};
            using var model=new Model(new[]{Baseline,VirtualBaseline,fresh,foreign});model.PhysicalGuids=new(StringComparer.OrdinalIgnoreCase){Baseline.InterfaceGuid,fresh.InterfaceGuid,foreign.InterfaceGuid};
            var physical=await Invoke<DnsAdapterSnapshot[]>(model.Dns,"ReadPhysicalSnapshotAsync",CancellationToken.None);
            var targets=DnsMaintenancePolicy.NewAutomaticAdapters(physical,new[]{Baseline,VirtualBaseline});
            Assert(targets.Length==1 && targets[0].InterfaceGuid==fresh.InterfaceGuid && !Mutated(model),"Maintenance enrolled known virtual or foreign static DNS.");
        });
    }
}
