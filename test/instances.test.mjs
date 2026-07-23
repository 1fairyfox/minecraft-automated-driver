// Unit layer: the instance registry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInstanceRegistry } from '../src/instances.mjs';

test('add assigns sequential ids and stores the record', () => {
  const reg = createInstanceRegistry();
  const a = reg.add({ kind: 'spawned', pid: 100, command: 'a.exe' });
  const b = reg.add({ kind: 'spawned', pid: 200, title: 'B' });
  assert.equal(a.id, 'i1');
  assert.equal(b.id, 'i2');
  assert.equal(a.title, null);
  assert.equal(b.command, null);
  assert.match(a.openedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('get returns the record or null', () => {
  const reg = createInstanceRegistry();
  const a = reg.add({ kind: 'spawned', pid: 1 });
  assert.equal(reg.get(a.id), a);
  assert.equal(reg.get('nope'), null);
});

test('remove deletes and reports; list reflects state', () => {
  const reg = createInstanceRegistry();
  const a = reg.add({ kind: 'spawned', pid: 1 });
  const b = reg.add({ kind: 'spawned', pid: 2 });
  assert.equal(reg.list().length, 2);
  assert.equal(reg.remove(a.id), true);
  assert.equal(reg.remove(a.id), false);
  assert.deepEqual(reg.list(), [b]);
});

test('registries are independent (no shared counter)', () => {
  const one = createInstanceRegistry();
  const two = createInstanceRegistry();
  one.add({ kind: 'spawned', pid: 1 });
  assert.equal(two.add({ kind: 'spawned', pid: 2 }).id, 'i1');
});
