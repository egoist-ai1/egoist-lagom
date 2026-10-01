using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Threading;
using System.Threading.Tasks;

namespace EgoistShield.Service;

internal static class ProtectedProductRoot
{
	private const string RetiredRegistrationBackupPrefix = "registration-backup.discarded-";

	private static readonly string[] ManagedSubdirectories = new string[3] { "Service", "Runtime", "GravitylessDNS" };

	private const string HardeningMarkerFileName = "acl-hardening.marker";

	private const string HardeningMarkerVersion = "3";

	public static string Resolve(string stateRoot)
	{
		string text = Path.TrimEndingDirectorySeparator(Path.GetFullPath(stateRoot));
		string productionStateRoot = GetProductionStateRoot();
		if (!text.Equals(productionStateRoot, StringComparison.OrdinalIgnoreCase))
		{
			return text;
		}
		return Directory.GetParent(productionStateRoot).FullName;
	}

	public static bool IsProductionShape(string stateRoot)
	{
		return Path.TrimEndingDirectorySeparator(Path.GetFullPath(stateRoot)).Equals(GetProductionStateRoot(), StringComparison.OrdinalIgnoreCase);
	}

	public static async Task HardenAsync(string stateRoot, CancellationToken cancellationToken = default(CancellationToken))
	{
		string productRoot = Resolve(stateRoot);
		bool flag = IsProductionShape(stateRoot);
		string root = (flag ? GetCommonApplicationDataRoot() : (Path.GetPathRoot(productRoot) ?? throw new InvalidOperationException("Protected product root has no volume root.")));
		TrustedPath.AssertPathUnderRoot(productRoot, root, Directory.Exists(productRoot));
		Directory.CreateDirectory(productRoot);
		string[] managedSubdirectories = ManagedSubdirectories;
		foreach (string path in managedSubdirectories)
		{
			Directory.CreateDirectory(Path.Combine(productRoot, path));
		}
		if (OperatingSystem.IsWindows() && flag)
		{
			string markerPath = Path.Combine(productRoot, "Service", "acl-hardening.marker");
			bool needsDeepPass = !HardeningMarkerIsCurrent(markerPath);
			TrustedPath.AssertTreeContainsNoReparsePoints(productRoot);
			// Protect secret roots before touching public ancestor inheritance. No
			// recursive ACL reset may briefly expose existing connection credentials.
			foreach (string relative in PrivateDirectories)
			{
				string directory = Path.Combine(productRoot, relative);
				if (!Directory.Exists(directory)) continue;
				ApplyDirectoryAcl(directory, privateData: true);
			}
			ApplyDirectoryAcl(productRoot, privateData: false);
			foreach (string directory in ManagedSubdirectories.Select(name => Path.Combine(productRoot, name)))
				ApplyDirectoryAcl(directory, IsPrivatePath(directory, productRoot));
			if (needsDeepPass)
			{
				foreach (string candidate in Directory.EnumerateFileSystemEntries(productRoot, "*", SearchOption.AllDirectories).OrderBy(value => value.Length))
				{
					cancellationToken.ThrowIfCancellationRequested();
					TrustedPath.AssertPathUnderRoot(candidate, productRoot, requireLeaf: true);
					bool privateData = IsPrivatePath(candidate, productRoot);
					if (Directory.Exists(candidate)) ApplyDirectoryAcl(candidate, privateData);
					else new FileInfo(candidate).SetAccessControl(CreateFileAcl(privateData));
				}
			}
			foreach (string relative in PrivateDirectories)
			{
				string directory = Path.Combine(productRoot, relative);
				if (!Directory.Exists(directory)) continue;
				AssertPrivateAcl(directory);
				foreach (string candidate in Directory.EnumerateFileSystemEntries(directory, "*", SearchOption.AllDirectories)) AssertPrivateAcl(candidate);
			}
			TrustedPath.AssertTreeContainsNoReparsePoints(productRoot);
			if (needsDeepPass) WriteHardeningMarker(markerPath);
		}
		await Task.CompletedTask;
	}

	private static readonly string[] PrivateDirectories = { "Service", "installer", Path.Combine("Runtime", "Vpn"), Path.Combine("Runtime", "TelegramProxy"), Path.Combine("Runtime", "SystemDoH") };
	internal static bool IsPrivatePath(string candidate, string productRoot)
	{
		string normalized = Path.GetFullPath(candidate);
		return PrivateDirectories.Any(relative => { string root = Path.GetFullPath(Path.Combine(productRoot, relative)); return normalized.Equals(root, StringComparison.OrdinalIgnoreCase) || normalized.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase); });
	}
	internal static DirectorySecurity CreateDirectoryAcl(bool privateData)
	{
		var security = new DirectorySecurity();
		security.SetAccessRuleProtection(isProtected: true, preserveInheritance: false);
		security.SetOwner(new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null));
		foreach (WellKnownSidType type in new[] { WellKnownSidType.LocalSystemSid, WellKnownSidType.BuiltinAdministratorsSid })
			security.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(type, null), FileSystemRights.FullControl, InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow));
		if (!privateData) security.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(WellKnownSidType.BuiltinUsersSid, null), FileSystemRights.ReadAndExecute, InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow));
		return security;
	}
	internal static FileSecurity CreateFileAcl(bool privateData)
	{
		var security = new FileSecurity();
		security.SetAccessRuleProtection(isProtected: true, preserveInheritance: false);
		security.SetOwner(new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null));
		foreach (WellKnownSidType type in new[] { WellKnownSidType.LocalSystemSid, WellKnownSidType.BuiltinAdministratorsSid })
			security.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(type, null), FileSystemRights.FullControl, AccessControlType.Allow));
		if (!privateData) security.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(WellKnownSidType.BuiltinUsersSid, null), FileSystemRights.ReadAndExecute, AccessControlType.Allow));
		return security;
	}
	private static void ApplyDirectoryAcl(string directory, bool privateData) => new DirectoryInfo(directory).SetAccessControl(CreateDirectoryAcl(privateData));
	private static void AssertPrivateAcl(string candidate)
	{
		FileSystemSecurity security = Directory.Exists(candidate) ? new DirectoryInfo(candidate).GetAccessControl() : new FileInfo(candidate).GetAccessControl();
		bool Trusted(SecurityIdentifier sid) => sid.IsWellKnown(WellKnownSidType.LocalSystemSid) || sid.IsWellKnown(WellKnownSidType.BuiltinAdministratorsSid);
		if (security.GetOwner(typeof(SecurityIdentifier)) is not SecurityIdentifier owner || !Trusted(owner)) throw new UnauthorizedAccessException("Private service state has an untrusted owner.");
		foreach (FileSystemAccessRule rule in security.GetAccessRules(true, true, typeof(SecurityIdentifier)))
			if (rule.AccessControlType == AccessControlType.Allow && !Trusted((SecurityIdentifier)rule.IdentityReference)) throw new UnauthorizedAccessException("Private service state exposes access outside SYSTEM and Administrators.");
	}

	public static int CleanupDeferredInstallerBackups(string stateRoot)
	{
		if (!OperatingSystem.IsWindows() || !IsProductionShape(stateRoot))
		{
			return 0;
		}
		string text = Path.Combine(Resolve(stateRoot), "installer");
		if (!Directory.Exists(text))
		{
			return 0;
		}
		TrustedPath.AssertPathUnderRoot(text, Resolve(stateRoot), requireLeaf: true);
		int num = 0;
		foreach (string item in Directory.EnumerateDirectories(text, "registration-backup.discarded-*", SearchOption.TopDirectoryOnly))
		{
			string text2 = Path.GetFileName(item).Substring("registration-backup.discarded-".Length);
			if (text2.Length == 32 && !text2.Any((char character) => !Uri.IsHexDigit(character)))
			{
				TrustedPath.AssertPathUnderRoot(item, text, requireLeaf: true);
				TrustedPath.AssertTreeContainsNoReparsePoints(item);
				Directory.Delete(item, recursive: true);
				num++;
			}
		}
		return num;
	}

	private static bool HardeningMarkerIsCurrent(string markerPath)
	{
		try
		{
			if (!File.Exists(markerPath) || (File.GetAttributes(markerPath) & FileAttributes.ReparsePoint) != FileAttributes.None || File.ReadAllText(markerPath).Trim() != HardeningMarkerVersion)
			{
				return false;
			}
			return new FileInfo(markerPath).GetAccessControl(AccessControlSections.Owner).GetOwner(typeof(SecurityIdentifier)) is SecurityIdentifier securityIdentifier && (securityIdentifier.IsWellKnown(WellKnownSidType.LocalSystemSid) || securityIdentifier.IsWellKnown(WellKnownSidType.BuiltinAdministratorsSid));
		}
		catch
		{
			return false;
		}
	}

	private static void WriteHardeningMarker(string markerPath)
	{
		try
		{
			Directory.CreateDirectory(Path.GetDirectoryName(markerPath));
			File.WriteAllText(markerPath, HardeningMarkerVersion + Environment.NewLine);
		}
		catch
		{
		}
	}

	private static string GetProductionStateRoot()
	{
		return Path.TrimEndingDirectorySeparator(Path.GetFullPath(Path.Combine(GetCommonApplicationDataRoot(), "EgoistShield", "Service")));
	}

	private static string GetCommonApplicationDataRoot()
	{
		string folderPath = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);
		if (string.IsNullOrWhiteSpace(folderPath))
		{
			throw new InvalidOperationException("Windows CommonApplicationData path is unavailable.");
		}
		return Path.TrimEndingDirectorySeparator(Path.GetFullPath(folderPath));
	}

	private static async Task RunIcaclsAsync(string icaclsPath, string[] arguments, string action, CancellationToken cancellationToken)
	{
		ProcessResult processResult = await ProcessRunner.RunAsync(icaclsPath, arguments, ServiceContract.CommandTimeout, cancellationToken);
		if (processResult.ExitCode == 0)
		{
			return;
		}
		string text = (string.IsNullOrWhiteSpace(processResult.StandardError) ? processResult.StandardOutput : processResult.StandardError);
		throw new InvalidOperationException("Failed to " + action + ": " + text.ReplaceLineEndings(" ").Trim());
	}
}
