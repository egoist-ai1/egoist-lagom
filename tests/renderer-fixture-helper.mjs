import assert from 'node:assert/strict';

// Read actual callback bodies without coupling a fixture to its dependency names.
// The recovered source emits these hooks at the root component's two-space indent.
export function extractRendererCallback(source, name) {
  const marker = `${name} = O.useCallback(`;
  const markerStart = source.indexOf(marker);
  assert.ok(markerStart >= 0, `Actual renderer callback ${name} exists`);
  const bodyStart = markerStart + marker.length;
  const firstLine = source.slice(bodyStart).split(/\r?\n/, 1)[0];
  const singleLineEnd = /, \[[^\r\n]*\]\)/.exec(firstLine);
  if (singleLineEnd) return firstLine.slice(0, singleLineEnd.index);
  const closing = /\r?\n  \}, \[[^\r\n]*\]\)/.exec(source.slice(bodyStart));
  assert.ok(closing, `Actual renderer callback ${name} has a complete hook boundary`);
  const bodyEnd = bodyStart + closing.index + closing[0].indexOf('}') + 1;
  return source.slice(bodyStart, bodyEnd);
}

export function extractTopLevelFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `Actual function ${name} exists`);
  const closing = /\r?\n\}/.exec(source.slice(start));
  assert.ok(closing, `Actual function ${name} has a complete body`);
  return source.slice(start, start + closing.index + closing[0].length);
}
