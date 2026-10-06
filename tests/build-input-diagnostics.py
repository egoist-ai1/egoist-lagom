import ast,contextlib,io,json,os,pathlib,subprocess,sys,tempfile,time,types
source=pathlib.Path(sys.argv[1]);work=pathlib.Path(sys.argv[2]);work.mkdir()
tree=ast.parse(source.read_text(encoding='utf-8'))
fn=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='run_input_child')
namespace={'args':types.SimpleNamespace(work_dir=work),'Path':pathlib.Path,'tempfile':tempfile,'time':time,'subprocess':subprocess,'sys':sys,'json':json,'flags':subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0}
exec(compile(ast.Module(body=[fn],type_ignores=[]),str(source),'exec'),namespace)
run=namespace['run_input_child'];rows=[]
def case(name,code,expect,timeout=15,discard_stdout=False):
 before=set((work/'evidence').glob('bootstrap-child-*')) if (work/'evidence').exists() else set()
 out,err=io.StringIO(),io.StringIO();caught=None
 with contextlib.redirect_stdout(out),contextlib.redirect_stderr(err):
  try:run([sys.executable,'-c',code],name,timeout_seconds=timeout,discard_stdout=discard_stdout)
  except (subprocess.CalledProcessError,subprocess.TimeoutExpired,OSError) as e:caught=e
 dirs=set((work/'evidence').glob('bootstrap-child-*'))-before
 assert len(dirs)==1
 directory=dirs.pop();report=json.loads((directory/'result.json').read_text())
 assert report['stage']==name and report['result']==expect and report['environmentDumped'] is False
 assert report['stdoutCaptured'] is (not discard_stdout) and report['stderrCaptured'] is True
 assert (directory/'stdout.log').stat().st_size<=65536 and (directory/'stderr.log').stat().st_size<=65536
 if expect=='passed':assert caught is None and report['exitCode']==0
 elif expect=='failed':assert isinstance(caught,subprocess.CalledProcessError) and caught.returncode==7 and report['exitCode']==7
 elif expect=='timeout':assert isinstance(caught,subprocess.TimeoutExpired) and report['exitCode'] is None
 return report,directory,out.getvalue(),err.getvalue()
report,d,out,err=case('success',"import sys;sys.stdout.buffer.write(b'component-verified\\n')",'passed')
assert b'component-verified' in (d/'stdout.log').read_bytes() and 'component-verified' in out
rows.append('successful-child-stdout-preserved')
report,d,out,err=case('stdout-discarded',"print('7zip-ignored-stdout')",'passed',discard_stdout=True)
assert report['stdoutBytes']==0 and not report['stdoutCaptured'] and (d/'stdout.log').read_bytes()==b'' and out==''
rows.append('discarded-stdout-is-explicit-not-reported-as-silence')
report,d,out,err=case('integrity-refused',"import sys;sys.stdout.buffer.write(b'component-before-failure\\n');sys.stderr.buffer.write(b'Pinned binary SHA-256 mismatch\\n');sys.exit(7)",'failed')
assert b'Pinned binary SHA-256 mismatch' in (d/'stderr.log').read_bytes() and 'Pinned binary SHA-256 mismatch' in err and 'component-before-failure' in out
rows.append('child-failure-code-and-specific-cause-preserved')
report,d,out,err=case('bounded-tail',"import sys;sys.stdout.buffer.write(b'A'*131072);sys.stderr.buffer.write(b'B'*131072);sys.exit(7)",'failed')
assert report['stdoutBytes']==131072 and report['stderrBytes']==131072 and report['stdoutTruncated'] and report['stderrTruncated']
assert (d/'stdout.log').read_bytes()==b'A'*65536 and (d/'stderr.log').read_bytes()==b'B'*65536 and len(out)==8192 and 'B'*8192 in err
rows.append('large-error-retained-tail-bound-and-truncation-explicit')
report,d,out,err=case('timeout',"import sys,time;sys.stderr.buffer.write(b'own-child-before-timeout\\n');sys.stderr.flush();time.sleep(30)",'timeout',timeout=3)
assert b'own-child-before-timeout' in (d/'stderr.log').read_bytes() and report['errorClass']=='TimeoutExpired'
rows.append('timeout-partial-stderr-retained-own-child-retired')
old={f:f.read_bytes() for f in (work/'evidence').glob('bootstrap-child-*/*')}
case('success-repeat',"print('another verified actor')",'passed')
assert all(f.read_bytes()==b for f,b in old.items())
rows.append('new-session-never-overwrites-previous-receipts')
# Missing executable fails before any child, with a distinct truthful launch receipt.
out,err=io.StringIO(),io.StringIO()
with contextlib.redirect_stdout(out),contextlib.redirect_stderr(err):
 try:run([str(work/'absent-input-executable.exe')],'missing-executable')
 except FileNotFoundError:pass
 else:raise AssertionError('Absent executable admitted')
reports=[json.loads(f.read_text()) for f in (work/'evidence').glob('bootstrap-child-*/result.json')]
launch=next(r for r in reports if r['stage']=='missing-executable')
assert launch['result']=='launch-failed' and launch['exitCode'] is None and launch['errorClass']=='FileNotFoundError'
rows.append('launch-failure-is-distinct-from-child-return-code')
# None of the pinned hashes/checkers are imported or run by this actual-function probe.
print(json.dumps({'actualProductionFunction':True,'cases':len(rows),'passed':rows,'reports':len(reports),'networkOperations':0,'productOperations':0,'environmentDumped':False,'windowsNoWindow':os.name=='nt'}))
