using System.Security.AccessControl;
using System.Security.Principal;
using System.Text.Json;
using EgoistShield.Service;

namespace CoreOwnerRegression;

internal static class TestProgram
{
    private static readonly List<object> Results = new();
    private static string Work = "";
    private static readonly SecurityIdentifier SystemSid = new(WellKnownSidType.LocalSystemSid, null);
    private static readonly SecurityIdentifier AdminSid = new(WellKnownSidType.BuiltinAdministratorsSid, null);
    private static readonly SecurityIdentifier UsersSid = new(WellKnownSidType.BuiltinUsersSid, null);

    public static async Task<int> Main(string[] args)
    {
        if (args.Length != 1 || !Path.IsPathFullyQualified(args[0])) throw new ArgumentException("Pass an absolute owned work path.");
        Work = Path.GetFullPath(args[0]);
        Directory.CreateDirectory(Work);
        using var identity = WindowsIdentity.GetCurrent();
        bool administrator = new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator);
        await Run("owner-selection", () => {
            Check(ProtectedProductRoot.SelectAclOwner(SystemSid, false).Equals(SystemSid), "SYSTEM owner changed.");
            Check(ProtectedProductRoot.SelectAclOwner(UsersSid, true).Equals(AdminSid), "Administrator selected foreign SYSTEM instead of BA.");
            Reject(() => ProtectedProductRoot.SelectAclOwner(UsersSid, false));
            Reject(() => ProtectedProductRoot.SelectAclOwner(null, true));
            return Task.FromResult<object>(new { systemOwner = SystemSid.Value, administratorOwner = AdminSid.Value, untrustedDenied = true, unknownDenied = true });
        });
        await Run("descriptor-matrix", () => {
            var descriptors = new List<object>();
            foreach (SecurityIdentifier owner in new[] { SystemSid, AdminSid })
                foreach (bool privateData in new[] { true, false })
                    foreach (bool directory in new[] { true, false })
                    {
                        FileSystemSecurity acl = directory ? ProtectedProductRoot.CreateDirectoryAclForOwner(privateData, owner) : ProtectedProductRoot.CreateFileAclForOwner(privateData, owner);
                        byte[] binary = acl.GetSecurityDescriptorBinaryForm();
                        FileSystemSecurity roundtrip = directory ? new DirectorySecurity() : new FileSecurity();
                        roundtrip.SetSecurityDescriptorBinaryForm(binary);
                        ProtectedProductRoot.AssertAcl(roundtrip, privateData, directory, true, owner);
                        var rules = roundtrip.GetAccessRules(true, true, typeof(SecurityIdentifier)).Cast<FileSystemAccessRule>().ToArray();
                        Check(roundtrip.AreAccessRulesProtected && rules.Length == (privateData ? 2 : 3), "DACL cardinality or protection differs.");
                        Check(rules.Any(rule => rule.IdentityReference.Equals(SystemSid) && rule.FileSystemRights == FileSystemRights.FullControl), "SYSTEM full control absent.");
                        Check(rules.Any(rule => rule.IdentityReference.Equals(AdminSid) && rule.FileSystemRights == FileSystemRights.FullControl), "BA full control absent.");
                        Check(rules.Any(rule => rule.IdentityReference.Equals(UsersSid)) == !privateData, "Users exposed private data or lost public read access.");
                        descriptors.Add(new { owner = owner.Value, privateData, directory, sddl = roundtrip.GetSecurityDescriptorSddlForm(AccessControlSections.Owner | AccessControlSections.Access) });
                    }
            return Task.FromResult<object>(descriptors);
        });
        await Run("tampered-readback-denied", () => {
            Reject(() => ProtectedProductRoot.CreateFileAclForOwner(true, UsersSid));
            Reject(() => ProtectedProductRoot.CreateDirectoryAclForOwner(true, UsersSid));
            var exposed = ProtectedProductRoot.CreateFileAclForOwner(true, AdminSid);
            exposed.AddAccessRule(new FileSystemAccessRule(UsersSid, FileSystemRights.Read, AccessControlType.Allow));
            Reject(() => ProtectedProductRoot.AssertAcl(exposed, true, false, true));
            var weak = ProtectedProductRoot.CreateFileAclForOwner(true, AdminSid);
            weak.SetAccessRule(new FileSystemAccessRule(AdminSid, FileSystemRights.Read, AccessControlType.Allow));
            Reject(() => ProtectedProductRoot.AssertAcl(weak, true, false, true));
            var writablePublic = ProtectedProductRoot.CreateFileAclForOwner(false, AdminSid);
            writablePublic.SetAccessRule(new FileSystemAccessRule(UsersSid, FileSystemRights.Write, AccessControlType.Allow));
            Reject(() => ProtectedProductRoot.AssertAcl(writablePublic, false, false, true));
            Reject(() => ProtectedProductRoot.AssertAcl(ProtectedProductRoot.CreateFileAclForOwner(true, AdminSid), true, false, true, SystemSid));
            return Task.FromResult<object>(new { refusals = 6 });
        });
        await Run("actual-windows-token", () => {
            if (!identity.IsSystem && !administrator)
            {
                Reject(() => ProtectedProductRoot.CreateDirectoryAcl(true));
                Reject(() => ProtectedProductRoot.CreateFileAcl(true));
                string productionFile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "EgoistShield", "Service", "owner-readonly-probe.json");
                Reject(() => ProtectedProductRoot.AssertFileWriteAllowed(productionFile));
                return Task.FromResult<object>(new { actualSystem = false, actualAdministrator = false, descriptorRefusals = 2, productionWritePolicyRefused = true, productionFilesystemWrites = 0 });
            }
            SecurityIdentifier expected = identity.IsSystem ? SystemSid : AdminSid;
            ProtectedProductRoot.AssertAcl(ProtectedProductRoot.CreateDirectoryAcl(true), true, true, true, expected);
            ProtectedProductRoot.AssertAcl(ProtectedProductRoot.CreateFileAcl(true), true, false, true, expected);
            return Task.FromResult<object>(new { actualSystem = identity.IsSystem, actualAdministrator = administrator, selectedOwner = expected.Value, productionFilesystemWrites = 0 });
        });
        await Run("own-ntfs-create-before-content", async () => {
            string path = Path.Combine(Work, "creation-attributes.log");
            var acl = new FileSecurity(); acl.SetOwner(identity.User!); acl.SetAccessRuleProtection(true, false);
            acl.AddAccessRule(new FileSystemAccessRule(identity.User!, FileSystemRights.FullControl, AccessControlType.Allow));
            string expected = acl.GetSecurityDescriptorSddlForm(AccessControlSections.Owner | AccessControlSections.Access);
            await using (FileStream stream = new FileInfo(path).Create(FileMode.CreateNew, FileSystemRights.Write | FileSystemRights.ReadPermissions, FileShare.None, 4096, FileOptions.Asynchronous | FileOptions.WriteThrough, acl))
            {
                Check(stream.Length == 0, "Content preceded initial ACL readback.");
                Check(stream.GetAccessControl().GetSecurityDescriptorSddlForm(AccessControlSections.Owner | AccessControlSections.Access) == expected, "CreateNew security attributes or handle readback differ.");
                await stream.WriteAsync(new byte[] { 65 }); await stream.FlushAsync();
            }
            await using (FileStream stream = new FileInfo(path).Create(FileMode.OpenOrCreate, FileSystemRights.Write | FileSystemRights.ReadPermissions, FileShare.Read, 4096, FileOptions.Asynchronous, acl))
            {
                Check(stream.GetAccessControl().GetSecurityDescriptorSddlForm(AccessControlSections.Owner | AccessControlSections.Access) == expected, "Existing append security descriptor changed.");
                stream.Seek(0, SeekOrigin.End);
                await stream.WriteAsync(new byte[] { 66 }); await stream.FlushAsync();
            }
            Check((await File.ReadAllBytesAsync(path)).SequenceEqual(new byte[] { 65, 66 }), "Native ACL stream append contract failed.");
            return new { actualOwnedNtfs = true, emptyHandleAclReadbackBeforeContent = true, appendVerified = true, fixtureOwner = "actual token user", productionAclApply = false };
        });
        await Run("live-log-reader-sharing", async () => {
            string path = Path.Combine(Work, "live-writer.log");
            await using var writer = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.Read, 4096, FileOptions.Asynchronous);
            await writer.WriteAsync(System.Text.Encoding.UTF8.GetBytes("live-fixture")); await writer.FlushAsync();
            string? oldError = null;
            try { await File.ReadAllTextAsync(path); } catch (IOException error) { oldError = error.GetType().FullName; }
            Check(oldError is not null, "Original default reader did not reproduce its sharing conflict.");
            var method = typeof(SelfTest).GetMethod("ReadLiveTextAsync", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static)!;
            Task<string> Read(CancellationToken token) => (Task<string>)method.Invoke(null, new object[] { path, token })!;
            Check(await Read(CancellationToken.None) == "live-fixture", "Bounded shared reader failed with the actual writer still open.");
            using var cancelled = new CancellationTokenSource(); cancelled.Cancel();
            try { await Read(cancelled.Token); throw new Exception("Cancelled live read completed."); } catch (OperationCanceledException) { }
            writer.SetLength(8 * 1024 * 1024 + 1);
            try { await Read(CancellationToken.None); throw new Exception("Oversized live file was read."); } catch (InvalidOperationException) { }
            return new { originalReaderFailure = oldError, actualOpenWriter = true, sharedReaderPass = true, writerShareUnchanged = "Read", cancellationPreserved = true, maxBytes = 8 * 1024 * 1024, oversizedRefused = true };
        });
        object? atomicAclDiagnostics = null;
        await Run("nonproduction-atomic-files", async () => {
            string root = Path.Combine(Work, "atomic"); Directory.CreateDirectory(root);
            string target = Path.Combine(root, "state.json");
            await AtomicJsonFile.WriteAsync(target, new State(0));
            FileSecurity initialSecurity = new FileInfo(target).GetAccessControl();
            string initialAcl = initialSecurity.GetSecurityDescriptorSddlForm(AccessControlSections.Owner | AccessControlSections.Access);
            int valid = 0, missing = 0, writes = 0, reads = 0;
            var writer = Task.Run(async () => { for (int index = 1; index <= 256; index++) { await AtomicJsonFile.WriteAsync(target, new State(index)); Interlocked.Increment(ref writes); } });
            var readers = Enumerable.Range(0, 2).Select(_ => Task.Run(async () => {
                for (int index = 0; index < 128; index++) { var result = await AtomicJsonFile.ReadResultAsync<State>(target); Interlocked.Increment(ref reads); if (result.Kind == AtomicJsonReadKind.Missing) Interlocked.Increment(ref missing); if (result.Kind == AtomicJsonReadKind.Valid) Interlocked.Increment(ref valid); }
            })).ToArray();
            await Task.WhenAll(readers.Append(writer));
            FileSecurity finalSecurity = new FileInfo(target).GetAccessControl();
            atomicAclDiagnostics = new { initial = CaptureAcl(initialSecurity), final = CaptureAcl(finalSecurity), completedReplacementWrites = writes, completedReads = reads, validReads = valid, falseMissing = missing };
            Check(missing == 0 && valid == 256, "Nonproduction atomic read generation regressed.");
            Check((await AtomicJsonFile.ReadAsync<State>(target))?.Generation == 256, "Last durable value missing.");
            Check(finalSecurity.GetSecurityDescriptorSddlForm(AccessControlSections.Owner | AccessControlSections.Access) == initialAcl, "Nonproduction file ACL changed.");
            using var cancelled = new CancellationTokenSource(); cancelled.Cancel();
            try { await AtomicJsonFile.WriteAsync(target, new State(999), cancelled.Token); throw new Exception("Cancelled write executed."); } catch (OperationCanceledException) { }
            string once = Path.Combine(root, "once.json");
            Check(await AtomicJsonFile.TryCreateAsync(once, new State(1)), "Fresh create failed.");
            Check(!await AtomicJsonFile.TryCreateAsync(once, new State(2)) && (await AtomicJsonFile.ReadAsync<State>(once))?.Generation == 1, "Exclusive create overwrote state.");
            Check(!Directory.EnumerateFiles(root, "*.tmp").Any(), "Atomic temporary files remained.");
            return new { replaces = 256, validReads = valid, falseMissing = missing, cancellationPreserved = true, exclusiveCreatePreserved = true, nonproductionAclUnchanged = true };
        }, () => atomicAclDiagnostics);
        await Run("nonproduction-log-and-hardening", async () => {
            string root = Path.Combine(Work, "log"); Directory.CreateDirectory(root);
            var log = new ServiceLog(root);
            await log.InfoAsync("password=fixture-secret"); await log.WarnAsync("second-line");
            string path = Path.Combine(root, "service.log");
            string text = await File.ReadAllTextAsync(path);
            Check(!text.Contains("fixture-secret", StringComparison.Ordinal) && text.Contains("second-line", StringComparison.Ordinal), "Log append or redaction regressed.");
            string acl = new FileInfo(path).GetAccessControl().GetSecurityDescriptorSddlForm(AccessControlSections.Owner | AccessControlSections.Access);
            await File.WriteAllBytesAsync(path, new byte[5242881]); await log.InfoAsync("after-rotation");
            Check(File.Exists(path + ".1") && (await File.ReadAllTextAsync(path)).Contains("after-rotation", StringComparison.Ordinal), "Log rotation regressed.");
            Check(new FileInfo(path).GetAccessControl().GetSecurityDescriptorSddlForm(AccessControlSections.Owner | AccessControlSections.Access) == acl, "Nonproduction log ACL changed.");
            await ProtectedProductRoot.HardenAsync(root);
            Check(new FileInfo(path).GetAccessControl().GetSecurityDescriptorSddlForm(AccessControlSections.Owner | AccessControlSections.Access) == acl, "Nonproduction hardening changed an existing file ACL.");
            return new { appendPreserved = true, redactionPreserved = true, rotationPreserved = true, nonproductionAclUnchanged = true };
        });
        string resultPath = Path.Combine(Work, "results.json");
        string output = JsonSerializer.Serialize(new { schemaVersion = 1, actualSystem = identity.IsSystem, actualAdministrator = administrator, productionFilesystemWrites = 0, results = Results }, new JsonSerializerOptions { WriteIndented = true });
        await File.WriteAllTextAsync(resultPath, output);
        Console.WriteLine(output);
        return Results.All(value => JsonSerializer.SerializeToElement(value).GetProperty("passed").GetBoolean()) ? 0 : 1;
    }

    private sealed record State(int Generation);
    private static object CaptureAcl(FileSecurity security)
    {
        var descriptor = new RawSecurityDescriptor(security.GetSecurityDescriptorBinaryForm(), 0);
        return new {
            sddl = security.GetSecurityDescriptorSddlForm(AccessControlSections.Owner | AccessControlSections.Access),
            owner = security.GetOwner(typeof(SecurityIdentifier))?.Value,
            controlFlags = descriptor.ControlFlags.ToString(),
            controlFlagsMask = (int)descriptor.ControlFlags,
            protectedDacl = security.AreAccessRulesProtected,
            canonicalDacl = security.AreAccessRulesCanonical,
            rules = security.GetAccessRules(true, true, typeof(SecurityIdentifier)).Cast<FileSystemAccessRule>().Select(rule => new {
                sid = rule.IdentityReference.Value, rights = rule.FileSystemRights.ToString(), rightsMask = (int)rule.FileSystemRights,
                accessType = rule.AccessControlType.ToString(), inheritance = rule.InheritanceFlags.ToString(),
                propagation = rule.PropagationFlags.ToString(), inherited = rule.IsInherited
            }).ToArray()
        };
    }
    private static void Check(bool condition, string error) { if (!condition) throw new Exception(error); }
    private static void Reject(Action action) { try { action(); } catch (UnauthorizedAccessException) { return; } throw new Exception("Untrusted identity or ACL was accepted."); }
    private static async Task Run(string name, Func<Task<object>> action, Func<object?>? captureFailure = null)
    {
        try { Results.Add(new { name, passed = true, evidence = await action() }); }
        catch (Exception error) { Results.Add(new { name, passed = false, error = error.ToString(), diagnostics = captureFailure?.Invoke() }); }
    }
}
