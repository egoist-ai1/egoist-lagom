import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await fs.readFile(new URL('../src/brand/CompactRuby.jsx', import.meta.url), 'utf8');
const start = source.indexOf('function rubyComponentStatus(');
const end = source.indexOf('function RubyLogEntry(', start);
assert.ok(start >= 0 && end > start, 'UI state helper boundary is present');
const helpers = vm.runInNewContext(source.slice(start, end) + '\n({rubyComponentStatus,rubyTrafficSample,rubyTabKey})');

test('component status distinguishes unavailable reads, unready processes and actual readiness', () => {
  const state = helpers.rubyComponentStatus;
  assert.equal(state(null, false, false).tone, 'unknown');
  assert.equal(state({ serviceRunning:true, runtimeReady:false }, false, false).tone, 'degraded');
  assert.equal(state({ listenerReady:false, lastError:'Port is occupied by another process' }, false, false).label, 'Ошибка');
  assert.equal(state({ running:false, lastError:'Port is occupied by another process' }, false, false).detail, 'Port is occupied by another process');
  assert.equal(state({ running:false }, false, false).tone, 'off');
  assert.equal(state({ runtimeReady:true }, true, false).tone, 'ready');
  assert.equal(state({ runtimeReady:true }, true, true).tone, 'pending');
});

test('traffic requires a real finite sample and never presents unknown traffic as measured zero', () => {
  const sample = helpers.rubyTrafficSample;
  assert.equal(sample(false, true, 42), null);
  assert.equal(sample(true, false, 0), null);
  assert.equal(sample(true, true, undefined), null);
  assert.equal(sample(true, true, NaN), null);
  assert.equal(sample(true, true, Infinity), null);
  assert.equal(sample(true, true, 0), 0);
  assert.equal(sample(true, true, 1024), 1024);
  assert.equal(sample(true, true, -1), 0);
});

test('horizontal tabs activate and focus the target, wrap arrows and honor Home/End', () => {
  const items = ['history','routes'];
  for (const [key,current,expected] of [
    ['ArrowRight','history','routes'],
    ['ArrowRight','routes','history'],
    ['ArrowLeft','history','routes'],
    ['ArrowLeft','routes','history'],
    ['Home','routes','history'],
    ['End','history','routes'],
  ]) {
    let prevented = false, selected, focused;
    const event = {key, preventDefault: () => {prevented = true}, currentTarget:{closest: role => {
      assert.equal(role, '[role="tablist"]');
      return {querySelector: selector => ({focus: () => {focused = selector}})};
    }}};
    helpers.rubyTabKey(event, items, current, value => {selected = value});
    assert.equal(prevented, true);
    assert.equal(selected, expected);
    assert.equal(focused, '[data-tab-id="'+expected+'"]');
  }
});

test('unrelated keys and empty tab lists leave normal keyboard behavior intact', () => {
  for (const [key,items] of [['Tab',['history','routes']], ['ArrowRight',[]]]) {
    helpers.rubyTabKey({key, preventDefault: () => assert.fail('Must preserve native behavior')}, items, 'history', () => assert.fail('Must not activate a tab'));
  }
});

test('setting descriptions remain visible and switches describe their disabled reason accurately', async () => {
  const renderer = await fs.readFile(new URL('../src/recovered/renderer.js', import.meta.url), 'utf8');
  const componentStart = renderer.indexOf('function Kp(');
  const componentEnd = renderer.indexOf('function qp(', componentStart);
  assert.ok(componentStart >= 0 && componentEnd > componentStart);
  const element = (type, props) => ({type, props});
  let tooltipPosition = null;
  const renderSetting = vm.runInNewContext(renderer.slice(componentStart, componentEnd) + '\nKp', {
    O: {
      useRef: () => ({current:null}),
      useState: () => [tooltipPosition, () => {}],
      useId: () => 'setting-contract',
      useCallback: callback => callback,
      useLayoutEffect: () => {},
    },
    V: {jsx:element, jsxs:element, Fragment:Symbol('fragment')},
    dd: () => null,
    bf: 1.7,
  });
  const descendants = element => {
    if (!element || typeof element !== 'object') return [];
    const children = element.props?.children;
    return [element, ...(Array.isArray(children) ? children : [children]).flatMap(descendants)];
  };
  for (const [disabled, disabledReason, expected] of [
    [false, undefined, 'DNS runs independently of the window.'],
    [true, 'This option requires app startup.', 'This option requires app startup.'],
  ]) {
    const elements = descendants(renderSetting({checked:false, description:'DNS runs independently of the window.', disabled, disabledReason, label:'Background startup', onToggle:() => {}}));
    const description = elements.find(item => item.props?.className === 'toggle-setting-description');
    const control = elements.find(item => item.props?.role === 'switch');
    const help = elements.find(item => item.props?.className === 'toggle-setting-help');
    assert.equal(description.props.children, expected);
    assert.equal(description.props.role, undefined);
    assert.equal(control.props['aria-describedby'], description.props.id);
    assert.equal(help.props['aria-describedby'], description.props.id);
    assert.equal(help.props['aria-controls'], undefined, 'Closed help must not refer to a missing tooltip');
    assert.equal(control.props['aria-disabled'], disabled || undefined);
    assert.equal(typeof control.props.onClick, disabled ? 'undefined' : 'function');
  }
  const noDescription = descendants(renderSetting({checked:true, label:'Notifications', onToggle:() => {}}));
  assert.equal(noDescription.some(item => item.props?.className === 'toggle-setting-description'), false);
  assert.equal(noDescription.find(item => item.props?.role === 'switch').props['aria-describedby'], undefined);
  tooltipPosition = {top:10, right:10};
  const openHelp = descendants(renderSetting({checked:false, description:'DNS runs independently of the window.', label:'Background startup', onToggle:() => {}}));
  const popup = openHelp.find(item => item.props?.className === 'toggle-setting-hint visible');
  const help = openHelp.find(item => item.props?.className === 'toggle-setting-help');
  assert.equal(help.props['aria-controls'], popup.props.id);
  assert.equal(help.props['aria-describedby'], popup.props.id);
  assert.equal(help.props['aria-expanded'], true);
  assert.equal(popup.props.role, 'tooltip');
  assert.equal(popup.props['aria-hidden'], undefined, 'Actual open tooltip remains discoverable to assistive technology');
});
