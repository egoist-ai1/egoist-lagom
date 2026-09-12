using System.CodeDom.Compiler;
using System.Runtime.CompilerServices;

namespace System.Text.RegularExpressions.Generated;

[GeneratedCode("System.Text.RegularExpressions.Generator", "10.0.14.27113")]
[SkipLocalsInit]
internal sealed class _003CRegexGenerator_g_003EF6D74187046B00D172B4F885B621DE58A29247487BEEF7874C300C5ED3831944D__SecretAssignmentRegex_1 : Regex
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
				if (num <= inputSpan.Length - 7)
				{
					int num2 = inputSpan.Slice(num).IndexOfAny(_003CRegexGenerator_g_003EF6D74187046B00D172B4F885B621DE58A29247487BEEF7874C300C5ED3831944D__Utilities.s_indexOfAnyStrings_OrdinalIgnoreCase_D1EE3441A797B452C5194EE6FD8A180038497E9D7B4CE00ADE7A0A188B1710FF);
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
				int num3 = 0;
				int num4 = 0;
				int num5 = 0;
				ReadOnlySpan<char> readOnlySpan = inputSpan.Slice(num);
				if (!_003CRegexGenerator_g_003EF6D74187046B00D172B4F885B621DE58A29247487BEEF7874C300C5ED3831944D__Utilities.IsPreWordCharBoundary(inputSpan, num))
				{
					UncaptureUntil(0);
					return false;
				}
				num2 = num;
				if (readOnlySpan.IsEmpty)
				{
					UncaptureUntil(0);
					return false;
				}
				switch (readOnlySpan[0])
				{
				case 'T':
				case 't':
				{
					char c;
					if ((uint)readOnlySpan.Length < 5u || (readOnlySpan[1] | 0x20) != 111 || ((((c = readOnlySpan[2]) | 0x20) != 107) & (c != 'K')) || !readOnlySpan.Slice(3).StartsWith("en".AsSpan(), StringComparison.OrdinalIgnoreCase))
					{
						UncaptureUntil(0);
						return false;
					}
					num += 5;
					readOnlySpan = inputSpan.Slice(num);
					break;
				}
				case 'S':
				case 's':
					if ((uint)readOnlySpan.Length < 6u || !readOnlySpan.Slice(1).StartsWith("ecret".AsSpan(), StringComparison.OrdinalIgnoreCase))
					{
						UncaptureUntil(0);
						return false;
					}
					num += 6;
					readOnlySpan = inputSpan.Slice(num);
					break;
				case 'P':
				case 'p':
					if ((uint)readOnlySpan.Length < 8u || !readOnlySpan.Slice(1).StartsWith("assword".AsSpan(), StringComparison.OrdinalIgnoreCase))
					{
						UncaptureUntil(0);
						return false;
					}
					num += 8;
					readOnlySpan = inputSpan.Slice(num);
					break;
				case 'A':
				case 'a':
					if ((uint)readOnlySpan.Length < 13u || !readOnlySpan.Slice(1).StartsWith("uthorization".AsSpan(), StringComparison.OrdinalIgnoreCase))
					{
						UncaptureUntil(0);
						return false;
					}
					num += 13;
					readOnlySpan = inputSpan.Slice(num);
					break;
				default:
					UncaptureUntil(0);
					return false;
				}
				Capture(1, num2, num);
				int i;
				for (i = 0; (uint)i < (uint)readOnlySpan.Length && char.IsWhiteSpace(readOnlySpan[i]); i++)
				{
				}
				readOnlySpan = readOnlySpan.Slice(i);
				num += i;
				if (readOnlySpan.IsEmpty || readOnlySpan[0] != '=')
				{
					UncaptureUntil(0);
					return false;
				}
				num++;
				readOnlySpan = inputSpan.Slice(num);
				num4 = num;
				int j;
				for (j = 0; (uint)j < (uint)readOnlySpan.Length && char.IsWhiteSpace(readOnlySpan[j]); j++)
				{
				}
				readOnlySpan = readOnlySpan.Slice(j);
				num += j;
				num5 = num;
				int k;
				while (true)
				{
					num3 = Crawlpos();
					for (k = 0; (uint)k < (uint)readOnlySpan.Length; k++)
					{
						char c;
						if ((((c = readOnlySpan[k]) < '\u0080') ? ("쇿\uffff\ufffe\uf7ff\uffff\uffff\uffff\uffff"[(int)c >> 4] & (1 << (c & 0xF))) : (RegexRunner.CharInClass(c, "\u0001\u0002\u0001;<d") ? 1 : 0)) == 0)
						{
							break;
						}
					}
					if (k != 0)
					{
						break;
					}
					UncaptureUntil(num3);
					if (_003CRegexGenerator_g_003EF6D74187046B00D172B4F885B621DE58A29247487BEEF7874C300C5ED3831944D__Utilities.s_hasTimeout)
					{
						CheckTimeout();
					}
					if (num4 >= num5)
					{
						UncaptureUntil(0);
						return false;
					}
					num = --num5;
					readOnlySpan = inputSpan.Slice(num);
				}
				readOnlySpan = readOnlySpan.Slice(k);
				Capture(0, start, runtextpos = num + k);
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

	internal static readonly _003CRegexGenerator_g_003EF6D74187046B00D172B4F885B621DE58A29247487BEEF7874C300C5ED3831944D__SecretAssignmentRegex_1 Instance = new _003CRegexGenerator_g_003EF6D74187046B00D172B4F885B621DE58A29247487BEEF7874C300C5ED3831944D__SecretAssignmentRegex_1();

	private _003CRegexGenerator_g_003EF6D74187046B00D172B4F885B621DE58A29247487BEEF7874C300C5ED3831944D__SecretAssignmentRegex_1()
	{
		pattern = "(?i)\\b(token|secret|password|authorization)\\s*=\\s*[^\\s;]+";
		roptions = RegexOptions.None;
		Regex.ValidateMatchTimeout(_003CRegexGenerator_g_003EF6D74187046B00D172B4F885B621DE58A29247487BEEF7874C300C5ED3831944D__Utilities.s_defaultTimeout);
		internalMatchTimeout = _003CRegexGenerator_g_003EF6D74187046B00D172B4F885B621DE58A29247487BEEF7874C300C5ED3831944D__Utilities.s_defaultTimeout;
		factory = new RunnerFactory();
		capsize = 2;
	}
}
