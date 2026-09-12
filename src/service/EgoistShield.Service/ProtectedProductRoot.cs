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

	private const string HardeningMarkerVersion = "2";

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
			string icaclsPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "icacls.exe");
			string markerPath = Path.Combine(productRoot, "Service", "acl-hardening.marker");
			bool needsDeepPass = !HardeningMarkerIsCurrent(markerPath);
			string[] collection = ((!needsDeepPass) ? new string[3] { "/l", "/c", "/q" } : new string[4] { "/t", "/l", "/c", "/q" });
			if (needsDeepPass)
			{
				TrustedPath.AssertTreeContainsNoReparsePoints(productRoot);
			}
			List<string> list = new List<string>();
			list.Add(productRoot);
			list.Add("/setowner");
			list.Add("*S-1-5-18");
			list.AddRange(collection);
			await RunIcaclsAsync(icaclsPath, list.ToArray(), "take ownership of the ProgramData runtime root", cancellationToken);
			if (needsDeepPass)
			{
				await RunIcaclsAsync(icaclsPath, new string[6] { productRoot, "/reset", "/t", "/l", "/c", "/q" }, "reset pre-existing explicit ProgramData ACL entries", cancellationToken);
			}
			await RunIcaclsAsync(icaclsPath, new string[9] { productRoot, "/inheritance:r", "/grant:r", "*S-1-5-18:(OI)(CI)F", "*S-1-5-32-544:(OI)(CI)F", "*S-1-5-32-545:(OI)(CI)RX", "/l", "/c", "/q" }, "protect the ProgramData runtime ACL", cancellationToken);
			if (needsDeepPass)
			{
				await RunIcaclsAsync(icaclsPath, new string[6]
				{
					Path.Combine(productRoot, "*"),
					"/reset",
					"/t",
					"/l",
					"/c",
					"/q"
				}, "inherit the protected ProgramData ACL on existing descendants", cancellationToken);
				TrustedPath.AssertTreeContainsNoReparsePoints(productRoot);
				WriteHardeningMarker(markerPath);
			}
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
			if (!File.Exists(markerPath) || (File.GetAttributes(markerPath) & FileAttributes.ReparsePoint) != FileAttributes.None || File.ReadAllText(markerPath).Trim() != "2")
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
			File.WriteAllText(markerPath, "2" + Environment.NewLine);
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
