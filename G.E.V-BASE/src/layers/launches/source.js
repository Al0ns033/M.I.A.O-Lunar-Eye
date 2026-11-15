/** Read launch records and their optional active-orbit catalog with explicit cancellation. */
const buildMission = ({
  id,
  name,
  launchTime,
  launchSite,
  lat,
  lon,
  provider,
  mission,
  missionName,
  status,
  orbit,
  source,
  sourceGroup,
  category,
  guideUrl,
}) => ({
  id,
  name,
  status,
  launchTime,
  launchSite,
  lat,
  lon,
  provider,
  mission,
  missionName,
  satelliteQuery: name,
  payloads: [],
  recoveryStages: [],
  trajectory: Number.isFinite(lat) && Number.isFinite(lon)
    ? [{ latitude: lat, longitude: lon, altitude: 0, stage: 'launch' }]
    : [],
  orbit: orbit ? { name: orbit } : null,
  inWindow: true,
  source,
  sourceGroup,
  missionCategory: category || 'Mission',
  guideUrl: guideUrl || null,
});

const CURATED_SPACE_MISSIONS = Object.freeze([
  buildMission({
    id: 'apollo-11',
    name: 'Apollo 11',
    status: 'Completed',
    launchTime: '1969-07-16T13:32:00.000Z',
    launchSite: 'LC-39A · Kennedy Space Center',
    lat: 28.6273,
    lon: -80.6211,
    provider: 'NASA',
    mission: 'First crewed lunar landing mission.',
    missionName: 'Apollo 11',
    orbit: 'Translunar injection',
    source: 'Apollo 11 didactic dataset',
    sourceGroup: 'USER IMPORT',
    category: 'Lunar mission',
  }),
  buildMission({
    id: 'artemis-i',
    name: 'Artemis I',
    status: 'Completed',
    launchTime: '2022-11-16T06:47:00.000Z',
    launchSite: 'LC-39B · Kennedy Space Center',
    lat: 28.6273,
    lon: -80.6211,
    provider: 'NASA',
    mission: 'Deep space test flight around the Moon.',
    missionName: 'Artemis I',
    orbit: 'Distant retrograde orbit',
    source: 'Artemis I didactic dataset',
    sourceGroup: 'USER IMPORT',
    category: 'Artemis',
  }),
  buildMission({
    id: 'artemis-ii',
    name: 'Artemis II',
    status: 'Planned',
    launchTime: '2026-01-01T00:00:00.000Z',
    launchSite: 'LC-39B · Kennedy Space Center',
    lat: 28.6273,
    lon: -80.6211,
    provider: 'NASA',
    mission: 'Crewed lunar flyby and return rehearsal.',
    missionName: 'Artemis II',
    orbit: 'Crewed translunar mission',
    source: 'Artemis II didactic dataset',
    sourceGroup: 'USER IMPORT',
    category: 'Artemis',
  }),
  buildMission({
    id: 'artemis-landing',
    name: 'Artemis Landing',
    status: 'Scenario',
    launchTime: '2028-01-01T00:00:00.000Z',
    launchSite: 'LC-39B · Kennedy Space Center',
    lat: 28.6273,
    lon: -80.6211,
    provider: 'NASA',
    mission: 'Candidate landing architecture for a future lunar descent.',
    missionName: 'Artemis Landing',
    orbit: 'Landing approach model',
    source: 'Artemis landing didactic dataset',
    sourceGroup: 'USER IMPORT',
    category: 'Lunar landing',
  }),
  buildMission({
    id: 'satellite-map',
    name: 'Satellite Map',
    status: 'Live',
    launchTime: '2026-11-14T00:00:00.000Z',
    launchSite: 'Earth orbit registry',
    lat: 0,
    lon: 0,
    provider: 'CelesTrak · JPL',
    mission: 'Earth-orbit and lunar-orbiter catalog for live tracking.',
    missionName: 'Satellite Map',
    orbit: 'Orbital catalog',
    source: 'Satellite map online package',
    sourceGroup: 'USER IMPORT',
    category: 'Orbital catalog',
  }),
]);

export function createLaunchSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  /** The launch payload, and whether the proxy served it from a stale cache. */
  async function getLaunchSnapshot({ signal } = {}) {
    signal?.throwIfAborted();
    try {
      const response = await fetchImpl('/api/launches', { signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      signal?.throwIfAborted();
      const records = Array.isArray(payload) ? payload : payload?.results;
      if (!Array.isArray(records)) {
        throw new Error('Malformed launch snapshot');
      }
      const imported = CURATED_SPACE_MISSIONS.map((mission) => ({
        ...mission,
        sourceGroup: mission.sourceGroup || 'USER IMPORT',
      }));
      const merged = [
        ...records.map((mission) => ({
          ...mission,
          sourceGroup: mission.sourceGroup || 'BUILT-IN',
        })),
        ...imported.filter(
          (mission) => !records.some((record) => record.id === mission.id),
        ),
      ];
      return {
        payload: merged.length > 0 ? merged : CURATED_SPACE_MISSIONS,
        stale: response.headers?.get?.('x-gev-cache') === 'STALE-ERROR',
      };
    } catch (error) {
      if (
        error?.name === 'AbortError' ||
        error?.message === 'Malformed launch snapshot'
      ) {
        throw error;
      }
      return {
        payload: CURATED_SPACE_MISSIONS,
        stale: false,
      };
    }
  }
  return {
    getLaunchSnapshot,
    async getLaunches(options) {
      return (await getLaunchSnapshot(options)).payload;
    },
    async getActiveTle({ signal } = {}) {
      signal?.throwIfAborted();
      const response = await fetchImpl('/api/celestrak/active', { signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      signal?.throwIfAborted();
      return text;
    },
  };
}
