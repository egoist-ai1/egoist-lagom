using System.Diagnostics;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using EgoistShield.Service;

namespace RuntimeIdentityProduction;

internal static class TestProgram
{
    private static string _work = "";
    private static readonly List<object> Cases = new();
    private static async Task<int> Main(string[] args)
    {
        if (args.Length == 2 && args[0] == "--probe-argv")
        {
            try
            {
                using var peer = Process.GetProcessById(int.Parse(args[1]));
                GuiLaunchPolicy.RequireMainProcess(peer);
                Console.WriteLine("{\"allowed\":true}"); return 0;
            }
            catch (Exception error) { Console.WriteLine(JsonSerializer.Serialize(new { allowed = false, error = error.Message })); return 2; }
        }
        if (args.Length == 2 && args[0] == "--worker-error")
        {
            using var document = JsonDocument.Parse(Console.ReadLine()!);
            Console.WriteLine(JsonSerializer.Serialize(new { id = document.RootElement.GetProperty("id").GetString(), ok = false, error = "Own bounded fixture error", errorCode = args[1] == "unsupported-number" ? (object)42 : args[1] })); return 0;
        }
        int index = Array.IndexOf(args, "--work");
        if (index < 0)
        {
            // An inert own child stays alive while native argv is observed.
            await Console.In.ReadLineAsync(); return 0;
        }
        _work = Path.Combine(Path.GetFullPath(args[index + 1]), "ic-" + Guid.NewGuid().ToString("N")[..8]);
        Directory.CreateDirectory(_work);
        try
        {
            await Case("Native GUI argument policy accepts normal startup and rejects Chrome/child/injection modes", NativeArguments);
            await Case("Named-pipe PID/token identity is actual; foreign client rejected outside explicit development override", NativePipe);
            await Case("Actual host hashes and NTFS read leases block writes/replacement until disposal", HeldFiles);
            await Case("Host rejects missing/duplicate/escaped inventory and altered executable bytes", InvalidInventories);
            await Case("Host rejects hardlinked inputs and unpinned side-loaded DLL", LinkedAndDll);
            await Case("Bundled runtime manifest pins exact component executable and DLL set", NativeRuntime);
            await Case("ACL validator accepts native OS descriptor and rejects writable/untrusted descriptors", SecurityDescriptors);
            await Case("VPN worker known and unknown rollback outcomes preserve fixed structured errors", StructuredWorkerErrors);
            WriteResults(true); return 0;
        }
        catch (Exception error) { Console.Error.WriteLine(error); WriteResults(false); return 1; }
    }

    private static async Task Case(string name, Func<Task<object>> action)
    {
        var watch = Stopwatch.StartNew();
        try { var observed = await action(); var result = new { name, passed = true, elapsedMs = watch.ElapsedMilliseconds, observed }; Cases.Add(result); Console.WriteLine(JsonSerializer.Serialize(result)); }
        catch (Exception error) { var result = new { name, passed = false, elapsedMs = watch.ElapsedMilliseconds, error = error.Message }; Cases.Add(result); Console.WriteLine(JsonSerializer.Serialize(result)); throw; }
    }
    private static void WriteResults(bool passed) => File.WriteAllText(Path.Combine(_work, "results.json"), JsonSerializer.Serialize(new { schemaVersion = 1, passed, scope = "Actual own NTFS/pipe/process/ACL APIs; inventory byte fixtures bypass only installed-root ACL via compile-time seam. No installed GUI acceptance/SCM/DNS/Tasks/registry.", cases = Cases }, new JsonSerializerOptions { WriteIndented = true }));
    private static void Assert(bool condition, string message) { if (!condition) throw new Exception(message); }
    private static T Throws<T>(Action action) where T : Exception
    { try { action(); } catch (T error) { return error; } throw new Exception("Expected " + typeof(T).Name); }
    private static ProcessStartInfo OwnChild(params string[] arguments)
    {
        var start = new ProcessStartInfo(Environment.ProcessPath!) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true, WorkingDirectory = _work };
        foreach (var argument in arguments) start.ArgumentList.Add(argument); return start;
    }
    private static async Task<object> NativeArguments()
    {
        string[][] allowed = { Array.Empty<string>(), new[] { "--minimized" }, new[] { "--background" }, new[] { "--background", "--minimized" } };
        string[][] denied = { new[] { "--remote-debugging-port=9222" }, new[] { "--remote-debugging-pipe" }, new[] { "--type=renderer" }, new[] { "--app=C:\\own-fixture" }, new[] { "--inspect=127.0.0.1:9222" }, new[] { "--user-data-dir=C:\\own-fixture" }, new[] { "--load-extension=C:\\own-fixture" }, new[] { "--js-flags=--expose-gc" }, new[] { "--minimized", "--minimized" }, new[] { "--MINIMIZED" } };
        foreach (var (arguments, expected) in allowed.Select(value => (value, true)).Concat(denied.Select(value => (value, false))))
        {
            using var child = Process.Start(OwnChild(arguments))!;
            try
            {
                if (expected) GuiLaunchPolicy.RequireMainProcess(child);
                else Throws<UnauthorizedAccessException>(() => GuiLaunchPolicy.RequireMainProcess(child));
            }
            finally { child.StandardInput.Close(); await child.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(3)); }
        }
        var quoted = GuiLaunchPolicy.ParseCommandLine("\"C:\\Program Files\\EgoistShield\\EgoistShield.exe\" \"--background\" --minimized");
        GuiLaunchPolicy.RequireArguments(quoted);
        Throws<UnauthorizedAccessException>(() => GuiLaunchPolicy.ParseCommandLine("bad\0argument"));
        return new { nativeChildren = allowed.Length + denied.Length, allowed = allowed.Length, rejected = denied.Length, osQuotedParser = true };
    }
    private static async Task<object> NativePipe()
    {
        string pipeName = "lagom.identity." + Guid.NewGuid().ToString("N");
        using var server = new NamedPipeServerStream(pipeName, PipeDirection.InOut, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous);
        using var client = new NamedPipeClientStream(".", pipeName, PipeDirection.InOut, PipeOptions.Asynchronous);
        await Task.WhenAll(server.WaitForConnectionAsync(), client.ConnectAsync(3000));
        string installed = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "EgoistShield");
        var production = new ClientAuthorizer(new(pipeName, _work, false, false, installed), null);
        Throws<UnauthorizedAccessException>(() => production.Authorize(server));
        var development = new ClientAuthorizer(new(pipeName, _work, true, true, null), null).Authorize(server);
        using var identity = WindowsIdentity.GetCurrent();
        Assert(development.ProcessId == Environment.ProcessId && development.UserSid == identity.User!.Value && development.DevelopmentOverride, "Native PID/SID observation did not match actual fixture identity.");
        return new { foreignProductionDenied = true, actualPidConfirmed = true, actualSidConfirmed = true, standardInstalledGuiAcceptance = "requires installed candidate and ordinary-user acceptance" };
    }
    private sealed class Fixture
    {
        internal readonly string Root;
        internal readonly List<Dictionary<string, object>> Entries = new();
        internal Fixture()
        {
            Root = Path.Combine(_work, "f" + Guid.NewGuid().ToString("N")[..8]); Directory.CreateDirectory(Root);
            Add("EgoistShield.exe", Fuse("000011011"), "gui"); Add("EgoistShield.Worker.exe", Fuse("100011011"), "worker");
            Add("ffmpeg.dll", "own shared DLL"u8.ToArray(), "gui", "worker");
            Add("resources/app.asar", "own byte fixture; real ASAR is tested separately"u8.ToArray(), "gui");
            Add("resources/component-worker.cjs", "own fixed worker"u8.ToArray(), "worker");
            Add("resources/core-service/win-x64/EgoistShield.Service.exe", "own fixed Core byte fixture"u8.ToArray(), "worker", "cli");
            byte[] runtime = "own pinned runtime"u8.ToArray(); Write("resources/runtime/xray/xray.exe", runtime);
            string manifest = JsonSerializer.Serialize(new { schemaVersion = 1, components = new[] { new { name = "xray", present = true, files = new[] { new { path = "xray/xray.exe", size = runtime.Length, sha256 = Hash(runtime) } } } } });
            Add("resources/runtime/manifest.json", Encoding.UTF8.GetBytes(manifest), "worker", "cli"); Inventory();
        }
        internal string PathOf(string relative) => Path.Combine(Root, relative.Replace('/', Path.DirectorySeparatorChar));
        internal void Write(string relative, byte[] bytes) { string file = PathOf(relative); Directory.CreateDirectory(Path.GetDirectoryName(file)!); File.WriteAllBytes(file, bytes); }
        internal void Add(string relative, byte[] bytes, params string[] roles) { Write(relative, bytes); Entries.Add(new() { ["path"] = relative, ["bytes"] = bytes.Length, ["sha256"] = Hash(bytes), ["roles"] = roles }); }
        internal void Inventory() => Write("resources/worker-host-integrity.json", JsonSerializer.SerializeToUtf8Bytes(new { schemaVersion = 1, owner = "EgoistShield", files = Entries }));
        internal ProtectedExecutable Open(string role) => ProtectedExecutable.OpenHost(Root, role, (_, _) => { }, nativeHandleChecks: true);
        internal static string Hash(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
        internal static byte[] Fuse(string wire) => Encoding.ASCII.GetBytes("own prefix:dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX\x01\x09" + wire + ":own suffix");
    }
    private static Task<object> HeldFiles()
    {
        var fixture = new Fixture();
        using (fixture.Open("gui"))
        {
            foreach (string file in new[] { "EgoistShield.exe", "ffmpeg.dll", "resources/app.asar", "resources/worker-host-integrity.json" })
                Throws<IOException>(() => File.AppendAllText(fixture.PathOf(file), "must not write"));
            Throws<IOException>(() => File.Move(fixture.PathOf("resources/app.asar"), fixture.PathOf("resources/replaced.asar")));
        }
        File.AppendAllText(fixture.PathOf("resources/app.asar"), "lease retired; own writer now allowed");
        return Task.FromResult<object>(new { preventedWrites = 4, preventedMoves = 1, writerAllowedAfterDisposal = true });
    }
    private static Task<object> InvalidInventories()
    {
        int refused = 0;
        foreach (Action<Fixture> mutate in new Action<Fixture>[] {
            f => { f.Entries.RemoveAll(value => (string)value["path"] == "resources/app.asar"); f.Inventory(); },
            f => { f.Entries.Add(new(f.Entries[0])); f.Inventory(); },
            f => { f.Entries[0]["path"] = "../outside.exe"; f.Inventory(); },
            f => { f.Entries[0]["path"] = "EgoistShield.exe\n"; f.Inventory(); },
            f => File.AppendAllText(f.PathOf("EgoistShield.exe"), "altered bytes"),
            f => { byte[] bad = Fixture.Fuse("101100011"); f.Write("EgoistShield.exe", bad); f.Entries[0]["bytes"] = bad.Length; f.Entries[0]["sha256"] = Fixture.Hash(bad); f.Inventory(); }
        })
        {
            var fixture = new Fixture(); mutate(fixture);
            try { using var lease = fixture.Open("gui"); throw new Exception("Malformed host inventory was accepted."); }
            catch (Exception error) when (error is UnauthorizedAccessException or InvalidDataException or FileNotFoundException) { refused++; }
            File.AppendAllText(fixture.PathOf("resources/worker-host-integrity.json"), "failure lease must be released");
        }
        return Task.FromResult<object>(new { refused, failureHandlesReleased = true });
    }
    private static Task<object> LinkedAndDll()
    {
        var linked = new Fixture(); string alias = linked.PathOf("alias.exe");
        Assert(CreateHardLink(alias, linked.PathOf("EgoistShield.exe"), IntPtr.Zero), "Cannot create own NTFS hardlink.");
        Throws<UnauthorizedAccessException>(() => linked.Open("gui")); File.Delete(alias);
        var dll = new Fixture(); dll.Write("injected.dll", "own unpinned DLL"u8.ToArray()); Throws<UnauthorizedAccessException>(() => dll.Open("gui"));
        return Task.FromResult<object>(new { actualHardlinkDenied = true, actualUnpinnedDllDenied = true });
    }
    private static Task<object> NativeRuntime()
    {
        var valid = new Fixture();
        using (var lease = valid.Open("cli"))
        {
            lease.VerifyBundledRuntime(valid.PathOf("resources/runtime/xray/xray.exe"), "xray");
            Throws<IOException>(() => File.AppendAllText(valid.PathOf("resources/runtime/xray/xray.exe"), "must not write"));
            Throws<UnauthorizedAccessException>(() => lease.VerifyBundledRuntime(valid.PathOf("EgoistShield.exe"), "xray"));
            Throws<ArgumentException>(() => lease.VerifyBundledRuntime(valid.PathOf("EgoistShield.exe"), "arbitrary"));
        }
        var injected = new Fixture(); injected.Write("resources/runtime/xray/injected.dll", "own DLL"u8.ToArray());
        using (var lease = injected.Open("cli")) Throws<UnauthorizedAccessException>(() => lease.VerifyBundledRuntime(injected.PathOf("resources/runtime/xray/xray.exe"), "xray"));
        var altered = new Fixture(); var changedBytes = File.ReadAllBytes(altered.PathOf("resources/runtime/xray/xray.exe")); changedBytes[0] ^= 1; File.WriteAllBytes(altered.PathOf("resources/runtime/xray/xray.exe"), changedBytes);
        using (var lease = altered.Open("cli")) Throws<UnauthorizedAccessException>(() => lease.VerifyBundledRuntime(altered.PathOf("resources/runtime/xray/xray.exe"), "xray"));
        return Task.FromResult<object>(new { runtimeImmutableLease = true, customPathDenied = true, unknownComponentDenied = true, unpinnedDllDenied = true, changedBytesDenied = true });
    }
    private static Task<object> SecurityDescriptors()
    {
        string nativeShell = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "WindowsPowerShell", "v1.0", "powershell.exe");
        ProtectedExecutable.AssertProtectedSecurity(new FileInfo(nativeShell).GetAccessControl(AccessControlSections.Owner | AccessControlSections.Access));
        string own = Path.Combine(_work, "acl-own"); File.WriteAllText(own, "own file");
        Throws<UnauthorizedAccessException>(() => ProtectedExecutable.AssertProtectedSecurity(new FileInfo(own).GetAccessControl(AccessControlSections.Owner | AccessControlSections.Access)));
        var administrators = new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null);
        var users = new SecurityIdentifier(WellKnownSidType.BuiltinUsersSid, null);
        var descriptor = new DirectorySecurity(); descriptor.SetOwner(administrators);
        descriptor.AddAccessRule(new FileSystemAccessRule(users, FileSystemRights.ReadAndExecute, AccessControlType.Allow));
        descriptor.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier("S-1-3-0"), FileSystemRights.FullControl, InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.InheritOnly, AccessControlType.Allow));
        ProtectedExecutable.AssertProtectedSecurity(descriptor);
        descriptor.AddAccessRule(new FileSystemAccessRule(users, FileSystemRights.DeleteSubdirectoriesAndFiles, AccessControlType.Allow));
        Throws<UnauthorizedAccessException>(() => ProtectedExecutable.AssertProtectedSecurity(descriptor));
        return Task.FromResult<object>(new { actualNativeOsDescriptorAccepted = true, actualUserOwnedFileDenied = true, inheritOnlyCreatorRuleAccepted = true, foreignDeleteChildRuleDenied = true, installedAclPositiveAcceptance = "requires installed candidate" });
    }
    private static async Task<object> StructuredWorkerErrors()
    {
        foreach (string code in new[] { "VPN_SERVICE_VALIDATION_FAILED", "VPN_SERVICE_ROLLBACK_VERIFIED", "VPN_SERVICE_ROLLBACK_UNKNOWN", "unsupported", "unsupported-number" })
        {
            using var worker = new ComponentWorker(() => Process.Start(OwnChild("--worker-error", code))!, TimeSpan.FromSeconds(5));
            using var payload = JsonDocument.Parse("{\"component\":\"Vpn\",\"method\":\"installService\",\"args\":[]}");
            try { await worker.ExecuteAsync(payload.RootElement, false, CancellationToken.None); throw new Exception("Worker error unexpectedly became success."); }
            catch (ServiceOperationException error) when (!code.StartsWith("unsupported", StringComparison.Ordinal)) { Assert(error.Code == (code == "VPN_SERVICE_ROLLBACK_UNKNOWN" ? "OPERATION_OUTCOME_UNKNOWN" : code), "Worker error code lost its fixed classification."); }
            catch (IOException) when (code.StartsWith("unsupported", StringComparison.Ordinal)) { }
        }
        return new { actualProtocolChildren = 5, knownErrorsPreserved = 2, unknownBarrierPreserved = 1, foreignCodeFailClosed = 2 };
    }
    [DllImport("kernel32.dll", EntryPoint = "CreateHardLinkW", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CreateHardLink(string link, string existing, IntPtr security);
}
