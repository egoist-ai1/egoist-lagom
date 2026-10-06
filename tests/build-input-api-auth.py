"""Offline regressions for the actual build-input API and child admission functions."""
import ast
import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import types
import urllib.error
import urllib.request
import urllib.response
import zipfile
from email.message import Message
from unittest import mock

sys.dont_write_bytecode = True
SOURCE, WORK = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve()
WORK.mkdir()
TOKEN_KEY = 'SHIELD_BUILD_GITHUB_TOKEN'
TOKEN = 'inert-build-api-regression-token-Q9x7m2R'
before_parent = dict(os.environ)
rows = []
spec = importlib.util.spec_from_file_location('actual_component_downloader', SOURCE / 'scripts/download-component-candidates.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
original_opener = urllib.request.build_opener
original_urlopen = urllib.request.urlopen
bootstrap_path = SOURCE / 'scripts/bootstrap-build-inputs.py'
bootstrap_bytes = bootstrap_path.read_bytes()
bootstrap_tree = ast.parse(bootstrap_bytes)
runner_node = next(n for n in bootstrap_tree.body if isinstance(n, ast.FunctionDef) and n.name == 'run_input_child')

def refusal(action, phrase):
    try:
        action()
    except (ValueError, urllib.error.HTTPError) as exc:
        assert phrase in str(exc), 'Incorrect refusal category'
    else:
        raise AssertionError('Expected refusal did not occur')

def case(name, action):
    output, error = io.StringIO(), io.StringIO()
    try:
        with contextlib.redirect_stdout(output), contextlib.redirect_stderr(error):
            action()
        assert TOKEN not in output.getvalue() + error.getvalue(), 'Credential appeared in diagnostics'
        rows.append({'case': name, 'passed': True})
    except Exception as exc:
        # Do not serialize requests, environment, argv, tracebacks or credential values.
        rows.append({'case': name, 'passed': False, 'errorClass': type(exc).__name__,
                     'diagnostic': str(exc).replace(TOKEN, '[redacted]')[:400]})

def no_network(*unused, **kwargs):
    raise AssertionError('External network boundary reached')

urllib.request.urlopen = no_network

class NoNetworkHttp(urllib.request.HTTPHandler):
    def http_open(self, request):
        return no_network()

class ReadTrace(io.BytesIO):
    def __init__(self, payload, reads):
        super().__init__(payload)
        self.reads = reads
    def read(self, size=-1):
        self.reads.append(size)
        return super().read(size)

class SyntheticHttps(urllib.request.HTTPSHandler):
    def __init__(self, payload, requests, reads, redirect=None, required_token=None, status=200):
        super().__init__()
        self.payload, self.requests, self.reads = payload, requests, reads
        self.redirect, self.required_token, self.status = redirect, required_token, status
    def https_open(self, request):
        self.requests.append(request)
        assert request.timeout == 30, 'Metadata timeout changed'
        if self.required_token is not None and request.get_header('Authorization') != 'Bearer ' + self.required_token:
            raise urllib.error.HTTPError(request.full_url, 403, 'rate limit exceeded', {}, None)
        headers = Message()
        if self.redirect is not None:
            headers['Location'] = self.redirect[1] if isinstance(self.redirect, tuple) else self.redirect
        result = urllib.response.addinfourl(ReadTrace(self.payload, self.reads), headers, request.full_url,
                                           (self.redirect[0] if isinstance(self.redirect, tuple) else 302) if self.redirect is not None else self.status)
        result.msg = 'Synthetic redirect' if self.redirect is not None else 'OK'
        request.synthetic_response = result
        return result

@contextlib.contextmanager
def api(payload, redirect=None, required_token=None, status=200):
    requests, reads = [], []
    def opener(*handlers):
        return original_opener(*handlers, urllib.request.ProxyHandler({}), NoNetworkHttp(), SyntheticHttps(payload, requests, reads, redirect, required_token, status))
    with mock.patch.object(urllib.request, 'build_opener', opener):
        yield requests, reads

def read_metadata(pin):
    return module.read_release_metadata(pin)

def metadata_contract(token):
    pin = {'repository': 'SagerNet/sing-box', 'tag': 'release/тег #?%'}
    with mock.patch.dict(os.environ, {TOKEN_KEY: token or ''}), api(b'{"assets":[]}') as (requests, reads):
        if token is None:
            os.environ.pop(TOKEN_KEY, None)
        assert read_metadata(pin) == {'assets': []}
        assert len(requests) == 1
        request = requests[0]
        assert request.full_url == 'https://api.github.com/repos/SagerNet/sing-box/releases/tags/release%2F%D1%82%D0%B5%D0%B3%20%23%3F%25'
        assert request.get_header('User-agent') == 'EgoistLagom-build'
        assert (request.get_header('Authorization') == 'Bearer ' + token) if token else request.get_header('Authorization') is None
        assert reads == [2 * 1024 * 1024 + 1], 'Metadata bounded read changed'

case('optional-token-absent-fixed-https-host-and-encoded-tag', lambda: [metadata_contract(None), metadata_contract('')])
case('optional-token-authenticated-fixed-https-host-and-encoded-tag', lambda: metadata_contract(TOKEN))

def validate_requests():
    with mock.patch.dict(os.environ, {TOKEN_KEY: TOKEN}), api(b'{}') as (requests, reads):
        for repository in ['evil.invalid/a', 'https://api.github.com/owner/repo', 'owner/repo/extra',
                           'owner/../repo', 'owner/repo?x', 'owner@host/repo', 'owner\\repo', 'owner/%2f']:
            refusal(lambda r=repository: read_metadata({'repository': r, 'tag': 'v1'}), 'repository')
        for tag in ['', '.', '..', 'v1\nsecret']:
            refusal(lambda t=tag: read_metadata({'repository': 'owner/repo', 'tag': t}), 'tag')
        assert not requests and not reads, 'Invalid API address reached transport'
    for malformed in ['invalid\r\nheader', 'invalid\theader', 'invalid секрет', 'invalid-unicode-ñ']:
        with mock.patch.dict(os.environ, {TOKEN_KEY: malformed}), api(b'{}') as (requests, reads):
            refusal(lambda: read_metadata({'repository': 'owner/repo', 'tag': 'v1'}), 'token')
            assert not requests
case('invalid-repository-tag-or-token-refused-before-request', validate_requests)

def reject_redirects():
    for status in [301, 302, 303, 307, 308]:
        for target in ['https://foreign.invalid/token', 'https://api.github.com/repos/other/repo/releases/tags/v2',
                       '/repos/owner/repo/releases/tags/v2', 'http://api.github.com/repos/owner/repo/releases/tags/v1']:
            with mock.patch.dict(os.environ, {TOKEN_KEY: TOKEN}), api(b'', redirect=(status, target)) as (requests, reads):
                refusal(lambda: read_metadata({'repository': 'owner/repo', 'tag': 'v1'}), 'redirect')
                assert len(requests) == 1, 'Redirect forwarded a request'
                assert requests[0].synthetic_response.closed, 'Refused redirect response leaked'
                assert requests[0].full_url == 'https://api.github.com/repos/owner/repo/releases/tags/v1'
case('actual-urllib-redirect-processing-never-forwards-token', reject_redirects)

def metadata_limit():
    with mock.patch.dict(os.environ, {TOKEN_KEY: TOKEN}), api(b'x' * (2 * 1024 * 1024 + 1)) as (requests, reads):
        refusal(lambda: read_metadata({'repository': 'owner/repo', 'tag': 'v1'}), 'byte limit')
        assert reads == [2 * 1024 * 1024 + 1]
case('metadata-read-limit-retained', metadata_limit)

def rate_limit_preserved():
    with mock.patch.dict(os.environ, {TOKEN_KEY: ''}), api(b'{}', required_token=TOKEN) as (requests, reads):
        try:
            read_metadata({'repository': 'owner/repo', 'tag': 'v1'})
        except urllib.error.HTTPError as exc:
            assert exc.code == 403 and 'rate limit exceeded' in str(exc)
        else:
            raise AssertionError('Unauthenticated 403 was hidden')
        assert len(requests) == 1, '403 retried or downgraded authorization'
case('unauthenticated-403-preserved-without-retry-or-downgrade', rate_limit_preserved)

def unauthorized_preserved():
    with mock.patch.dict(os.environ, {TOKEN_KEY: TOKEN}), api(b'{}', status=401) as (requests, reads):
        try:
            read_metadata({'repository': 'owner/repo', 'tag': 'v1'})
        except urllib.error.HTTPError as exc:
            assert exc.code == 401
            exc.close()
        else:
            raise AssertionError('Authenticated 401 was hidden')
        assert len(requests) == 1 and requests[0].get_header('Authorization') == 'Bearer ' + TOKEN, '401 downgraded authorization'
case('authenticated-401-preserved-without-retry-or-downgrade', unauthorized_preserved)

def fixture(binary=True, unsafe_zip=False):
    root = Path(tempfile.mkdtemp(prefix='pin-', dir=WORK))
    (root / 'scripts').mkdir()
    if binary:
        payload = b'INERT ordinary pinned binary'
        pin = {'name': 'fixture', 'version': '1.0', 'repository': 'owner/repo', 'tag': 'v1.0',
               'file': 'fixture.exe', 'assetId': 17, 'bytes': len(payload), 'githubDigest': None,
               'integritySource': 'synthetic fixture only'}
    else:
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, 'w', zipfile.ZIP_STORED) as archive:
            archive.writestr('../escape.exe' if unsafe_zip else 'bundle/fixture.exe', b'INERT ZIP fixture')
        payload = stream.getvalue()
        pin = {'name': 'fixture', 'version': '1.0', 'repository': 'owner/repo', 'tag': 'v1.0', 'archive': 'fixture.zip'}
    pin.update(sha256=hashlib.sha256(payload).hexdigest(), url='https://github.com/owner/repo/releases/download/v1.0/fixture')
    descriptor = {'schemaVersion': 1, 'components': [] if binary else [pin], 'binaries': [pin] if binary else []}
    (root / 'scripts/component-inputs.json').write_text(json.dumps(descriptor), encoding='utf-8')
    asset = {'name': pin.get('file') or pin['archive'], 'browser_download_url': pin['url'],
             'id': 17, 'size': len(payload), 'digest': None if binary else 'sha256:' + pin['sha256']}
    release = {'tag_name': pin['tag'], 'draft': False, 'prerelease': False, 'assets': [asset]}
    return root, payload, pin, release

def download_main(root, payload, release, offline=False):
    calls = []
    def download(request, timeout):
        # Also replay the exact original metadata urlopen boundary in the frozen-before proof.
        if isinstance(request, urllib.request.Request):
            assert request.full_url == 'https://api.github.com/repos/owner/repo/releases/tags/v1.0'
            if request.get_header('Authorization') != 'Bearer ' + TOKEN:
                raise urllib.error.HTTPError(request.full_url, 403, 'rate limit exceeded', {}, None)
            return io.BytesIO(json.dumps(release).encode())
        assert isinstance(request, str), 'Binary/archive download gained headers'
        assert request == 'https://github.com/owner/repo/releases/download/v1.0/fixture' and timeout == 30
        calls.append(request)
        return io.BytesIO(payload)
    with mock.patch.object(module, 'PROJECT', root), mock.patch.object(sys, 'argv', ['components', '--work-dir', str(WORK)] + (['--offline'] if offline else [])), \
         mock.patch.dict(os.environ, {TOKEN_KEY: TOKEN}), api(json.dumps(release).encode(), required_token=TOKEN) as (requests, reads), \
         mock.patch.object(urllib.request, 'urlopen', download if not offline else no_network):
        module.main()
        assert not requests if offline else len(requests) == 1
    return calls

def online_pin_success(binary):
    root, payload, pin, release = fixture(binary)
    assert len(download_main(root, payload, release)) == 1
    target = root / 'recovery/component-candidates' / (pin.get('file') or pin['archive'])
    assert target.read_bytes() == payload
    provenance = target.with_suffix('.provenance.json').read_bytes()
    assert TOKEN.encode() not in provenance
case('authenticated-metadata-binary-download-token-free-and-verified', lambda: online_pin_success(True))
case('authenticated-metadata-archive-download-token-free-and-verified', lambda: online_pin_success(False))

def pin_refusals():
    changes = [('tag', lambda r: r.update(tag_name='v2')), ('draft', lambda r: r.update(draft=True)),
               ('prerelease', lambda r: r.update(prerelease=True)), ('duplicate-asset', lambda r: r['assets'].append(dict(r['assets'][0]))),
               ('asset-url', lambda r: r['assets'][0].update(browser_download_url='https://foreign.invalid/a')),
               ('asset-id', lambda r: r['assets'][0].update(id=18)), ('asset-size', lambda r: r['assets'][0].update(size=1)),
               ('asset-digest', lambda r: r['assets'][0].update(digest='sha256:' + '0' * 64))]
    for name, mutate in changes:
        root, payload, pin, release = fixture()
        mutate(release)
        refusal(lambda: download_main(root, payload, release), 'pinned')
        assert not list((root / 'recovery/component-candidates').glob('*.exe')), name
case('tag-draft-prerelease-asset-url-id-size-digest-refusals-retained', pin_refusals)

def payload_refusals():
    for variant in ['oversize', 'sha', 'archive-sha', 'zip-traversal', 'archive-digest']:
        root, payload, pin, release = fixture(binary=variant not in ['archive-sha', 'zip-traversal', 'archive-digest'], unsafe_zip=variant == 'zip-traversal')
        if variant == 'oversize':
            payload += b'oversize'
        if variant in ['sha', 'archive-sha']:
            payload = b'X' * len(payload)
        if variant == 'archive-digest':
            release['assets'][0]['digest'] = 'sha256:' + '0' * 64
        phrase = 'byte limit' if variant == 'oversize' else ('SHA-256' if variant in ['sha', 'archive-sha'] else ('ZIP path' if variant == 'zip-traversal' else 'digest'))
        refusal(lambda: download_main(root, payload, release), phrase)
        assert not (root / 'recovery/component-candidates' / (pin.get('file') or pin['archive'])).exists()
case('payload-size-sha-and-zip-path-integrity-refusals-retained', payload_refusals)

def offline():
    root, payload, pin, release = fixture()
    refusal(lambda: download_main(root, payload, release, offline=True), 'offline')
    cache = root / 'recovery/component-candidates/fixture.exe'
    cache.write_bytes(payload)
    assert not download_main(root, payload, release, offline=True)
    cache.write_bytes(b'X' * len(payload))
    refusal(lambda: download_main(root, payload, release, offline=True), 'SHA-256')
case('offline-no-api-no-download-cache-integrity-retained', offline)

def load_runner(root=SOURCE):
    namespace = {'args': types.SimpleNamespace(work_dir=WORK), 'ROOT': root, 'Path': Path, 'tempfile': tempfile,
                 'time': __import__('time'), 'subprocess': subprocess, 'sys': sys, 'json': json,
                 'flags': subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0}
    exec(compile(ast.Module(body=[runner_node], type_ignores=[]), str(bootstrap_path), 'exec'), namespace)
    return namespace['run_input_child']

def child_scope():
    shadow = WORK / 'actor-fixture'
    (shadow / 'scripts').mkdir(parents=True)
    actor = shadow / 'scripts/download-component-candidates.py'
    actor.write_text("import os,json\nprint(json.dumps({'tokenPresent':bool(os.environ.get('SHIELD_BUILD_GITHUB_TOKEN'))}))\n", encoding='utf-8')
    run = load_runner(shadow)
    with mock.patch.dict(os.environ, {TOKEN_KEY: TOKEN}):
        result = run([sys.executable, str(actor), '--work-dir', str(WORK)], 'components', timeout_seconds=10)
        assert json.loads(result.stdout)['tokenPresent'] is True
        for stage in ['wintun', 'electron', 'extract-asar', 'extract-outer']:
            result = run([sys.executable, '-c', "import os,json;print(json.dumps({'tokenPresent':bool(os.environ.get('SHIELD_BUILD_GITHUB_TOKEN'))}))"],
                         stage, timeout_seconds=10)
            assert json.loads(result.stdout)['tokenPresent'] is False
        with mock.patch.object(subprocess, 'run', no_network):
            refusal(lambda: run([sys.executable, '-c', 'pass'], 'components'), 'fixed component')
            refusal(lambda: run([sys.executable, str(actor), '--work-dir', str(WORK), '--offline'], 'components'), 'fixed component')
        assert os.environ[TOKEN_KEY] == TOKEN
case('actual-own-children-fixed-component-only-token-parent-stable', child_scope)

def diagnostic_redaction(timeout=False):
    shadow = WORK / ('timeout-actor' if timeout else 'failed-actor')
    (shadow / 'scripts').mkdir(parents=True)
    actor = shadow / 'scripts/download-component-candidates.py'
    actor.write_text("import os,sys,time\nt=os.environ['SHIELD_BUILD_GITHUB_TOKEN'].encode()\nsys.stdout.buffer.write(t);sys.stdout.flush();sys.stderr.buffer.write(t);sys.stderr.flush()\n" +
                     ("time.sleep(30)\n" if timeout else "sys.exit(7)\n"), encoding='utf-8')
    run = load_runner(shadow)
    with mock.patch.dict(os.environ, {TOKEN_KEY: TOKEN}):
        arguments = [sys.executable, str(actor), '--work-dir', str(WORK)]
        # The timeout branch is a deterministic OS boundary adapter, not a cold-start deadline test.
        adapter = mock.patch.object(subprocess, 'run', side_effect=subprocess.TimeoutExpired(arguments, 2, output=TOKEN.encode(), stderr=TOKEN.encode())) if timeout else contextlib.nullcontext()
        try:
            with adapter:
                run(arguments, 'components', timeout_seconds=2 if timeout else 10)
        except (subprocess.TimeoutExpired, subprocess.CalledProcessError) as exc:
            assert isinstance(exc, subprocess.TimeoutExpired if timeout else subprocess.CalledProcessError)
            assert TOKEN not in str(exc)
            assert TOKEN.encode() not in (getattr(exc, 'stdout', None) or b'') + (getattr(exc, 'stderr', None) or b'')
        else:
            raise AssertionError('Actor failure lost')
        assert os.environ[TOKEN_KEY] == TOKEN
    for file in (WORK / 'evidence').glob('bootstrap-child-*/*'):
        assert TOKEN.encode() not in file.read_bytes(), 'Persisted diagnostics contain credential'
case('actual-child-error-diagnostics-redacted-with-exit-preserved', diagnostic_redaction)
case('inert-timeout-partial-output-redacted-with-primary-error-preserved', lambda: diagnostic_redaction(True))

def diagnostic_boundary():
    shadow = WORK / 'boundary-actor'
    (shadow / 'scripts').mkdir(parents=True)
    actor = shadow / 'scripts/download-component-candidates.py'
    actor.write_text("import os,sys\nt=os.environ['SHIELD_BUILD_GITHUB_TOKEN'].encode()\np=b'A'*10+t+b'B'*(65536-8192-len(t))+t+b'C'*(8192-5)\nsys.stdout.buffer.write(p);sys.stdout.flush();sys.stderr.buffer.write(p);sys.stderr.flush();sys.exit(7)\n", encoding='utf-8')
    output, error = io.StringIO(), io.StringIO()
    before = set((WORK / 'evidence').glob('bootstrap-child-*'))
    with mock.patch.dict(os.environ, {TOKEN_KEY: TOKEN}), contextlib.redirect_stdout(output), contextlib.redirect_stderr(error):
        try:
            load_runner(shadow)([sys.executable, str(actor), '--work-dir', str(WORK)], 'components', timeout_seconds=10)
        except subprocess.CalledProcessError as exc:
            assert exc.returncode == 7
        else:
            raise AssertionError('Boundary actor failure lost')
    directory = (set((WORK / 'evidence').glob('bootstrap-child-*')) - before).pop()
    report = json.loads((directory / 'result.json').read_text())
    assert report['diagnosticsRedacted'] and report['stdoutTruncated'] and report['stderrTruncated']
    for raw in [(directory / 'stdout.log').read_bytes(), (directory / 'stderr.log').read_bytes(),
                output.getvalue().encode(), error.getvalue().encode()]:
        assert TOKEN.encode() not in raw and TOKEN[-5:].encode() not in raw, 'Tail retained credential fragment'
    assert (directory / 'stdout.log').stat().st_size <= 65536
    assert (directory / 'stderr.log').stat().st_size <= 65536
case('redaction-precedes-65536-capture-and-8192-printed-boundaries', diagnostic_boundary)

def actual_bootstrap_dispatch():
    shadow = WORK / 'bootstrap-main'
    setup = shadow / 'recovery/release-3.5.4/EgoistShield-Setup-3.5.4.exe'
    setup.parent.mkdir(parents=True)
    setup.write_bytes(b'INERT old-installer fixture, never executed')
    calls = []
    def process(arguments, **kwargs):
        env = kwargs['env']
        stage_script = str(shadow / 'scripts/download-component-candidates.py')
        component = arguments == [sys.executable, stage_script, '--work-dir', str(WORK)]
        assert (env.get(TOKEN_KEY) == TOKEN) if component else TOKEN_KEY not in env
        assert kwargs['stdin'] == subprocess.DEVNULL and kwargs['timeout'] == 1200
        calls.append(('components' if component else ('7z' if arguments[0].endswith('fixture7z.exe') else Path(arguments[1]).name)))
        return subprocess.CompletedProcess(arguments, 0, b'', b'')
    # Only old public-installer hash is a leaf fixture; no trust claim is made for these inert bytes.
    with mock.patch.dict(os.environ, {TOKEN_KEY: TOKEN}), mock.patch.object(sys, 'argv', ['bootstrap', '--seven-zip', str(shadow / 'fixture7z.exe'), '--work-dir', str(WORK)]), \
         mock.patch.object(hashlib, 'file_digest', lambda *unused: types.SimpleNamespace(hexdigest=lambda: '97c2f6207176f68e1b63f5052b530a055ee60c15407448052ef4af5dbd478ce8')), \
         mock.patch.object(subprocess, 'run', process), mock.patch.object(urllib.request, 'urlretrieve', no_network):
        exec(compile(bootstrap_bytes, str(bootstrap_path), 'exec'), {'__file__': str(shadow / 'scripts/bootstrap-build-inputs.py'), '__name__': '__fixture__'})
        assert os.environ[TOKEN_KEY] == TOKEN
    assert calls == ['7z', '7z', '7z', '7z', 'asar.js', 'components', 'download-wintun.py', 'fetch-electron-runtime.py']
case('actual-bootstrap-all-actors-scope-token-exactly-on-components', actual_bootstrap_dispatch)

assert dict(os.environ) == before_parent, 'Parent process environment changed'
report = {'schemaVersion': 1, 'actualProductionFunctions': True, 'cases': len(rows),
          'passed': sum(r['passed'] for r in rows), 'rows': rows,
          'externalNetworkOperations': 0, 'nativeOperations': 0, 'parentEnvironmentUnchanged': True,
          'syntheticTokenOnly': True, 'timeoutRedactionUsesInertOsAdapter': True, 'oldInstallerIntegrityFixtureOnly': True}
print(json.dumps(report))
sys.exit(0 if all(r['passed'] for r in rows) else 1)
