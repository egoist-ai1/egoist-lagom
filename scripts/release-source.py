"""Pure GitHub source-binding checks used before and after release publication."""
import re
import urllib.parse


def exact_sha(value):
    if not isinstance(value, str) or not re.fullmatch(r'[a-f0-9]{40}', value):
        raise ValueError('Expected an exact lowercase Git SHA')
    return value


def source_binding(request, repository, commit):
    exact_sha(commit)
    value = request(repository + '/git/commits/' + commit)
    if value.get('sha') != commit:
        raise RuntimeError('GitHub commit readback differs from the requested source')
    return {'commit': commit, 'tree': exact_sha(value.get('tree', {}).get('sha'))}


def resolved_tag_commit(request, repository, tag, allow_missing=False):
    try:
        value = request(repository + '/git/ref/tags/' + urllib.parse.quote(tag, safe=''))
    except RuntimeError as error:
        if allow_missing and str(error) == 'GitHub API returned HTTP 404':
            return None
        raise
    obj = value.get('object', {})
    for _ in range(6):
        exact_sha(obj.get('sha'))
        if obj.get('type') == 'commit':
            return obj['sha']
        if obj.get('type') != 'tag':
            raise RuntimeError('Release tag must resolve to a commit')
        obj = request(repository + '/git/tags/' + obj['sha']).get('object', {})
    raise RuntimeError('Release tag annotation chain exceeds the supported depth')


def verify_release_source(request, repository, release, expected, allow_missing_tag=False):
    if not isinstance(expected, dict):
        raise RuntimeError('Release receipt lacks an exact source binding')
    exact_sha(expected.get('commit'))
    exact_sha(expected.get('tree'))
    actual = source_binding(request, repository, expected['commit'])
    if actual != expected:
        raise RuntimeError('Release source tree differs from the recorded candidate')
    resolved = resolved_tag_commit(request, repository, release['tag_name'], allow_missing_tag)
    if resolved is not None and resolved != expected['commit']:
        raise RuntimeError('Release tag resolves to a different source commit')
    if resolved is None and release.get('target_commitish') != expected['commit']:
        raise RuntimeError('Uncreated release tag does not target the recorded source commit')
    return {**actual, 'tagCommit': resolved}


def verify_artifact_source(integrity, expected=None):
    source = integrity.get('source')
    if not isinstance(source, dict):
        raise RuntimeError('Package integrity lacks an exact source binding; rebuild the candidate')
    binding = {'commit': exact_sha(source.get('commit')), 'tree': exact_sha(source.get('tree'))}
    if expected is not None and binding != expected:
        raise RuntimeError('Packaged source differs from the requested release commit/tree')
    return binding
