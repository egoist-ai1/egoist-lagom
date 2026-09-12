using System.Buffers;
using System.CodeDom.Compiler;
using System.Globalization;
using System.Runtime.CompilerServices;

namespace System.Text.RegularExpressions.Generated;

[GeneratedCode("System.Text.RegularExpressions.Generator", "10.0.14.27113")]
internal static class _003CRegexGenerator_g_003EF6D74187046B00D172B4F885B621DE58A29247487BEEF7874C300C5ED3831944D__Utilities
{
	internal static readonly TimeSpan s_defaultTimeout = ((AppContext.GetData("REGEX_DEFAULT_MATCH_TIMEOUT") is TimeSpan timeSpan) ? timeSpan : Regex.InfiniteMatchTimeout);

	internal static readonly bool s_hasTimeout = s_defaultTimeout != Regex.InfiniteMatchTimeout;

	private const int WordCategoriesMask = 262463;

	internal static readonly SearchValues<char> s_ascii_FFC1FFFFFEFFFFFFDFFFFFFFDFFFFFFF = SearchValues.Create("\0\u0001\u0002\u0003\u0004\u0005\u0006\a\b\u000e\u000f\u0010\u0011\u0012\u0013\u0014\u0015\u0016\u0017\u0018\u0019\u001a\u001b\u001c\u001d\u001e\u001f!\"#$%&'()*+,-./0123456789:;<=>?@ABCDFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdfghijklmnopqrstuvwxyz{|}~\u007f".AsSpan());

	internal static readonly SearchValues<string> s_indexOfAnyStrings_OrdinalIgnoreCase_5A4D9B017D3E6477E32C9603AB4180D9672961E82A4AB9ED0C76157EDE808508;

	internal static readonly SearchValues<string> s_indexOfAnyStrings_OrdinalIgnoreCase_D1EE3441A797B452C5194EE6FD8A180038497E9D7B4CE00ADE7A0A188B1710FF;

	private static ReadOnlySpan<byte> WordCharBitmap => new byte[16]
	{
		0, 0, 0, 0, 0, 0, 255, 3, 254, 255,
		255, 135, 254, 255, 255, 7
	};

	[MethodImpl(MethodImplOptions.AggressiveInlining)]
	internal static int IndexOfNonAsciiOrAny_FA1508E26373F1EEE419399B9DF589F48E0DB3D5A71CE228D174BB2C6297B839(this ReadOnlySpan<char> span)
	{
		int num = span.IndexOfAnyExcept(s_ascii_FFC1FFFFFEFFFFFFDFFFFFFFDFFFFFFF);
		if ((uint)num < (uint)span.Length)
		{
			if (char.IsAscii(span[num]))
			{
				return num;
			}
			do
			{
				char c;
				if (((c = span[num]) < '\u0080') ? ((byte)("㸀\0\u0001\0 \0 \0"[(int)c >> 4] & (1 << (c & 0xF))) != 0) : RegexRunner.CharInClass(c, "\0\u0004\u0001EFefd"))
				{
					return num;
				}
				num++;
			}
			while ((uint)num < (uint)span.Length);
		}
		return -1;
	}

	[MethodImpl(MethodImplOptions.AggressiveInlining)]
	internal static bool IsBoundaryWordChar(char ch)
	{
		ReadOnlySpan<byte> wordCharBitmap = WordCharBitmap;
		int num = (int)ch >> 3;
		if ((uint)num < (uint)wordCharBitmap.Length)
		{
			return (wordCharBitmap[num] & (1 << (ch & 7))) != 0;
		}
		bool flag = (0x4013F & (1 << (int)CharUnicodeInfo.GetUnicodeCategory(ch))) != 0;
		if (!flag)
		{
			bool flag2 = ((ch == '\u200c' || ch == '\u200d') ? true : false);
			flag = flag2;
		}
		return flag;
	}

	[MethodImpl(MethodImplOptions.AggressiveInlining)]
	internal static bool IsPreWordCharBoundary(ReadOnlySpan<char> inputSpan, int index)
	{
		int num = index - 1;
		if ((uint)num < (uint)inputSpan.Length)
		{
			return !IsBoundaryWordChar(inputSpan[num]);
		}
		return true;
	}

	static _003CRegexGenerator_g_003EF6D74187046B00D172B4F885B621DE58A29247487BEEF7874C300C5ED3831944D__Utilities()
	{
		InlineArray2<string> buffer = default(InlineArray2<string>);
		buffer[0] = "http";
		buffer[1] = "soc";
		s_indexOfAnyStrings_OrdinalIgnoreCase_5A4D9B017D3E6477E32C9603AB4180D9672961E82A4AB9ED0C76157EDE808508 = SearchValues.Create(buffer, StringComparison.OrdinalIgnoreCase);
		InlineArray4<string> buffer2 = default(InlineArray4<string>);
		buffer2[0] = "to";
		buffer2[1] = "secret";
		buffer2[2] = "password";
		buffer2[3] = "authoriz";
		s_indexOfAnyStrings_OrdinalIgnoreCase_D1EE3441A797B452C5194EE6FD8A180038497E9D7B4CE00ADE7A0A188B1710FF = SearchValues.Create(buffer2, StringComparison.OrdinalIgnoreCase);
	}
}
