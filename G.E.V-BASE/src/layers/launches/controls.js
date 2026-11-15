export function createControls({ state: layerState, services, parts, source }) {
  const methods = {
    id: 'rocket-launches',

    name: 'Space Missions',

    icon: '🌙',

    source: 'Apollo 11 didactic dataset',

    updateInterval: 300000,

    /** Release only Space Mission camera ownership, preserving layer and selection state. */
    releaseCameraOwnership() {
      parts.panel.clearMissionRosterHover();
      parts.replay.stopMissionReplay();
      parts.selection.stopMissionZoomAnchor();
    },

    getStats() {
      return {
        count: layerState._count,
        orbitMatches: layerState._orbitMatches,
        lastUpdate: layerState._lastUpdate,
        error: layerState._lastError,
      };
    },

    attachDataManager(dataManager) {
      layerState._dataManager = dataManager;
    },
  };

  return { methods };
}
