"""Use the configured Git credential helper for this project's GitHub API calls."""
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

def credential_token():
    env = {**os.environ, 'GIT_TERMINAL_PROMPT': '0', 'GCM_INTERACTIVE': 'never'}
    credentials = subprocess.run(['git', 'credential', 'fill'], input='protocol=https\nhost=github.com\n\n', text=True, capture_output=True, timeout=15, env=env)
    fields = dict(line.split('=', 1) for line in credentials.stdout.splitlines() if '=' in line)
    token = fields.get('password')
    if not token:
        raise RuntimeError('No noninteractive GitHub credential is configured')
    return token

def request(endpoint, method='GET', payload=None):
    if not endpoint.startswith('/') or endpoint.startswith('//'):
        raise ValueError('Expected a GitHub API path')
    token = credential_token()
    body = None if payload is None else json.dumps(payload).encode()
    req = urllib.request.Request('https://api.github.com' + endpoint, data=body, method=method, headers={'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json', 'User-Agent': 'EgoistLagom-release', 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            data = response.read()
            return json.loads(data) if data else {'status': response.status}
    except urllib.error.HTTPError as error:
        raise RuntimeError('GitHub API returned HTTP ' + str(error.code)) from None

if __name__ == '__main__':
    result = request(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else 'GET', json.loads(sys.argv[3]) if len(sys.argv) > 3 else None)
    print(json.dumps(result, ensure_ascii=False))
