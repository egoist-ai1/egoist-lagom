using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using EgoistShield.Service;

namespace VpnServiceNative;
internal static class TestProgram
{
    private static void Check(bool condition, string message) { if (!condition) throw new Exception(message); }
    public static async Task<int> Main(string[] args)
    {
        if (args.Length == 2 && args[0] == "--marker-child") { await File.WriteAllTextAsync(args[1] + ".tmp", Environment.ProcessId.ToString()); File.Move(args[1] + ".tmp", args[1]); await Task.Delay(Timeout.Infinite); return 0; }
        if (args.Length == 2 && args[0] == "--job-parent")
        {
            using var job = VpnChildJob.Create();
            using var child = job.Start(Environment.ProcessPath!, new[] { "--marker-child", args[1] }, Path.GetDirectoryName(Environment.ProcessPath!)!);
            Check(IsProcessInJob(child.Handle, job.DangerousGetHandle(), out bool contained) && contained, "Child was not contained at creation.");
            await Task.Delay(Timeout.Infinite); return 0;
        }
        string work = Path.GetFullPath(args.Single()); Directory.CreateDirectory(work);
        var groups = new List<object>();
        var elapsed = Stopwatch.StartNew();
        ConfigContract(); groups.Add(new { name = "protected-config-contract", cases = 10, pass = true });
        await IntentRestore(work); groups.Add(new { name = "intent-restore-conflict", cases = 3, pass = true });
        bool denied = PrivateAcl(work); groups.Add(new { name = "complete-private-dacl", cases = 5, pass = true, ownNtfsReadDenied = denied });
        await Socks(); groups.Add(new { name = "actual-loopback-socks", cases = 64, pass = true });
        await ChildCrash(work); groups.Add(new { name = "job-at-process-creation-parent-crash", cases = 8, pass = true });
        Console.WriteLine(JsonSerializer.Serialize(new { passed = true, groups, elapsedMs = elapsed.Elapsed.TotalMilliseconds,
            nativeScmMutations = 0, dnsMutations = 0, tunStarts = 0, persistentTasks = 0 }, JsonDefaults.Options));
        return 0;
    }

    private static VpnConnection Good()
    {
        string config = "{\"log\":{\"level\":\"error\"},\"inbounds\":[{\"type\":\"mixed\",\"listen\":\"127.0.0.1\",\"listen_port\":10838},{\"type\":\"tun\",\"interface_name\":\"egoist-vpn\",\"auto_route\":true,\"strict_route\":true}],\"outbounds\":[{\"type\":\"direct\",\"tag\":\"proxy\"}],\"route\":{\"final\":\"proxy\"}}";
        return new(1, "EgoistShield", "fixture", "fixture", "sing-box", 10838, Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(config))), config);
    }
    private static void ConfigContract()
    {
        var good = Good(); Check(VpnServiceConfiguration.Parse(JsonSerializer.Serialize(good, JsonDefaults.Options)).NodeId == "fixture", "Valid snapshot was rejected.");
        var bad = new[] { good with { Owner = "foreign" }, good with { SchemaVersion = 2 }, good with { RuntimeKind = "custom" }, good with { ProxyPort = 80 }, good with { NodeId = "" }, good with { ConfigSha256 = new string('0', 64) } };
        foreach (var value in bad) Reject(JsonSerializer.Serialize(value, JsonDefaults.Options));
        Reject(JsonSerializer.Serialize(good, JsonDefaults.Options).Replace("\"schemaVersion\":1", "\"executable\":\"calc.exe\",\"schemaVersion\":1"));
        foreach (string config in new[] { good.Config.Replace("127.0.0.1", "0.0.0.0"), good.Config.Replace("egoist-vpn", "foreign-tun") })
        { var wrong = good with { Config = config, ConfigSha256 = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(config))) }; Reject(JsonSerializer.Serialize(wrong, JsonDefaults.Options)); }
        void Reject(string text) { try { VpnServiceConfiguration.Parse(text); throw new Exception("Malformed VPN config was accepted."); } catch (Exception error) when (error is InvalidDataException or JsonException or KeyNotFoundException) { } }
    }
    private static async Task IntentRestore(string work)
    {
        string root = Path.Combine(work, "intent"); Directory.CreateDirectory(root); var store = new OwnedServiceIntentStore(root);
        await store.SetRunningAsync(ServiceContract.VpnServiceName, true, CancellationToken.None);
        await store.RestoreRunningAsync(ServiceContract.VpnServiceName, null, CancellationToken.None);
        Check(!(await store.ReadAsync(CancellationToken.None)).Services.ContainsKey(ServiceContract.VpnServiceName), "New start intent was not removed after verified failure.");
        await store.SetRunningAsync(ServiceContract.VpnServiceName, false, CancellationToken.None); var previous = (await store.ReadAsync(CancellationToken.None)).Services[ServiceContract.VpnServiceName];
        await store.SetRunningAsync(ServiceContract.VpnServiceName, true, CancellationToken.None); await store.RestoreRunningAsync(ServiceContract.VpnServiceName, previous, CancellationToken.None);
        Check(!(await store.ReadAsync(CancellationToken.None)).Services[ServiceContract.VpnServiceName].Running, "Original deliberate stop intent was not restored.");
        await store.SetRunningAsync(ServiceContract.VpnServiceName, true, CancellationToken.None); await store.MarkRecoveryAsync(ServiceContract.VpnServiceName, DateTimeOffset.UtcNow, CancellationToken.None);
        try { await store.RestoreRunningAsync(ServiceContract.VpnServiceName, previous, CancellationToken.None); throw new Exception("Stale intent restore was accepted."); } catch (InvalidOperationException) { }
        Check((await store.ReadAsync(CancellationToken.None)).Services[ServiceContract.VpnServiceName].Running, "New recovery intent was overwritten.");
    }
    private static bool PrivateAcl(string work)
    {
        var users = new SecurityIdentifier(WellKnownSidType.BuiltinUsersSid, null); var authenticated = new SecurityIdentifier(WellKnownSidType.AuthenticatedUserSid, null);
        string root = Path.Combine(work, "acl"), file = Path.Combine(root, "credentials.json"); Directory.CreateDirectory(root); File.WriteAllText(file, "fixture-private-data");
        var old = new FileInfo(file).GetAccessControl(); var exposed = new FileInfo(file).GetAccessControl();
        exposed.AddAccessRule(new FileSystemAccessRule(users, FileSystemRights.Read, AccessControlType.Allow));
        exposed.AddAccessRule(new FileSystemAccessRule(authenticated, FileSystemRights.Read, AccessControlType.Allow));
        new FileInfo(file).SetAccessControl(exposed);
        Check(new FileInfo(file).GetAccessControl().GetAccessRules(true, true, typeof(SecurityIdentifier)).Cast<FileSystemAccessRule>().Any(rule => rule.IdentityReference.Equals(authenticated)), "Explicit fixture permission was not present.");
        var privateAcl = ProtectedProductRoot.CreateFileAcl(privateData: true);
        Check(privateAcl.AreAccessRulesProtected, "Private DACL was not protected from inheritance.");
        Check(privateAcl.GetAccessRules(true, true, typeof(SecurityIdentifier)).Count == 2, "Private DACL contains more than SY/BA.");
        // The test owns this one ordinary NTFS file. Keep its current owner;
        // setting SYSTEM ownership would require a live elevation operation.
        privateAcl.SetOwner(WindowsIdentity.GetCurrent().User!);
        bool readDenied = false;
        try
        {
            new FileInfo(file).SetAccessControl(privateAcl);
            var actual = new FileInfo(file).GetAccessControl();
            Check(actual.AreAccessRulesProtected && actual.GetAccessRules(true, true, typeof(SecurityIdentifier)).Count == 2, "Actual NTFS DACL readback disagrees.");
            try { File.ReadAllText(file); } catch (UnauthorizedAccessException) { readDenied = true; }
            Check(ProtectedProductRoot.IsPrivatePath(Path.Combine(work, "Service", "idempotency.json"), work), "Core response store is not private.");
            Check(ProtectedProductRoot.IsPrivatePath(Path.Combine(work, "Runtime", "TelegramProxy", "config.json"), work), "Telegram secrets are not private.");
        }
        finally { new FileInfo(file).SetAccessControl(old); }
        return readDenied;
    }
    private static async Task Socks()
    {
        for (int index = 0; index < 64; index++)
        {
            using var listener = new TcpListener(IPAddress.Loopback, 0); listener.Start(); int port = ((IPEndPoint)listener.LocalEndpoint).Port;
            int scenario = index % 4;
            var serve = Task.Run(async () => {
                using var client = await listener.AcceptTcpClientAsync(); using var stream = client.GetStream(); byte[] greeting = new byte[3]; await stream.ReadExactlyAsync(greeting);
                Check(greeting.SequenceEqual(new byte[] { 5, 1, 0 }), "SOCKS greeting contract changed.");
                if (scenario == 0) await stream.WriteAsync(new byte[] { 5, 0 });
                if (scenario == 1) await stream.WriteAsync(new byte[] { 5, 255 });
                if (scenario == 2) { await stream.WriteAsync(new byte[] { 5 }); await Task.Delay(100); }
            });
            var health = await VpnServiceHealthProbe.SocksAsync(port, TimeSpan.FromMilliseconds(60), CancellationToken.None);
            Check(health == (scenario == 0 ? LocalServiceHealth.Responsive : LocalServiceHealth.Unresponsive), "Real SOCKS framing/deadline classified incorrectly.");
            await serve.WaitAsync(TimeSpan.FromSeconds(2));
        }
    }
    private static async Task ChildCrash(string work)
    {
        for (int index = 0; index < 8; index++)
        {
            string marker = Path.Combine(work, "job-" + index + ".txt");
            var start = new ProcessStartInfo(Environment.ProcessPath!) { UseShellExecute = false, CreateNoWindow = true };
            start.ArgumentList.Add("--job-parent"); start.ArgumentList.Add(marker);
            using var parent = Process.Start(start)!; Process? child = null;
            try
            {
                var clock = Stopwatch.StartNew();
                while (!File.Exists(marker) && clock.Elapsed < TimeSpan.FromSeconds(5)) { if (parent.HasExited) throw new Exception("Contained test parent exited prematurely."); await Task.Delay(10); }
                Check(File.Exists(marker), "Contained child marker was not observed.");
                int pid = int.Parse(await File.ReadAllTextAsync(marker)); child = Process.GetProcessById(pid); Check(!child.HasExited, "Child did not execute.");
                parent.Kill(); await parent.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(3));
                await child.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(3)); Check(child.HasExited, "Own child survived a parent crash.");
            }
            finally { if (!parent.HasExited) parent.Kill(entireProcessTree: true); if (child != null) { if (!child.HasExited) child.Kill(); child.Dispose(); } }
        }
    }
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool IsProcessInJob(IntPtr process, IntPtr job, [MarshalAs(UnmanagedType.Bool)] out bool result);
}
