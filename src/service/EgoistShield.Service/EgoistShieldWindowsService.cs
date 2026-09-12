using System;
using System.Diagnostics;
using System.Linq;
using System.ServiceProcess;
using System.Threading;
using System.Threading.Tasks;

namespace EgoistShield.Service;

internal sealed class EgoistShieldWindowsService : ServiceBase
{
	private readonly ServiceOptions _options;

	private CancellationTokenSource? _stopSource;

	private Task? _runTask;

	public EgoistShieldWindowsService(ServiceOptions options)
	{
		_options = options;
		base.ServiceName = "EgoistShieldCore";
		base.CanStop = true;
		base.CanShutdown = true;
		base.AutoLog = true;
	}

	protected override void OnStart(string[] args)
	{
		CancellationTokenSource stopSource = new CancellationTokenSource();
		_stopSource = stopSource;
		_runTask = Task.Run(async delegate
		{
			_ = 1;
			try
			{
				await (await ServiceEngine.CreateAsync(_options, stopSource.Token)).RunAsync(stopSource.Token);
			}
			catch (OperationCanceledException) when (stopSource.IsCancellationRequested)
			{
			}
			catch (Exception value)
			{
				EventLog.WriteEntry($"EgoistShieldCore failed: {value}", EventLogEntryType.Error);
				base.ExitCode = 1;
				ThreadPool.QueueUserWorkItem(delegate(object? state)
				{
					((ServiceBase)state).Stop();
				}, this);
			}
		});
	}

	protected override void OnStop()
	{
		StopCore();
	}

	protected override void OnShutdown()
	{
		StopCore();
	}

	private void StopCore()
	{
		_stopSource?.Cancel();
		try
		{
			_runTask?.Wait(TimeSpan.FromSeconds(20L));
		}
		catch (AggregateException ex) when (ex.InnerExceptions.All((Exception item) => item is OperationCanceledException))
		{
		}
		finally
		{
			_stopSource?.Dispose();
			_stopSource = null;
			_runTask = null;
		}
	}
}
