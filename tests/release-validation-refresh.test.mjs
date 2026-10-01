import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('pending release validation can change only its unpublished document while immutable assets stay frozen', { skip: !process.env.EGOIST_RELEASE_PYTHON && 'Set EGOIST_RELEASE_PYTHON to the selected Python runtime' }, () => {
  const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../scripts/release-source.py');
  const check = `
import importlib.util,sys
spec=importlib.util.spec_from_file_location('release_source',sys.argv[1])
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
name='Egoist-Lagom-validation.md'
old={name:{'digest':'sha256:'+'a'*64,'size':20},'installer':{'digest':'sha256:'+'b'*64,'size':100}}
new={**old,name:{'digest':'sha256:'+'c'*64,'size':30}}
result=module.verify_pending_validation_refresh(old,new,[],[{'name':'installer'}])
assert result==new and old[name]['size']==20
def refused(candidate,remote=None,uploaded=None):
  try:module.verify_pending_validation_refresh(old,candidate,remote or [],uploaded or [])
  except RuntimeError:return
  raise AssertionError('unsafe validation refresh accepted')
refused({**new,'installer':{'digest':'sha256:'+'d'*64,'size':100}})
refused({name:new[name]})
refused({**new,'extra':old['installer']})
refused(new,[{'name':name}])
refused(new,uploaded=[{'name':name}])
refused({**new,name:{'digest':'sha256:'+'c'*64,'size':True}})
refused({**new,name:{'digest':'invalid','size':30}})
refused({**new,name:{'digest':'sha256:'+'c'*64,'size':0}})
print('PASS: unpublished document only; eight unsafe refreshes refused')
`;
  const output = execFileSync(process.env.EGOIST_RELEASE_PYTHON, ['-X', 'utf8', '-c', check, script], { encoding: 'utf8', windowsHide: true, timeout: 10000, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  assert.match(output, /eight unsafe refreshes refused/);
});
