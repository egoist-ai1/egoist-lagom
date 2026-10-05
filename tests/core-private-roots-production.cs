using System;
using System.IO;
using System.Linq;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text.Json;
using EgoistShield.Service;

namespace CorePrivateRootsProduction;
internal static class TestProgram
{
    private static readonly string[] PrivateRoots =
    { "Service", "installer", Path.Combine("Runtime", "Vpn"),
      Path.Combine("Runtime", "TelegramProxy"), Path.Combine("Runtime", "SystemDoH") };

    private static string? LastAssertionCode;
    private static object? PublicAncestorAclEvidence;

    public static int Main(string[] args)
    {
        // Filesystem-only test: owned fresh NTFS fixtures; no children or impersonation.
        string stage = "actual-token";
        LastAssertionCode = null;
        PublicAncestorAclEvidence = null;
        try
        {
            Require(OperatingSystem.IsWindows() && args.Length == 0, "Windows/no-argument fixture required");
            string binaryRoot = Path.GetFullPath(AppContext.BaseDirectory);
            Require(new DriveInfo(Path.GetPathRoot(binaryRoot)!).DriveFormat == "NTFS", "Real NTFS required");
            using var identity = WindowsIdentity.GetCurrent();
            Require(identity.IsSystem || new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator),
                "Actual enabled administrator or SYSTEM caller required");
            using var currentProcess = System.Diagnostics.Process.GetCurrentProcess();
            var token = GuiPrivilegePolicy.Read(currentProcess);
            Require(token.Allowed, "Actual elevated unrestricted High administrator token required");
            var descriptor = ProtectedProductRoot.CreateDirectoryAcl(true);
            var owner = (SecurityIdentifier)descriptor.GetOwner(typeof(SecurityIdentifier));
            string fixture = Path.Combine(binaryRoot, "private-roots-fixture-" + Guid.NewGuid().ToString("N"));
            Require(!Directory.Exists(fixture) && !File.Exists(fixture), "Fresh fixture required");
            TrustedPath.AssertPathUnderRoot(fixture, binaryRoot, requireLeaf: false);
            new DirectoryInfo(fixture).Create(descriptor);

            stage = "frozen-absence-skip-control";
            string control = CreatePublicLayout(fixture, "late-create-control", owner);
            ApplyFrozenAbsenceSkipControl(control, owner);
            Require(!Directory.Exists(Path.Combine(control, "Runtime", "TelegramProxy")),
                "Frozen skip control unexpectedly provisioned a missing private root");
            ApplyPublicAncestors(control, owner);
            string lateTelegram = Path.Combine(control, "Runtime", "TelegramProxy");
            Directory.CreateDirectory(lateTelegram);
            string lateFile = Path.Combine(lateTelegram, "config.json");
            File.WriteAllText(lateFile, "{\"fixture\":1}\n");
            Require(HasUnrelatedRead(lateFile), "Negative control must expose late inherited creation");

            stage = "first-private-root-creation";
            string fixedRoot = CreatePublicLayout(fixture, "production-helper", owner);
            // Match HardenAsync's native public-ancestor SetAccessControl path
            // before the baseline snapshot; preserve exact later SDDL checks.
            ApplyPublicAncestors(fixedRoot, owner);
            string initialPublicRoot = CaptureAcl(fixedRoot);
            string initialPublicRuntime = CaptureAcl(Path.Combine(fixedRoot, "Runtime"));
            string retainedSecret = Path.Combine(fixedRoot, "Service", "existing-secret.json");
            byte[] retainedBytes = System.Text.Encoding.UTF8.GetBytes("{\"fixture\":\"existing\"}\n");
            File.WriteAllBytes(retainedSecret, retainedBytes);
            AssertPrivateFile(retainedSecret);
            // Invoke the actual reviewed production helper, linked by the maintained runner.
            ProtectedProductRoot.PreparePrivateDirectories(fixedRoot, owner);
            AssertRoots(fixedRoot, owner);
            AssertPublicAncestorsUnchanged(fixedRoot, initialPublicRoot, initialPublicRuntime);
            Require(File.ReadAllBytes(retainedSecret).SequenceEqual(retainedBytes), "Existing secret bytes changed");
            AssertPrivateFile(retainedSecret);

            stage = "public-ancestor-reapplication";
            ApplyPublicAncestors(fixedRoot, owner);
            AssertRoots(fixedRoot, owner);
            AssertPublicAncestorsUnchanged(fixedRoot, initialPublicRoot, initialPublicRuntime);
            Require(File.ReadAllBytes(retainedSecret).SequenceEqual(retainedBytes), "Existing secret bytes changed");
            AssertPrivateFile(retainedSecret);

            stage = "ordinary-credential-writes";
            string telegram = Path.Combine(fixedRoot, "Runtime", "TelegramProxy");
            string config = Path.Combine(telegram, "config.json");
            File.WriteAllText(config, "{\"fixture\":1}\n");
            AssertPrivateFile(config);
            File.WriteAllText(config, "{\"fixture\":2}\n");
            AssertPrivateFile(config);
            string temporary = config + ".own.tmp";
            File.WriteAllText(temporary, "{\"fixture\":3}\n");
            AssertPrivateFile(temporary);
            File.Move(temporary, config, overwrite: true);
            AssertPrivateFile(config);
            string state = Path.Combine(telegram, "state.json");
            File.WriteAllText(state, "{\"fixture\":4}\n");
            AssertPrivateFile(state);
            byte[] finalConfigBytes = File.ReadAllBytes(config);

            stage = "missing-root-reinitialization";
            string vpn = Path.Combine(fixedRoot, "Runtime", "Vpn");
            Directory.Delete(vpn); // known empty owned leaf; no recursive deletion
            ProtectedProductRoot.PreparePrivateDirectories(fixedRoot, owner);
            AssertRoots(fixedRoot, owner);
            AssertPublicAncestorsUnchanged(fixedRoot, initialPublicRoot, initialPublicRuntime);
            AssertPrivateFile(config);
            Require(File.ReadAllBytes(config).SequenceEqual(finalConfigBytes), "Existing credential bytes changed");
            Require(File.ReadAllBytes(retainedSecret).SequenceEqual(retainedBytes), "Existing secret bytes changed");

            stage = "fail-closed-controls";
            string wrongKind = CreatePublicLayout(fixture, "wrong-kind-control", owner);
            string wrongKindLeaf = Path.Combine(wrongKind, "installer");
            File.WriteAllText(wrongKindLeaf, "owned-wrong-kind-fixture");
            RequireRefused(() => ProtectedProductRoot.PreparePrivateDirectories(wrongKind, owner),
                allowIoException: true);
            Require(File.ReadAllText(wrongKindLeaf) == "owned-wrong-kind-fixture" &&
                !Directory.Exists(Path.Combine(wrongKind, "Runtime", "TelegramProxy")),
                "Wrong-kind refusal modified the offending leaf or continued provisioning");
            string refusedOwner = CreatePublicLayout(fixture, "untrusted-owner-control", owner);
            RequireRefused(() => ProtectedProductRoot.PreparePrivateDirectories(refusedOwner,
                new SecurityIdentifier(WellKnownSidType.BuiltinUsersSid, null)));
            Require(!Directory.Exists(Path.Combine(refusedOwner, "installer")), "Untrusted owner created private roots");
            string outside = Path.GetFullPath(Path.Combine(fixture, "..", "outside-fixture-denied"));
            RequireRefused(() => TrustedPath.AssertPathUnderRoot(outside, fixture, requireLeaf: false));

            stage = "fixed-receipt";
            File.WriteAllText(Path.Combine(fixture, "results.json"), JsonSerializer.Serialize(new
            {
                schemaVersion = 1, success = true, scope = "isolated-real-ntfs-filesystem-only",
                actualCallerSystem = identity.IsSystem, selectedOwnerTrusted = true, actualToken = token,
                frozenAbsenceSkipControlExposed = true, privateRootCount = PrivateRoots.Length,
                rootsProtectedBeforeAncestorUpdate = true, rootsProtectedAfterAncestorUpdate = true,
                publicAncestorSddlUnchanged = true, existingSecretBytesRetained = true,
                publicAncestorAclEvidence = PublicAncestorAclEvidence,
                createPrivate = true, truncatePrivate = true, sameParentReplacementPrivate = true,
                reinitializeMissingRootPrivate = true, wrongKindRefused = true, escapedPathRefused = true,
                untrustedOwnerRefusedBeforeProvisioning = true,
                installedPathsUsed = false, serviceOrNetworkCommands = false
            }));
            Console.WriteLine("{\"success\":true,\"scope\":\"isolated-real-ntfs-filesystem-only\"}");
            return 0;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(JsonSerializer.Serialize(new
            { success = false, code = "PRIVATE_ROOT_FIXTURE_FAILED", stage, errorType = error.GetType().Name,
                assertionCode = LastAssertionCode, publicAncestorAclEvidence = PublicAncestorAclEvidence }));
            return 1;
        }
    }

    private static string CreatePublicLayout(string root, string name, SecurityIdentifier owner)
    {
        string product = Path.Combine(root, name);
        TrustedPath.AssertPathUnderRoot(product, root, requireLeaf: false);
        new DirectoryInfo(product).Create(ProtectedProductRoot.CreateDirectoryAclForOwner(false, owner));
        new DirectoryInfo(Path.Combine(product, "Runtime")).Create(ProtectedProductRoot.CreateDirectoryAclForOwner(false, owner));
        new DirectoryInfo(Path.Combine(product, "Service")).Create(ProtectedProductRoot.CreateDirectoryAclForOwner(true, owner));
        return product;
    }

    private static void ApplyFrozenAbsenceSkipControl(string root, SecurityIdentifier owner)
    {
        // Exact 3d26 HardenAsync absence-skip loop (baseline lines 64-69).
        // Baseline raw SHA256: 7D02237F021979AA943B16B2C8357E48D7824430AF147C7E2649876C0201A896.
        foreach (string relative in PrivateRoots)
        {
            string directory = Path.Combine(root, relative);
            if (!Directory.Exists(directory)) continue;
            new DirectoryInfo(directory).SetAccessControl(ProtectedProductRoot.CreateDirectoryAclForOwner(true, owner));
            ProtectedProductRoot.AssertAcl(new DirectoryInfo(directory).GetAccessControl(),
                privateData: true, isDirectory: true, requireProtected: true, owner);
        }
    }

    private static void ApplyPublicAncestors(string root, SecurityIdentifier owner)
    {
        new DirectoryInfo(root).SetAccessControl(ProtectedProductRoot.CreateDirectoryAclForOwner(false, owner));
        new DirectoryInfo(Path.Combine(root, "Runtime")).SetAccessControl(
            ProtectedProductRoot.CreateDirectoryAclForOwner(false, owner));
    }

    private static string CaptureAcl(string path) => new DirectoryInfo(path).GetAccessControl()
        .GetSecurityDescriptorSddlForm(AccessControlSections.Owner | AccessControlSections.Access);

    private static void AssertPublicAncestorsUnchanged(string root, string rootSddl, string runtimeSddl)
    {
        string afterRoot = CaptureAcl(root);
        string afterRuntime = CaptureAcl(Path.Combine(root, "Runtime"));
        // Owned fixture metadata only; no credentials, environment or paths.
        PublicAncestorAclEvidence = new {
            rootBefore = BoundedAclMetadata(rootSddl), rootAfter = BoundedAclMetadata(afterRoot),
            runtimeBefore = BoundedAclMetadata(runtimeSddl), runtimeAfter = BoundedAclMetadata(afterRuntime),
            rootExactlyEqual = afterRoot == rootSddl, runtimeExactlyEqual = afterRuntime == runtimeSddl
        };
        Require(afterRoot == rootSddl && afterRuntime == runtimeSddl,
            "Public ancestor owner/DACL SDDL changed");
    }

    private static string BoundedAclMetadata(string value)
        => value.Length <= 1024 ? value : "[ACL metadata exceeds 1024 characters]";

    private static void AssertRoots(string root, SecurityIdentifier owner)
    {
        foreach (string relative in PrivateRoots)
        {
            string path = Path.Combine(root, relative);
            TrustedPath.AssertPathUnderRoot(path, root, requireLeaf: true);
            Require(Directory.Exists(path), "Declared private root must exist");
            ProtectedProductRoot.AssertAcl(new DirectoryInfo(path).GetAccessControl(),
                privateData: true, isDirectory: true, requireProtected: true, owner);
        }
    }

    private static bool HasUnrelatedRead(string path)
    {
        using var held = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        return held.GetAccessControl().GetAccessRules(true, true, typeof(SecurityIdentifier))
            .Cast<FileSystemAccessRule>().Any(rule =>
                rule.AccessControlType == AccessControlType.Allow &&
                (rule.PropagationFlags & PropagationFlags.InheritOnly) == 0 &&
                (rule.FileSystemRights & FileSystemRights.ReadData) != 0 &&
                !((SecurityIdentifier)rule.IdentityReference).IsWellKnown(WellKnownSidType.LocalSystemSid) &&
                !((SecurityIdentifier)rule.IdentityReference).IsWellKnown(WellKnownSidType.BuiltinAdministratorsSid));
    }

    private static void AssertPrivateFile(string path)
    {
        using var held = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        ProtectedProductRoot.AssertAcl(held.GetAccessControl(),
            privateData: true, isDirectory: false, requireProtected: false);
    }

    private static void RequireRefused(Action action, bool allowIoException = false)
    {
        try { action(); }
        catch (UnauthorizedAccessException) { return; }
        catch (IOException) when (allowIoException) { return; }
        throw new InvalidOperationException("A guarded negative control was accepted");
    }

    private static void Require(bool value, string code)
    { if (!value) { LastAssertionCode = code; throw new InvalidOperationException(code); } }
}