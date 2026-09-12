using System.CodeDom.Compiler;
using System.Runtime.CompilerServices;

namespace System.Text.RegularExpressions.Generated;

[GeneratedCode("System.Text.RegularExpressions.Generator", "10.0.14.27113")]
[SkipLocalsInit]
internal sealed class _003CRegexGenerator_g_003EF6D74187046B00D172B4F885B621DE58A29247487BEEF7874C300C5ED3831944D__ProxyCredentialRegex_2 : Regex
{
	private sealed class RunnerFactory : RegexRunnerFactory
	{
		private sealed class Runner : RegexRunner
		{
			protected override void Scan(ReadOnlySpan<char> inputSpan)
			{
				while (TryFindNextPossibleStartingPosition(inputSpan) && !TryMatchAtCurrentPosition(inputSpan) && runtextpos != inputSpan.Length)
				{
					runtextpos++;
					if (_003CRegexGenerator_g_003EF6D74187046B00D172B4F885B621DE58A29247487BEEF7874C300C5ED3831944D__Utilities.s_hasTimeout)
					{
						CheckTimeout();
					}
				}
			}

			private bool TryFindNextPossibleStartingPosition(ReadOnlySpan<char> inputSpan)
			{
				int num = runtextpos;
				if (num <= inputSpan.Length - 9)
				{
					int num2 = inputSpan.Slice(num).IndexOfAny(_003CRegexGenerator_g_003EF6D74187046B00D172B4F885B621DE58A29247487BEEF7874C300C5ED3831944D__Utilities.s_indexOfAnyStrings_OrdinalIgnoreCase_5A4D9B017D3E6477E32C9603AB4180D9672961E82A4AB9ED0C76157EDE808508);
					if (num2 >= 0)
					{
						runtextpos = num + num2;
						return true;
					}
				}
				runtextpos = inputSpan.Length;
				return false;
			}

			private bool TryMatchAtCurrentPosition(ReadOnlySpan<char> inputSpan)
			{
				int num = runtextpos;
				int start = num;
				int num2 = 0;
				ReadOnlySpan<char> span = inputSpan.Slice(num);
				if (!_003CRegexGenerator_g_003EF6D74187046B00D172B4F885B621DE58A29247487BEEF7874C300C5ED3831944D__Utilities.IsPreWordCharBoundary(inputSpan, num))
				{
					UncaptureUntil(0);
					return false;
				}
				num2 = num;
				if (span.IsEmpty)
				{
					UncaptureUntil(0);
					return false;
				}
				switch (span[0])
				{
				case 'H':
				case 'h':
					if ((uint)span.Length < 4u || !span.Slice(1).StartsWith("ttp".AsSpan(), StringComparison.OrdinalIgnoreCase))
					{
						UncaptureUntil(0);
						return false;
					}
					if ((uint)span.Length > 4u && (span[4] | 0x20) == 115)
					{
						span = span.Slice(1);
						num++;
					}
					num += 4;
					span = inputSpan.Slice(num);
					break;
				case 'S':
				case 's':
				{
					char c;
					if ((uint)span.Length < 5u || !span.Slice(1).StartsWith("oc".AsSpan(), StringComparison.OrdinalIgnoreCase) || ((((c = span[3]) | 0x20) != 107) & (c != 'K')) || (span[4] | 0x20) != 115)
					{
						UncaptureUntil(0);
						return false;
					}
					if ((uint)span.Length > 5u && span[5] == '5')
					{
						span = span.Slice(1);
						num++;
					}
					num += 5;
					span = inputSpan.Slice(num);
					break;
				}
				default:
					UncaptureUntil(0);
					return false;
				}
				Capture(1, num2, num);
				if (!span.StartsWith("://".AsSpan()))
				{
					UncaptureUntil(0);
					return false;
				}
				num += 3;
				span = inputSpan.Slice(num);
				int i;
				for (i = 0; (uint)i < (uint)span.Length; i++)
				{
					char c;
					if ((((c = span[i]) < '\u0080') ? ("쇿\uffff\ufffe\uffff\ufffe\uffff\uffff\uffff"[(int)c >> 4] & (1 << (c & 0xF))) : (RegexRunner.CharInClass(c, "\u0001\u0002\u0001@Ad") ? 1 : 0)) == 0)
					{
						break;
					}
				}
				if (i == 0)
				{
					UncaptureUntil(0);
					return false;
				}
				span = span.Slice(i);
				num += i;
				if (span.IsEmpty || span[0] != '@')
				{
					UncaptureUntil(0);
					return false;
				}
				Capture(0, start, runtextpos = num + 1);
				return true;
				[MethodImpl(MethodImplOptions.AggressiveInlining)]
				void UncaptureUntil(int capturePosition)
				{
					while (Crawlpos() > capturePosition)
					{
						Uncapture();
					}
				}
			}
		}

		protected override RegexRunner CreateInstance()
		{
			return new Runner();
		}
	}

	internal static readonly _003CRegexGenerator_g_003EF6D74187046B00D172B4F885B621DE58A29247487BEEF7874C300C5ED3831944D__ProxyCredentialRegex_2 Instance = new _003CRegexGenerator_g_003EF6D74187046B00D172B4F885B621DE58A29247487BEEF7874C300C5ED3831944D__ProxyCredentialRegex_2();

	private _003CRegexGenerator_g_003EF6D74187046B00D172B4F885B621DE58A29247487BEEF7874C300C5ED3831944D__ProxyCredentialRegex_2()
	{
		pattern = "(?i)\\b(https?|socks5?)://[^@\\s]+@";
		roptions = RegexOptions.None;
		Regex.ValidateMatchTimeout(_003CRegexGenerator_g_003EF6D74187046B00D172B4F885B621DE58A29247487BEEF7874C300C5ED3831944D__Utilities.s_defaultTimeout);
		internalMatchTimeout = _003CRegexGenerator_g_003EF6D74187046B00D172B4F885B621DE58A29247487BEEF7874C300C5ED3831944D__Utilities.s_defaultTimeout;
		factory = new RunnerFactory();
		capsize = 2;
	}
}
