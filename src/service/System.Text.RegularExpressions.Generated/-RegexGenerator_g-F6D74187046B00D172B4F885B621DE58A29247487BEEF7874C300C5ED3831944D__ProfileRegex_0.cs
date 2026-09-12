using System.CodeDom.Compiler;
using System.Runtime.CompilerServices;

namespace System.Text.RegularExpressions.Generated;

[GeneratedCode("System.Text.RegularExpressions.Generator", "10.0.14.27113")]
[SkipLocalsInit]
internal sealed class _003CRegexGenerator_g_003EF6D74187046B00D172B4F885B621DE58A29247487BEEF7874C300C5ED3831944D__ProfileRegex_0 : Regex
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
				if (num <= inputSpan.Length - 28)
				{
					if (num <= 0 || inputSpan[num - 1] == '\n')
					{
						goto IL_005a;
					}
					int num2 = inputSpan.Slice(num).IndexOf('\n');
					if ((uint)num2 <= inputSpan.Length - num - 1)
					{
						num += num2 + 1;
						if (num <= inputSpan.Length - 28)
						{
							goto IL_005a;
						}
					}
				}
				goto IL_0077;
				IL_005a:
				int num3 = inputSpan.Slice(num).IndexOfNonAsciiOrAny_FA1508E26373F1EEE419399B9DF589F48E0DB3D5A71CE228D174BB2C6297B839();
				if (num3 >= 0)
				{
					runtextpos = num + num3;
					return true;
				}
				goto IL_0077;
				IL_0077:
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
				int num6 = 0;
				int num7 = 0;
				int num8 = 0;
				ReadOnlySpan<char> span = inputSpan.Slice(num);
				if (num > 0 && inputSpan[num - 1] != '\n')
				{
					UncaptureUntil(0);
					return false;
				}
				int i;
				for (i = 0; (uint)i < (uint)span.Length && char.IsWhiteSpace(span[i]); i++)
				{
				}
				span = span.Slice(i);
				num += i;
				if ((uint)span.Length < 19u || !span.StartsWith("egoistshieldprofile".AsSpan(), StringComparison.OrdinalIgnoreCase))
				{
					UncaptureUntil(0);
					return false;
				}
				num += 19;
				span = inputSpan.Slice(num);
				int j;
				for (j = 0; (uint)j < (uint)span.Length && char.IsWhiteSpace(span[j]); j++)
				{
				}
				if (j == 0)
				{
					UncaptureUntil(0);
					return false;
				}
				span = span.Slice(j);
				num += j;
				if ((uint)span.Length < 6u || !span.StartsWith("reg_sz".AsSpan(), StringComparison.OrdinalIgnoreCase))
				{
					UncaptureUntil(0);
					return false;
				}
				num += 6;
				span = inputSpan.Slice(num);
				num5 = num;
				int k;
				for (k = 0; (uint)k < (uint)span.Length && char.IsWhiteSpace(span[k]); k++)
				{
				}
				if (k == 0)
				{
					UncaptureUntil(0);
					return false;
				}
				span = span.Slice(k);
				num += k;
				num6 = num;
				num5++;
				while (true)
				{
					num3 = Crawlpos();
					num2 = num;
					num7 = num;
					int num9 = span.IndexOf('\n');
					if (num9 < 0)
					{
						num9 = span.Length;
					}
					if (num9 != 0)
					{
						span = span.Slice(num9);
						num += num9;
						num8 = num;
						num7++;
						while (true)
						{
							num4 = Crawlpos();
							Capture(1, num2, num);
							if ((uint)num < (uint)inputSpan.Length && inputSpan[num] != '\n')
							{
								UncaptureUntil(num4);
								if (_003CRegexGenerator_g_003EF6D74187046B00D172B4F885B621DE58A29247487BEEF7874C300C5ED3831944D__Utilities.s_hasTimeout)
								{
									CheckTimeout();
								}
								if (num7 >= num8)
								{
									break;
								}
								num = --num8;
								span = inputSpan.Slice(num);
								continue;
							}
							runtextpos = num;
							Capture(0, start, num);
							return true;
						}
					}
					UncaptureUntil(num3);
					if (_003CRegexGenerator_g_003EF6D74187046B00D172B4F885B621DE58A29247487BEEF7874C300C5ED3831944D__Utilities.s_hasTimeout)
					{
						CheckTimeout();
					}
					if (num5 >= num6 || (num6 = inputSpan.Slice(num5, num6 - num5).LastIndexOfAnyExcept('\n')) < 0)
					{
						break;
					}
					num6 += num5;
					num = num6;
					span = inputSpan.Slice(num);
				}
				UncaptureUntil(0);
				return false;
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

	internal static readonly _003CRegexGenerator_g_003EF6D74187046B00D172B4F885B621DE58A29247487BEEF7874C300C5ED3831944D__ProfileRegex_0 Instance = new _003CRegexGenerator_g_003EF6D74187046B00D172B4F885B621DE58A29247487BEEF7874C300C5ED3831944D__ProfileRegex_0();

	private _003CRegexGenerator_g_003EF6D74187046B00D172B4F885B621DE58A29247487BEEF7874C300C5ED3831944D__ProfileRegex_0()
	{
		pattern = "(?im)^\\s*EgoistShieldProfile\\s+REG_SZ\\s+(.+)$";
		roptions = RegexOptions.None;
		Regex.ValidateMatchTimeout(_003CRegexGenerator_g_003EF6D74187046B00D172B4F885B621DE58A29247487BEEF7874C300C5ED3831944D__Utilities.s_defaultTimeout);
		internalMatchTimeout = _003CRegexGenerator_g_003EF6D74187046B00D172B4F885B621DE58A29247487BEEF7874C300C5ED3831944D__Utilities.s_defaultTimeout;
		factory = new RunnerFactory();
		capsize = 2;
	}
}
