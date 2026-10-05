using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.ComponentModel;
using System.Runtime.InteropServices;
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

	private const string HardeningMarkerVersion = "4";

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
		SecurityIdentifier? owner = OperatingSystem.IsWindows() && flag ? ResolveActorOwner() : null;
		cancellationToken.ThrowIfCancellationRequested();
		string root = (flag ? GetCommonApplicationDataRoot() : (Path.GetPathRoot(productRoot) ?? throw new InvalidOperationException("Protected product root has no volume root.")));
		TrustedPath.AssertPathUnderRoot(productRoot, root, Directory.Exists(productRoot));
		Directory.CreateDirectory(productRoot);
		if (owner is not null) TrustedPath.AssertTreeContainsNoReparsePoints(productRoot);
		string[] managedSubdirectories = ManagedSubdirectories;
		foreach (string path in managedSubdirectories)
		{
			string directory = Path.Combine(productRoot, path);
			if (owner is not null) TrustedPath.AssertPathUnderRoot(directory, productRoot, Directory.Exists(directory));
			Directory.CreateDirectory(directory);
		}
		if (OperatingSystem.IsWindows() && flag)
		{
			string markerPath = Path.Combine(productRoot, "Service", HardeningMarkerFileName);
			TrustedPath.AssertTreeContainsNoReparsePoints(productRoot);
			bool needsDeepPass = !HardeningMarkerIsCurrent(markerPath);
			// Protect secret roots before touching public ancestor inheritance. No
			// recursive ACL reset may briefly expose existing connection credentials.
			PreparePrivateDirectories(productRoot, owner!, cancellationToken);

			ApplyDirectoryAcl(productRoot, privateData: false, owner!);
			foreach (string directory in ManagedSubdirectories.Select(name => Path.Combine(productRoot, name)))
				ApplyDirectoryAcl(directory, IsPrivatePath(directory, productRoot), owner!);
			if (needsDeepPass)
			{
				foreach (string candidate in Directory.EnumerateFileSystemEntries(productRoot, "*", SearchOption.AllDirectories).OrderBy(value => value.Length))
				{
					cancellationToken.ThrowIfCancellationRequested();
					TrustedPath.AssertPathUnderRoot(candidate, productRoot, requireLeaf: true);
					bool privateData = IsPrivatePath(candidate, productRoot);
					if (Directory.Exists(candidate)) ApplyDirectoryAcl(candidate, privateData, owner!);
					else ApplyFileAcl(candidate, privateData, owner!);
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
	// Provision secret roots even on a current-marker startup, before a worker
	// can create credentials under a publicly readable Runtime parent.
	internal static void PreparePrivateDirectories(string productRoot, SecurityIdentifier owner,
		CancellationToken cancellationToken = default)
	{
		AssertTrustedOwner(owner);
		foreach (string relative in PrivateDirectories)
		{
			cancellationToken.ThrowIfCancellationRequested();
			string directory = Path.Combine(productRoot, relative);
			TrustedPath.AssertPathUnderRoot(directory, productRoot, Directory.Exists(directory));
			if (!Directory.Exists(directory))
				new DirectoryInfo(directory).Create(CreateDirectoryAclForOwner(privateData: true, owner));
			TrustedPath.AssertPathUnderRoot(directory, productRoot, requireLeaf: true);
			ApplyDirectoryAcl(directory, privateData: true, owner);
		}
	}
	internal static bool IsPrivatePath(string candidate, string productRoot)
	{
		string normalized = Path.GetFullPath(candidate);
		return PrivateDirectories.Any(relative => { string root = Path.GetFullPath(Path.Combine(productRoot, relative)); return normalized.Equals(root, StringComparison.OrdinalIgnoreCase) || normalized.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase); });
	}
	internal static DirectorySecurity CreateDirectoryAcl(bool privateData)
		=> CreateDirectoryAclForOwner(privateData, ResolveActorOwner());

	internal static DirectorySecurity CreateDirectoryAclForOwner(bool privateData, SecurityIdentifier owner)
	{
		AssertTrustedOwner(owner);
		var security = new DirectorySecurity();
		security.SetAccessRuleProtection(isProtected: true, preserveInheritance: false);
		security.SetOwner(owner);
		foreach (WellKnownSidType type in new[] { WellKnownSidType.LocalSystemSid, WellKnownSidType.BuiltinAdministratorsSid })
			security.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(type, null), FileSystemRights.FullControl, InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow));
		if (!privateData) security.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(WellKnownSidType.BuiltinUsersSid, null), FileSystemRights.ReadAndExecute, InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow));
		return security;
	}
	internal static FileSecurity CreateFileAcl(bool privateData)
		=> CreateFileAclForOwner(privateData, ResolveActorOwner());

	internal static FileSecurity CreateFileAclForOwner(bool privateData, SecurityIdentifier owner)
	{
		AssertTrustedOwner(owner);
		var security = new FileSecurity();
		security.SetAccessRuleProtection(isProtected: true, preserveInheritance: false);
		security.SetOwner(owner);
		foreach (WellKnownSidType type in new[] { WellKnownSidType.LocalSystemSid, WellKnownSidType.BuiltinAdministratorsSid })
			security.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(type, null), FileSystemRights.FullControl, AccessControlType.Allow));
		if (!privateData) security.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(WellKnownSidType.BuiltinUsersSid, null), FileSystemRights.ReadAndExecute, AccessControlType.Allow));
		return security;
	}
	internal static SecurityIdentifier SelectAclOwner(SecurityIdentifier? actorSid, bool isAdministrator)
	{
		if (actorSid is null) throw new UnauthorizedAccessException("The ACL actor has no Windows identity.");
		if (actorSid.IsWellKnown(WellKnownSidType.LocalSystemSid)) return actorSid;
		if (isAdministrator) return new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null);
		throw new UnauthorizedAccessException("Production ACL changes require SYSTEM or an enabled Administrators token.");
	}

	private static SecurityIdentifier ResolveActorOwner()
	{
		if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException("Production ACLs require Windows.");
		using var identity = WindowsIdentity.GetCurrent();
		if (identity.User?.IsWellKnown(WellKnownSidType.LocalSystemSid) == true) return identity.User;
		bool administrator = new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator);
		return SelectAclOwner(identity.User, administrator && AdministratorsCanOwn(identity));
	}

	[StructLayout(LayoutKind.Sequential)]
	private struct SidAndAttributes { public IntPtr Sid; public uint Attributes; }

	[StructLayout(LayoutKind.Sequential)]
	private struct TokenGroups { public uint Count; public SidAndAttributes First; }

	[DllImport("advapi32.dll", SetLastError = true)]
	[return: MarshalAs(UnmanagedType.Bool)]
	private static extern bool GetTokenInformation(Microsoft.Win32.SafeHandles.SafeAccessTokenHandle token,
		int informationClass, IntPtr information, int informationLength, out int returnLength);

	private static bool AdministratorsCanOwn(WindowsIdentity identity)
	{
		const int groupsClass = 2, insufficientBuffer = 122;
		const uint enabled = 0x04, owner = 0x08, denyOnly = 0x10;
		if (GetTokenInformation(identity.AccessToken, groupsClass, IntPtr.Zero, 0, out int length) ||
			Marshal.GetLastWin32Error() != insufficientBuffer || length < Marshal.SizeOf<TokenGroups>() || length > 1024 * 1024)
			throw new UnauthorizedAccessException("Cannot verify the Administrators owner token.", new Win32Exception(Marshal.GetLastWin32Error()));
		IntPtr buffer = Marshal.AllocHGlobal(length);
		try
		{
			if (!GetTokenInformation(identity.AccessToken, groupsClass, buffer, length, out int returned) || returned > length)
				throw new UnauthorizedAccessException("Cannot read the Administrators owner token.", new Win32Exception(Marshal.GetLastWin32Error()));
			int offset = Marshal.OffsetOf<TokenGroups>(nameof(TokenGroups.First)).ToInt32();
			int size = Marshal.SizeOf<SidAndAttributes>();
			uint count = unchecked((uint)Marshal.ReadInt32(buffer));
			if (returned < offset || count > (returned - offset) / size) throw new UnauthorizedAccessException("Invalid Windows token group data.");
			for (int index = 0; index < count; index++)
			{
				var group = Marshal.PtrToStructure<SidAndAttributes>(IntPtr.Add(buffer, offset + index * size));
				if (new SecurityIdentifier(group.Sid).IsWellKnown(WellKnownSidType.BuiltinAdministratorsSid))
					return (group.Attributes & (enabled | owner)) == (enabled | owner) && (group.Attributes & denyOnly) == 0;
			}
			return false;
		}
		finally { Marshal.FreeHGlobal(buffer); }
	}

	private static void AssertTrustedOwner(SecurityIdentifier owner)
	{
		if (owner is null || (!owner.IsWellKnown(WellKnownSidType.LocalSystemSid) && !owner.IsWellKnown(WellKnownSidType.BuiltinAdministratorsSid)))
			throw new UnauthorizedAccessException("Protected product state requires a SYSTEM or Administrators owner.");
	}

	private static void ApplyDirectoryAcl(string directory, bool privateData, SecurityIdentifier owner)
	{
		new DirectoryInfo(directory).SetAccessControl(CreateDirectoryAclForOwner(privateData, owner));
		AssertAcl(new DirectoryInfo(directory).GetAccessControl(), privateData, isDirectory: true, requireProtected: true, owner);
	}

	private static void ApplyFileAcl(string file, bool privateData, SecurityIdentifier owner)
	{
		new FileInfo(file).SetAccessControl(CreateFileAclForOwner(privateData, owner));
		AssertAcl(new FileInfo(file).GetAccessControl(), privateData, isDirectory: false, requireProtected: true, owner);
	}

	internal static void AssertFileWriteAllowed(string filePath)
	{
		if (ProductionFileOwner(filePath, out string fullPath, out string productRoot, out _) is not null)
			TrustedPath.AssertPathUnderRoot(fullPath, productRoot, File.Exists(fullPath));
	}

	internal static FileStream CreateStateFileStream(string filePath, FileMode mode, int bufferSize, FileOptions options, FileShare share = FileShare.None)
	{
		SecurityIdentifier? owner = ProductionFileOwner(filePath, out string fullPath, out string productRoot, out bool privateData);
		if (owner is null) return new FileStream(filePath, mode, FileAccess.Write, share, bufferSize, options);
		TrustedPath.AssertPathUnderRoot(fullPath, productRoot, File.Exists(fullPath));
		string parent = Path.GetDirectoryName(fullPath)!;
		AssertAcl(new DirectoryInfo(parent).GetAccessControl(), IsPrivatePath(parent, productRoot), isDirectory: true, requireProtected: false);
		bool existed = File.Exists(fullPath);
		if (existed) AssertCreatedFileIsProtected(fullPath);
		FileMode createMode = mode == FileMode.Append ? FileMode.OpenOrCreate : mode;
		FileStream stream = new FileInfo(fullPath).Create(createMode, FileSystemRights.Write | FileSystemRights.ReadPermissions,
			share, bufferSize, options, CreateFileAclForOwner(privateData, owner));
		try
		{
			AssertAcl(stream.GetAccessControl(), privateData, isDirectory: false, requireProtected: !existed, existed ? null : owner);
			if (mode == FileMode.Append) stream.Seek(0, SeekOrigin.End);
			return stream;
		}
		catch { stream.Dispose(); throw; }
	}

	internal static void AssertCreatedFileIsProtected(string filePath)
	{
		if (ProductionFileOwner(filePath, out string fullPath, out string productRoot, out bool privateData) is null) return;
		TrustedPath.AssertPathUnderRoot(fullPath, productRoot, requireLeaf: true);
		AssertAcl(new FileInfo(fullPath).GetAccessControl(), privateData, isDirectory: false, requireProtected: false);
	}

	private static SecurityIdentifier? ProductionFileOwner(string filePath, out string fullPath, out string productRoot, out bool privateData)
	{
		fullPath = Path.GetFullPath(filePath);
		productRoot = string.Empty;
		privateData = false;
		if (!OperatingSystem.IsWindows()) return null;
		productRoot = Directory.GetParent(GetProductionStateRoot())!.FullName;
		if (!fullPath.Equals(productRoot, StringComparison.OrdinalIgnoreCase) && !fullPath.StartsWith(productRoot + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) return null;
		privateData = IsPrivatePath(fullPath, productRoot);
		return ResolveActorOwner();
	}

	private static void AssertPrivateAcl(string candidate)
	{
		FileSystemSecurity security = Directory.Exists(candidate) ? new DirectoryInfo(candidate).GetAccessControl() : new FileInfo(candidate).GetAccessControl();
		AssertAcl(security, privateData: true, isDirectory: Directory.Exists(candidate), requireProtected: false);
	}

	internal static void AssertAcl(FileSystemSecurity security, bool privateData, bool isDirectory, bool requireProtected, SecurityIdentifier? expectedOwner = null)
	{
		if (security.GetOwner(typeof(SecurityIdentifier)) is not SecurityIdentifier owner)
			throw new UnauthorizedAccessException("Protected product state has no owner.");
		AssertTrustedOwner(owner);
		if (expectedOwner is not null && !owner.Equals(expectedOwner)) throw new UnauthorizedAccessException("Protected product owner readback differs from the selected actor owner.");
		if (requireProtected && !security.AreAccessRulesProtected) throw new UnauthorizedAccessException("Protected product ACL inheritance is not sealed.");
		var rules = security.GetAccessRules(true, true, typeof(SecurityIdentifier)).Cast<FileSystemAccessRule>().ToArray();
		if (rules.Length != (privateData ? 2 : 3)) throw new UnauthorizedAccessException("Protected product ACL does not match the fixed allowlist.");
		var observed = new HashSet<string>(StringComparer.Ordinal);
		foreach (FileSystemAccessRule rule in rules)
		{
			var sid = (SecurityIdentifier)rule.IdentityReference;
			bool trusted = sid.IsWellKnown(WellKnownSidType.LocalSystemSid) || sid.IsWellKnown(WellKnownSidType.BuiltinAdministratorsSid);
			if ((!trusted && (privateData || !sid.IsWellKnown(WellKnownSidType.BuiltinUsersSid))) || rule.AccessControlType != AccessControlType.Allow || !observed.Add(sid.Value))
				throw new UnauthorizedAccessException("Protected product ACL contains an unexpected principal or rule.");
			InheritanceFlags inheritance = isDirectory ? InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit : InheritanceFlags.None;
			var expected = new FileSystemAccessRule(sid, trusted ? FileSystemRights.FullControl : FileSystemRights.ReadAndExecute, inheritance, PropagationFlags.None, AccessControlType.Allow);
			if (rule.FileSystemRights != expected.FileSystemRights || rule.InheritanceFlags != inheritance || rule.PropagationFlags != PropagationFlags.None)
				throw new UnauthorizedAccessException("Protected product ACL permissions differ from the fixed contract.");
		}
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
			if (!File.Exists(markerPath) || (File.GetAttributes(markerPath) & FileAttributes.ReparsePoint) != FileAttributes.None)
			{
				return false;
			}
			using var stream = new FileStream(markerPath, FileMode.Open, FileAccess.Read, FileShare.Read, 32, FileOptions.SequentialScan);
			if (stream.Length > 32) return false;
			AssertAcl(stream.GetAccessControl(), privateData: true, isDirectory: false, requireProtected: true);
			using var reader = new StreamReader(stream, System.Text.Encoding.UTF8);
			return reader.ReadToEnd().Trim() == HardeningMarkerVersion;
		}
		catch
		{
			return false;
		}
	}

	private static void WriteHardeningMarker(string markerPath)
	{
		string tempPath = $"{markerPath}.{Environment.ProcessId}.{Guid.NewGuid():N}.tmp";
		try
		{
			using (FileStream stream = CreateStateFileStream(tempPath, FileMode.CreateNew, 4096, FileOptions.WriteThrough))
			{
				byte[] value = System.Text.Encoding.UTF8.GetBytes(HardeningMarkerVersion + Environment.NewLine);
				stream.Write(value);
				stream.Flush(flushToDisk: true);
			}
			File.Move(tempPath, markerPath, overwrite: true);
			AssertCreatedFileIsProtected(markerPath);
		}
		finally
		{
			try { if (File.Exists(tempPath)) File.Delete(tempPath); }
			catch (Exception error) when (error is IOException or UnauthorizedAccessException) { }
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

}
