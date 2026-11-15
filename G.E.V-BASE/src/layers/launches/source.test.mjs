import test from 'node:test';
import assert from 'node:assert/strict';
import { createLaunchSource } from './source.js';
import { createRocketLaunchesLayer } from './index.js';
import { chooseDefaultMissionSelection } from './selection.js';

test('launch sources preserve last-good eligibility by rejecting malformed snapshots', async () => {
  for (const payload of [{}, { results: null }]) {
    const source = createLaunchSource({
      fetchImpl: async () => new Response(JSON.stringify(payload)),
    });
    await assert.rejects(source.getLaunches(), /Malformed launch snapshot/);
  }
});

test('launch and active-orbit responses reject cancellation during parsing', async () => {
  for (const method of ['getLaunches', 'getActiveTle']) {
    const controller = new AbortController();
    const source = createLaunchSource({
      fetchImpl: async () => ({
        ok: true,
        async json() {
          controller.abort();
          return { results: [] };
        },
        async text() {
          controller.abort();
          return 'late orbit';
        },
      }),
    });
    await assert.rejects(source[method]({ signal: controller.signal }), {
      name: 'AbortError',
    });
  }
});

test('launch factories construct independently without starting a scene or source request', () => {
  const source = {
    getLaunches() {
      assert.fail('construction fetched launches');
    },
    getActiveTle() {
      assert.fail('construction fetched orbits');
    },
  };
  const services = { satellites: {}, geometry: {}, overlays: {}, render: {} };
  const first = createRocketLaunchesLayer({ source, services });
  const second = createRocketLaunchesLayer({ source, services });
  first._setSelectedRocketMissionForTest('first');
  assert.notEqual(first, second);
  assert.equal(first.getStats().count, 0);
  assert.equal(second.getStats().count, 0);
});

test('Apollo 11 fallback mission remains eligible even though it is a historical mission', () => {
  const source = createLaunchSource({
    fetchImpl: async () => ({
      ok: true,
      headers: { get: () => null },
      async json() {
        return [
          {
            id: 'apollo-11',
            name: 'Apollo 11',
            launchTime: '1969-07-16T13:32:00.000Z',
            lat: 28.6273,
            lon: -80.6211,
            inWindow: true,
            source: 'Apollo 11 didactic dataset',
            mission: 'First crewed lunar landing mission.',
            missionName: 'Apollo 11',
          },
        ];
      },
    }),
  });
  const layer = createRocketLaunchesLayer({
    source,
    services: { satellites: {}, geometry: {}, overlays: {}, render: {} },
  });
  const launches = layer.normalizeRocketLaunches([
    {
      id: 'apollo-11',
      name: 'Apollo 11',
      launchTime: '1969-07-16T13:32:00.000Z',
      lat: 28.6273,
      lon: -80.6211,
      inWindow: true,
      source: 'Apollo 11 didactic dataset',
      mission: 'First crewed lunar landing mission.',
      missionName: 'Apollo 11',
      status: 'Completed',
    },
  ]);

  assert.equal(launches.length, 1);
  assert.equal(launches[0].id, 'apollo-11');
  assert.equal(launches[0].source, 'Apollo 11 didactic dataset');
  assert.equal(launches[0].inWindow, true);
});

test('a no-selection state falls back to a valid mission instead of showing all trajectories at once', () => {
  const launches = [
    { id: 'artemis-i', name: 'Artemis I' },
    { id: 'apollo-11', name: 'Apollo 11' },
  ];

  assert.equal(chooseDefaultMissionSelection(launches, null), 'apollo-11');
  assert.equal(chooseDefaultMissionSelection(launches, 'artemis-i'), 'artemis-i');
  assert.equal(chooseDefaultMissionSelection([], null), null);
});
