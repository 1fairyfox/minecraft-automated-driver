// The semantic flow engine: one verb → many UI steps, planned over advertised capabilities.
// Fake executors that model real screen + position transitions — pure orchestration, no client.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_LABELS, readScreen, findWidget, waitFor, cycleControlTo,
  menuNavigate, serverConnect, worldCreate, worldEnter, worldLeave, settingsSet,
} from '../src/flows.mjs';

const noSleep = async () => {};
// Inject no-op sleeps everywhere a verb might poll, so tests never actually wait.
const fast = { wait: { sleep: noSleep }, arriveWait: { sleep: noSleep, tries: 8, delayMs: 0 } };

/**
 * A screen-graph fake client. `screens` is an array of nodes:
 *   { screen, buttons:[{label,to?}], cyclers:[{label,values,i}], field?, escTo? }
 * `click` advances navigation (button.to) or cycles a cycler; `close` follows escTo;
 * `position` may be a value or (idx)=>value so arrival can flip after a click.
 */
function client({ caps = ['screen', 'click', 'type', 'position', 'close'], screens, start = 0, position } = {}) {
  let idx = start;
  const calls = [];
  const set = new Set(caps);
  const cur = () => screens[idx];
  const render = () => {
    const s = cur();
    const widgets = [];
    for (const b of s.buttons ?? []) widgets.push({ label: b.label, type: 'Button' });
    for (const c of s.cyclers ?? []) widgets.push({ label: `${c.label}: ${c.values[c.i]}`, type: 'CyclingButton' });
    if (s.field) widgets.push({ label: s.fieldLabel ?? 'Field', type: 'EditBox' });
    return { screen: s.screen, widgets };
  };
  return {
    id: 'cli', calls,
    has: (c) => set.has(c),
    invoke: async (cap, args = {}) => {
      calls.push({ cap, args });
      const s = cur();
      if (cap === 'screen') return { tree: JSON.stringify(render()) };
      if (cap === 'type') return { typed: true, text: args.text };
      if (cap === 'close') { if (s.escTo != null) idx = s.escTo; return { closed: true }; }
      if (cap === 'position') return typeof position === 'function' ? position(idx) : (position ?? { inWorld: false });
      if (cap === 'world_select') return { selected: true };
      if (cap === 'click') {
        const name = String(args.name).toLowerCase();
        const cyc = (s.cyclers ?? []).find((c) => c.label.toLowerCase().includes(name));
        if (cyc) { cyc.i = (cyc.i + 1) % cyc.values.length; return { clicked: true }; }
        const btn = (s.buttons ?? []).find((b) => b.label === args.name || b.label.toLowerCase().includes(name));
        if (!btn) throw new Error(`fake: no button '${args.name}' on ${s.screen}`);
        if (btn.to != null) idx = btn.to;
        return { clicked: true };
      }
      throw new Error(`fake: no handler ${cap}`);
    },
  };
}

// ── readScreen ───────────────────────────────────────────────────────────────

test('readScreen parses a string tree, a raw object, and defaults an absent tree', async () => {
  const asString = { has: () => true, invoke: async () => ({ tree: JSON.stringify({ screen: 'A', widgets: [{ label: 'X' }] }) }) };
  assert.deepEqual(await readScreen(asString), { screen: 'A', widgets: [{ label: 'X' }] });

  const asObject = { has: () => true, invoke: async () => ({ screen: 'B' }) }; // no .tree, no widgets
  assert.deepEqual(await readScreen(asObject), { screen: 'B', widgets: [] });

  const empty = { has: () => true, invoke: async () => undefined };
  assert.deepEqual(await readScreen(empty), { screen: null, widgets: [] });
});

// ── findWidget ───────────────────────────────────────────────────────────────

test('findWidget: exact wins, unique substring matches, ambiguity throws, absence is null', () => {
  const s = { widgets: [{ label: 'Options' }, { label: 'Options...' }, { label: 'Quit Game' }] };
  assert.equal(findWidget(s, 'Options').label, 'Options');                 // exact beats substring
  assert.equal(findWidget(s, 'Quit').label, 'Quit Game');                  // unique substring
  assert.throws(() => findWidget(s, 'Option'), /ambiguous/);               // two substring matches
  assert.equal(findWidget(s, 'Nope'), null);                              // absent
  assert.equal(findWidget(s, 'Option', { fuzzy: false }), null);           // no exact, fuzzy off
  assert.throws(() => findWidget({ widgets: [{ label: 'Go' }, { label: 'Go' }] }, 'Go'), /exact matches/);
});

// ── waitFor ──────────────────────────────────────────────────────────────────

test('waitFor resolves immediately, after polling, and throws with err.last', async () => {
  assert.equal(await waitFor(() => 7, (v) => v === 7), 7);

  let n = 0; let slept = 0;
  const v = await waitFor(() => ++n, (x) => x === 3, { sleep: async () => { slept++; }, delayMs: 1 });
  assert.equal(v, 3);
  assert.equal(slept, 2); // slept between the three polls

  await assert.rejects(
    () => waitFor(() => 'stuck', () => false, { tries: 3, sleep: noSleep }),
    (err) => { assert.match(err.message, /not met in time/); assert.equal(err.last, 'stuck'); return true; },
  );
});

// ── menuNavigate ─────────────────────────────────────────────────────────────

test('menuNavigate clicks a path and confirms the destination landmark', async () => {
  const c = client({ screens: [
    { screen: 'Title', buttons: [{ label: 'Multiplayer', to: 1 }] },
    { screen: 'Servers', buttons: [{ label: 'Direct Connection', to: 2 }] },
    { screen: 'Direct', buttons: [{ label: 'Join Server' }] },
  ] });
  const res = await menuNavigate(c, { path: ['Multiplayer', 'Direct Connection'], expect: 'Join Server' }, fast);
  assert.deepEqual(res.clicked, ['Multiplayer', 'Direct Connection']);
  assert.equal(res.screen, 'Direct');
  assert.ok(res.widgets.includes('Join Server'));
});

test('menuNavigate tolerates an ambiguous landmark (present, just not unique)', async () => {
  const c = client({ screens: [{ screen: 'Dup', buttons: [{ label: 'Play' }, { label: 'Play' }] }] });
  const res = await menuNavigate(c, { path: ['Play'] }, fast); // hasWidget catches the ambiguity → present
  assert.deepEqual(res.clicked, ['Play']);
});

test('menuNavigate rejects a missing capability and an empty path', async () => {
  const noClick = { id: 'x', has: (cap) => cap === 'screen', invoke: async () => ({}) };
  await assert.rejects(() => menuNavigate(noClick, { path: ['A'] }), /cannot navigate menus: missing capability click/);
  const ok = client({ screens: [{ screen: 'S', buttons: [] }] });
  await assert.rejects(() => menuNavigate(ok, { path: [] }), /non-empty path/);
});

// ── serverConnect ────────────────────────────────────────────────────────────

test('serverConnect walks the menus, types the address, joins, and waits for the world', async () => {
  const c = client({
    caps: ['screen', 'click', 'type', 'position'],
    screens: [
      { screen: 'Title', buttons: [{ label: 'Multiplayer', to: 1 }] },
      { screen: 'Servers', buttons: [{ label: 'Direct Connection', to: 2 }] },
      { screen: 'Direct', field: true, buttons: [{ label: 'Join Server', to: 3 }] },
      { screen: 'InGame', buttons: [] },
    ],
    position: (idx) => ({ inWorld: idx >= 3, x: 0, y: 64, z: 0 }),
  });
  const res = await serverConnect(c, { address: 'localhost:25565', labels: { addressField: 'Server Address' } }, fast);
  assert.equal(res.connected, true);
  assert.equal(res.position.inWorld, true);
  const typed = c.calls.find((k) => k.cap === 'type');
  assert.equal(typed.args.text, 'localhost:25565');
  assert.equal(typed.args.name, 'Server Address'); // addressField override forwarded
});

test('serverConnect rejects missing caps and a missing address', async () => {
  await assert.rejects(() => serverConnect({ id: 'y', has: () => false }, { address: 'x' }), /cannot connect to a server/);
  const c = client({ caps: ['screen', 'click', 'type', 'position'], screens: [{ screen: 'T', buttons: [] }] });
  await assert.rejects(() => serverConnect(c, {}), /needs an address/);
});

// ── worldCreate ──────────────────────────────────────────────────────────────

test('worldCreate names the world and enters it', async () => {
  const c = client({
    caps: ['screen', 'click', 'type', 'position'],
    screens: [
      { screen: 'Title', buttons: [{ label: 'Singleplayer', to: 1 }] },
      { screen: 'Select', buttons: [{ label: 'Create New World', to: 2 }] },
      { screen: 'Create', field: true, buttons: [{ label: 'Create New World', to: 3 }] },
      { screen: 'InGame', buttons: [] },
    ],
    position: (idx) => ({ inWorld: idx >= 3 }),
  });
  const res = await worldCreate(c, { name: 'TestWorld' }, fast);
  assert.equal(res.created, true);
  assert.equal(res.name, 'TestWorld');
  assert.equal(res.gameMode, null);
  assert.equal(c.calls.find((k) => k.cap === 'type').args.text, 'TestWorld');
});

test('worldCreate cycles the game mode to the requested value before creating', async () => {
  const c = client({
    caps: ['screen', 'click', 'type', 'position'],
    screens: [
      { screen: 'Title', buttons: [{ label: 'Singleplayer', to: 1 }] },
      { screen: 'Select', buttons: [{ label: 'Create New World', to: 2 }] },
      { screen: 'Create', field: true, cyclers: [{ label: 'Game Mode', values: ['Survival', 'Creative'], i: 0 }], buttons: [{ label: 'Create New World', to: 3 }] },
      { screen: 'InGame', buttons: [] },
    ],
    position: (idx) => ({ inWorld: idx >= 3 }),
  });
  const res = await worldCreate(c, { name: 'Flat', gameMode: 'Creative' }, fast);
  assert.equal(res.gameMode, 'Creative');
  assert.equal(res.position.inWorld, true);
});

test('worldCreate rejects missing caps and a missing name', async () => {
  await assert.rejects(() => worldCreate({ id: 'z', has: () => false }, { name: 'x' }), /cannot create a world/);
  const c = client({ caps: ['screen', 'click', 'type', 'position'], screens: [{ screen: 'T', buttons: [] }] });
  await assert.rejects(() => worldCreate(c, {}), /needs a world name/);
});

// ── worldEnter ───────────────────────────────────────────────────────────────

test('worldEnter selects an existing world when world_select is advertised', async () => {
  const c = client({
    caps: ['screen', 'click', 'position', 'world_select'],
    screens: [
      { screen: 'Title', buttons: [{ label: 'Singleplayer', to: 1 }] },
      { screen: 'Select', buttons: [{ label: 'Play Selected World', to: 2 }] },
      { screen: 'InGame', buttons: [] },
    ],
    position: (idx) => ({ inWorld: idx >= 2 }),
  });
  const res = await worldEnter(c, { name: 'Saved' }, fast);
  assert.equal(res.entered, true);
  assert.ok(c.calls.some((k) => k.cap === 'world_select' && k.args.name === 'Saved'));
});

test('worldEnter points to the forward capability when world_select is absent, and needs a name', async () => {
  const c = client({
    caps: ['screen', 'click', 'position'],
    screens: [{ screen: 'Title', buttons: [{ label: 'Singleplayer', to: 1 }] }, { screen: 'Select', buttons: [] }],
  });
  await assert.rejects(() => worldEnter(c, { name: 'Saved' }, fast), /world_select/);
  await assert.rejects(() => worldEnter(c, {}), /needs a world name/);
});

// ── worldLeave ───────────────────────────────────────────────────────────────

test('worldLeave escapes to the pause menu, saves+quits, and waits for the menu', async () => {
  const c = client({
    caps: ['screen', 'click', 'close', 'position'],
    screens: [
      { screen: 'InGame', escTo: 1, buttons: [] },
      { screen: 'Pause', buttons: [{ label: 'Save and Quit to Title', to: 2 }] },
      { screen: 'Title', buttons: [] },
    ],
    position: (idx) => ({ inWorld: idx < 1 }),
  });
  const res = await worldLeave(c, {}, fast);
  assert.equal(res.left, true);
  assert.equal(res.saved, true);
  assert.equal(res.position.inWorld, false);
});

test('worldLeave rejects missing caps and a target not in a world', async () => {
  await assert.rejects(() => worldLeave({ id: 'w', has: () => false }, {}), /cannot leave a world/);
  const c = client({ caps: ['screen', 'click', 'close', 'position'], screens: [{ screen: 'Title', buttons: [] }], position: { inWorld: false } });
  await assert.rejects(() => worldLeave(c, {}, fast), /not in a world/);
});

// ── settingsSet + cycleControlTo ─────────────────────────────────────────────

test('settingsSet flips a boolean toggle to ON', async () => {
  const c = client({
    caps: ['screen', 'click'],
    screens: [
      { screen: 'Title', buttons: [{ label: 'Options', to: 1 }] },
      { screen: 'Options', cyclers: [{ label: 'Sound', values: ['OFF', 'ON'], i: 0 }] },
    ],
  });
  const res = await settingsSet(c, { control: 'Sound', value: true }, fast);
  assert.equal(res.to, true);
  assert.equal(res.control, 'Sound: ON');
});

test('settingsSet cycles a string value and can click Done', async () => {
  const c = client({
    caps: ['screen', 'click'],
    screens: [
      { screen: 'Title', buttons: [{ label: 'Options', to: 1 }] },
      { screen: 'Options', cyclers: [{ label: 'Difficulty', values: ['Peaceful', 'Easy', 'Normal', 'Hard'], i: 0 }], buttons: [{ label: 'Done' }] },
    ],
  });
  const res = await settingsSet(c, { control: 'Difficulty', value: 'Hard', back: true }, fast);
  assert.equal(res.control, 'Difficulty: Hard');
  assert.ok(c.calls.some((k) => k.cap === 'click' && k.args.name === 'Done'));
});

test('settingsSet traverses sub-screens via path', async () => {
  const c = client({
    caps: ['screen', 'click'],
    screens: [
      { screen: 'Title', buttons: [{ label: 'Options', to: 1 }] },
      { screen: 'Options', buttons: [{ label: 'Controls', to: 2 }] },
      { screen: 'Controls', cyclers: [{ label: 'Auto-Jump', values: ['OFF', 'ON'], i: 0 }] },
    ],
  });
  const res = await settingsSet(c, { control: 'Auto-Jump', value: false, path: ['Controls'] }, fast);
  assert.equal(res.control, 'Auto-Jump: OFF'); // already OFF → 0 clicks
  assert.equal(res.clicks, 0);
});

test('serverConnect works without an address-field label override (sole field)', async () => {
  const c = client({
    caps: ['screen', 'click', 'type', 'position'],
    screens: [
      { screen: 'Title', buttons: [{ label: 'Multiplayer', to: 1 }] },
      { screen: 'Servers', buttons: [{ label: 'Direct Connection', to: 2 }] },
      { screen: 'Direct', field: true, buttons: [{ label: 'Join Server', to: 3 }] },
      { screen: 'InGame', buttons: [] },
    ],
    position: (idx) => ({ inWorld: idx >= 3 }),
  });
  const res = await serverConnect(c, { address: '127.0.0.1' }, fast); // no labels.addressField
  assert.equal(res.connected, true);
  const typed = c.calls.find((k) => k.cap === 'type');
  assert.equal(typed.args.text, '127.0.0.1');
  assert.equal(typed.args.name, undefined); // falsy override → no name forwarded
});

test('settingsSet validates inputs and refuses sliders', async () => {
  const c = client({ caps: ['screen', 'click'], screens: [{ screen: 'T', buttons: [] }] });
  await assert.rejects(() => settingsSet({ id: 's', has: () => false }, { control: 'X', value: true }), /cannot change settings/);
  await assert.rejects(() => settingsSet(c, { value: true }), /needs a control/);
  await assert.rejects(() => settingsSet(c, { control: 'X' }), /needs a value/);
  await assert.rejects(() => settingsSet(c, { control: 'FOV', value: 70 }), /slider/);
});

test('settingsSet surfaces an unknown control and a value it cannot reach', async () => {
  const missing = client({
    caps: ['screen', 'click'],
    screens: [{ screen: 'Title', buttons: [{ label: 'Options', to: 1 }] }, { screen: 'Options', cyclers: [{ label: 'Sound', values: ['OFF', 'ON'], i: 0 }] }],
  });
  await assert.rejects(() => settingsSet(missing, { control: 'Nonexistent', value: 'ON' }, fast), /no control 'Nonexistent'/);
  const stuck = client({
    caps: ['screen', 'click'],
    screens: [{ screen: 'Title', buttons: [{ label: 'Options', to: 1 }] }, { screen: 'Options', cyclers: [{ label: 'Mode', values: ['A', 'B'], i: 0 }] }],
  });
  await assert.rejects(() => settingsSet(stuck, { control: 'Mode', value: 'Z', ...{} }, { ...fast, cycle: { maxClicks: 2 } }), /could not set 'Mode' to 'Z'/);
});

test('cycleControlTo refuses a numeric target and matches a colon-less label', async () => {
  const slider = client({ caps: ['screen', 'click'], screens: [{ screen: 'O', cyclers: [{ label: 'Vol', values: ['x'], i: 0 }] }] });
  await assert.rejects(() => cycleControlTo(slider, 'Vol', 5), /sliders need the agent slider op/);

  const plain = { has: () => true, invoke: async (cap) => (cap === 'screen' ? { tree: JSON.stringify({ screen: 'O', widgets: [{ label: 'Fancy' }] }) } : { clicked: true }) };
  assert.deepEqual(await cycleControlTo(plain, 'Fancy', 'Fancy'), { control: 'Fancy', clicks: 0 });
});

test('DEFAULT_LABELS exposes overridable English defaults', () => {
  assert.equal(DEFAULT_LABELS.join, 'Join Server');
  assert.equal(DEFAULT_LABELS.quit, 'Save and Quit to Title');
});
