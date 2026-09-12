using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

namespace EgoistShield.Service;

internal static class TrustedPath
{
	public static string AssertExistingFileUnderRoots(string candidate, params string[] allowedRoots)
	{
		string fullPath = Path.GetFullPath(candidate);
		string text = allowedRoots.Select(NormalizeRoot).FirstOrDefault((string root) => IsLexicallyUnder(fullPath, root));
		if (text == null)
		{
			throw new UnauthorizedAccessException("Path is outside the allowlisted trusted roots.");
		}
		AssertNoReparseComponents(fullPath, text, requireLeaf: true);
		if (!File.Exists(fullPath))
		{
			throw new FileNotFoundException("Trusted executable is missing.", fullPath);
		}
		return fullPath;
	}

	public static string AssertPathUnderRoot(string candidate, string root, bool requireLeaf)
	{
		string fullPath = Path.GetFullPath(candidate);
		string root2 = NormalizeRoot(root);
		if (!IsLexicallyUnder(fullPath, root2))
		{
			throw new UnauthorizedAccessException("Path escaped the allowlisted trusted root.");
		}
		AssertNoReparseComponents(fullPath, root2, requireLeaf);
		return fullPath;
	}

	public static void AssertTreeContainsNoReparsePoints(string root)
	{
		string fullPath = Path.GetFullPath(root);
		AssertNoReparseComponents(fullPath, Path.GetPathRoot(fullPath), requireLeaf: true);
		Queue<DirectoryInfo> queue = new Queue<DirectoryInfo>();
		queue.Enqueue(new DirectoryInfo(fullPath));
		EnumerationOptions enumerationOptions = new EnumerationOptions
		{
			RecurseSubdirectories = false,
			IgnoreInaccessible = false,
			AttributesToSkip = FileAttributes.None,
			ReturnSpecialDirectories = false
		};
		DirectoryInfo result;
		while (queue.TryDequeue(out result))
		{
			foreach (FileSystemInfo item2 in result.EnumerateFileSystemInfos("*", enumerationOptions))
			{
				item2.Refresh();
				if ((item2.Attributes & FileAttributes.ReparsePoint) != FileAttributes.None)
				{
					throw new UnauthorizedAccessException("Protected runtime contains a reparse point: " + item2.FullName);
				}
				if (item2 is DirectoryInfo item)
				{
					queue.Enqueue(item);
				}
			}
		}
	}

	private static void AssertNoReparseComponents(string candidate, string root, bool requireLeaf)
	{
		string text = NormalizeRoot(root);
		string fullPath = Path.GetFullPath(candidate);
		if (!IsLexicallyUnder(fullPath, text))
		{
			throw new UnauthorizedAccessException("Path escaped the allowlisted trusted root.");
		}
		string relativePath = Path.GetRelativePath(text, fullPath);
		List<string> list = ((relativePath == ".") ? new List<string>() : relativePath.Split(new char[2]
		{
			Path.DirectorySeparatorChar,
			Path.AltDirectorySeparatorChar
		}, StringSplitOptions.RemoveEmptyEntries).ToList());
		string text2 = text;
		AssertExistingComponentIsNotReparsePoint(text2);
		for (int i = 0; i < list.Count; i++)
		{
			text2 = Path.Combine(text2, list[i]);
			if (!File.Exists(text2) && !Directory.Exists(text2))
			{
				if (requireLeaf)
				{
					throw new FileNotFoundException("Trusted path component is missing.", text2);
				}
				break;
			}
			AssertExistingComponentIsNotReparsePoint(text2);
		}
	}

	private static void AssertExistingComponentIsNotReparsePoint(string path)
	{
		if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != FileAttributes.None)
		{
			throw new UnauthorizedAccessException("Trusted path contains a reparse point: " + path);
		}
	}

	private static string NormalizeRoot(string root)
	{
		string fullPath = Path.GetFullPath(root);
		string pathRoot = Path.GetPathRoot(fullPath);
		if (string.IsNullOrWhiteSpace(pathRoot) || !fullPath.Equals(pathRoot, StringComparison.OrdinalIgnoreCase))
		{
			return Path.TrimEndingDirectorySeparator(fullPath);
		}
		return pathRoot;
	}

	private static bool IsLexicallyUnder(string candidate, string root)
	{
		if (candidate.Equals(root, StringComparison.OrdinalIgnoreCase))
		{
			return true;
		}
		string value = (Path.EndsInDirectorySeparator(root) ? root : (root + Path.DirectorySeparatorChar));
		return candidate.StartsWith(value, StringComparison.OrdinalIgnoreCase);
	}
}
