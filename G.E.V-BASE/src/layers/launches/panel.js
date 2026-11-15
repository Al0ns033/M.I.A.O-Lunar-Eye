import * as Cesium from 'cesium';
import {
  MISSION_CLOSE_VIEW_RANGE_M,
  MISSION_GLOBE_VIEW_RANGE_M,
} from './policy.js';

export function createPanel({ state: layerState, services, parts, source }) {
  /**
   * Preserve the user's globe scale for roster previews while avoiding an
   * accidental surface-level fly-to when the list is opened from a close view.
   * @param {number} cameraHeight Current camera height above the ellipsoid.
   * @returns {number} Preview range in metres.
   */

  function missionHoverPreviewRange(cameraHeight) {
    const height = Number(cameraHeight);
    return Math.max(
      MISSION_CLOSE_VIEW_RANGE_M,
      Number.isFinite(height) ? height : MISSION_GLOBE_VIEW_RANGE_M,
    );
  }

  /**
   * Coordinate pointer and keyboard ownership of the temporary roster preview.
   * The most recent input owns the preview until it leaves, then any remaining
   * input resumes ownership. This lets keyboard focus take over from a pointer
   * resting on another row without losing that pointer preview on blur.
   * @param {{preview: (index: number) => void, clear: () => void}} handlers
   * @returns {{pointerEnter: (index: number) => void, pointerLeave: () => void,
   *   focus: (index: number) => void, blur: (nextIndex?: number|null) => void,
   *   reset: () => void}}
   */

  function createMissionRosterPreviewOwnership({ preview, clear }) {
    let pointerIndex = null;
    let focusIndex = null;
    let latestOwner = null;
    let activeIndex = null;

    const sync = () => {
      const nextIndex =
        latestOwner === 'pointer'
          ? (pointerIndex ?? focusIndex)
          : (focusIndex ?? pointerIndex);
      if (nextIndex === activeIndex) return;
      activeIndex = nextIndex;
      if (Number.isInteger(nextIndex)) preview(nextIndex);
      else clear();
    };

    return {
      pointerEnter(index) {
        pointerIndex = index;
        latestOwner = 'pointer';
        sync();
      },
      pointerLeave() {
        pointerIndex = null;
        if (latestOwner === 'pointer')
          latestOwner = focusIndex === null ? null : 'focus';
        sync();
      },
      focus(index) {
        focusIndex = index;
        latestOwner = 'focus';
        sync();
      },
      blur(nextIndex = null) {
        focusIndex = Number.isInteger(nextIndex) ? nextIndex : null;
        if (latestOwner === 'focus')
          latestOwner =
            focusIndex === null
              ? pointerIndex === null
                ? null
                : 'pointer'
              : 'focus';
        sync();
      },
      reset() {
        pointerIndex = null;
        focusIndex = null;
        latestOwner = null;
        activeIndex = null;
        clear();
      },
    };
  }

  /**
   * Bind native keyboard focus events for one rendered roster row.
   * @param {Element} button Mission roster button.
   * @param {number} index Source-array mission index.
   * @param {{pointerEnter: (index: number) => void, pointerLeave: () => void,
   *   focus: (index: number) => void, blur: (nextIndex?: number|null) => void}} ownership
   * @param {Element} roster Roster root used to reject focus targets outside the list.
   */

  function bindMissionRosterItemKeyboardPreview(
    button,
    index,
    ownership,
    roster,
  ) {
    button.addEventListener('mouseenter', () => ownership.pointerEnter(index));
    button.addEventListener('mouseleave', () => ownership.pointerLeave());
    button.addEventListener('focus', () => ownership.focus(index));
    button.addEventListener('blur', (event) => {
      const nextButton = event.relatedTarget?.closest?.(
        '[data-mission-roster-index]',
      );
      const nextIndex =
        nextButton && roster.contains(nextButton)
          ? Number(nextButton.dataset.missionRosterIndex)
          : null;
      ownership.blur(nextIndex);
    });
  }

  /** Capture the exact mission identity owned by keyboard focus before a refresh. */

  function captureMissionRosterFocus(
    list,
    activeElement = globalThis.document?.activeElement,
  ) {
    const button = activeElement?.closest?.('[data-mission-roster-id]');
    if (!button || !list?.contains(button)) return null;
    const launchId = button.dataset.missionRosterId;
    return launchId ? { launchId } : null;
  }

  /** Restore focus by mission identity, or continue after the list if it departed. */

  function restoreMissionRosterFocus(list, snapshot, continuation) {
    if (!snapshot?.launchId) return 'none';
    const button = Array.from(
      list?.querySelectorAll?.('[data-mission-roster-id]') || [],
    ).find(
      (candidate) => candidate.dataset.missionRosterId === snapshot.launchId,
    );
    if (button) {
      button.focus({ preventScroll: true });
      return 'restored';
    }
    if (continuation?.focus) {
      continuation.focus({ preventScroll: true });
      return 'continued';
    }
    return 'none';
  }

  /** Resolve a pending preview against the current refresh, never a stale object. */

  function resolveMissionRosterPreviewLaunch(launches, launchId) {
    return (
      (launches || []).find((candidate) => candidate.id === launchId) || null
    );
  }

  const LUNAR_SITE_OPTIONS = Object.freeze([
    { id: 'south-pole', name: 'South Pole', lat: -89.9, lon: 0 },
    { id: 'shackleton', name: 'Shackleton Crater', lat: -89.8, lon: 0 },
    { id: 'nobile', name: 'Nobile Basin', lat: -84.5, lon: 30 },
    { id: 'amundsen', name: 'Amundsen Crater', lat: -84.6, lon: 83.7 },
    { id: 'tycho', name: 'Tycho Crater', lat: -43.3, lon: -11.2 },
    { id: 'mare-imbrium', name: 'Mare Imbrium', lat: 32.8, lon: -15.6 },
  ]);

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function toRadians(degrees) {
    return (degrees * Math.PI) / 180;
  }

  function fromLatLonToCartesian(latDeg, lonDeg) {
    const lat = toRadians(latDeg);
    const lon = toRadians(lonDeg);
    const x = Math.cos(lat) * Math.cos(lon);
    const y = Math.cos(lat) * Math.sin(lon);
    const z = Math.sin(lat);
    return { x, y, z };
  }

  function computeLandingSiteMetrics(site, dateIso, timeIso) {
    const siteRecord = site || LUNAR_SITE_OPTIONS[0];
    const dateTime = new Date(`${dateIso || '2026-01-01'}T${timeIso || '12:00'}:00Z`);
    if (Number.isNaN(dateTime.getTime())) {
      return {
        sunElevation: 0,
        earthElevation: 0,
        powerPotential: 0,
        earthVisible: false,
        daylight: false,
        windowHours: 0,
      };
    }
    const julian = Cesium.JulianDate.fromDate(dateTime);
    const sunInertial = new Cesium.Cartesian3();
    const moonInertial = new Cesium.Cartesian3();
    Cesium.Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(
      julian,
      sunInertial,
    );
    Cesium.Simon1994PlanetaryPositions.computeMoonPositionInEarthInertialFrame(
      julian,
      moonInertial,
    );
    const sunNormal = Cesium.Cartesian3.normalize(sunInertial, new Cesium.Cartesian3());
    const earthNormal = Cesium.Cartesian3.normalize(
      Cesium.Cartesian3.negate(moonInertial, new Cesium.Cartesian3()),
      new Cesium.Cartesian3(),
    );
    const siteNormal = fromLatLonToCartesian(siteRecord.lat, siteRecord.lon);
    const sunDot =
      siteNormal.x * sunNormal.x +
      siteNormal.y * sunNormal.y +
      siteNormal.z * sunNormal.z;
    const earthDot =
      siteNormal.x * earthNormal.x +
      siteNormal.y * earthNormal.y +
      siteNormal.z * earthNormal.z;
    const sunElevation = Math.asin(clamp(sunDot, -1, 1)) * (180 / Math.PI);
    const earthElevation = Math.asin(clamp(earthDot, -1, 1)) * (180 / Math.PI);
    const daylight = sunElevation > 0;
    const earthVisible = earthElevation > 0;
    const powerPotential = clamp(((sunElevation + 10) / 90) * 100, 0, 100);
    const windowHours = earthVisible ? clamp(Math.round((earthElevation / 90) * 14 + 2), 2, 16) : 0;
    return {
      sunElevation,
      earthElevation,
      powerPotential,
      daylight,
      earthVisible,
      windowHours,
    };
  }

  function missionTableRows(items, columns, emptyText) {
    if (!items.length)
      return `<tr><td colspan="${columns}" class="mission-table-empty">${emptyText}</td></tr>`;
    return items.map((item) => item).join('');
  }

  function setMissionPanelField(selector, value, title = '') {
    const output = layerState._missionPanel?.querySelector(selector);
    if (!output) return;
    const row = output.closest('[data-mission-field]');
    const available =
      value !== null && value !== undefined && String(value).trim() !== '';
    if (row) row.hidden = !available;
    if (!available) {
      output.textContent = '';
      output.removeAttribute('title');
      return;
    }
    output.textContent = value;
    if (title) output.title = title;
    else output.removeAttribute('title');
  }

  function renderMissionPanel() {
    if (!layerState._missionPanel) return;
    const launch = layerState._launches.find(
      (item) => item.id === layerState._selectedLaunchId,
    );
    const index = launch ? layerState._launches.indexOf(launch) : -1;
    layerState._missionPanel.hidden = !launch;
    if (!launch) return;
    layerState._missionPanel.querySelector('[data-mission-title]').textContent =
      parts.overlays.shortMissionLabel(launch.name, 32).toUpperCase();
    setMissionPanelField('[data-mission-provider]', launch.provider);
    setMissionPanelField('[data-mission-status]', launch.status);
    setMissionPanelField(
      '[data-mission-site]',
      launch.launchSite && launch.launchSite !== 'Unknown launch site'
        ? launch.launchSite
        : null,
    );
    setMissionPanelField('[data-mission-time]', launch.launchTime);
    const pathPresentation = parts.policyHelpers.missionPathPresentation(
      launch,
      layerState._replayTracks.has(launch.id),
    );
    setMissionPanelField('[data-mission-orbit]', pathPresentation.orbit);
    layerState._missionPanel.querySelector(
      '[data-mission-ascent-source]',
    ).textContent = pathPresentation.ascent;
    const guideLink = layerState._missionPanel.querySelector(
      '[data-mission-guide-link]',
    );
    if (guideLink) {
      if (launch.guideUrl) {
        guideLink.href = launch.guideUrl;
        guideLink.hidden = false;
      } else {
        guideLink.hidden = true;
        guideLink.removeAttribute('href');
      }
    }
    const payloadRows = launch.payloads.length
      ? launch.payloads.slice(0, 5).map((payload) => {
          const detail = [
            payload.manufacturer,
            payload.operator && payload.operator !== payload.manufacturer
              ? payload.operator
              : null,
            Number.isFinite(payload.massKg)
              ? `${payload.massKg.toLocaleString()} KG`
              : null,
          ]
            .filter(Boolean)
            .join(' · ');
          return `<tr><td>${escapeMissionText(payload.name)}${payload.amount > 1 ? ` ×${payload.amount}` : ''}${detail ? `<small>${escapeMissionText(detail)}</small>` : ''}</td><td>${escapeMissionText(payload.type || 'UNSPECIFIED')}</td><td>${escapeMissionText(payload.destination || launch.orbit?.name || 'UNAVAILABLE')}</td></tr>`;
        })
      : [];
    if (launch.payloads.length > 5) {
      payloadRows.push(
        `<tr><td colspan="3" class="mission-table-empty">+${launch.payloads.length - 5} additional payload records</td></tr>`,
      );
    }
    layerState._missionPanel.querySelector(
      '[data-mission-payloads]',
    ).innerHTML = missionTableRows(payloadRows, 3, 'PAYLOAD DATA UNAVAILABLE');
    const stageRows = launch.recoveryStages.map((stage) => {
      const endpoint = stage.endpoint;
      const destination =
        stage.destination ||
        (endpoint?.accuracy === 'PAD / RTLS'
          ? launch.launchSite
          : 'UNAVAILABLE');
      const position = endpoint
        ? `${endpoint.lat.toFixed(2)}, ${endpoint.lon.toFixed(2)} · ${endpoint.accuracy}`
        : stage.downrangeKm > 0
          ? `${stage.downrangeKm.toLocaleString()} KM DOWNRANGE`
          : 'POSITION UNAVAILABLE';
      const stageDetail = [
        Number.isFinite(stage.flightNumber)
          ? `FLIGHT ${stage.flightNumber}`
          : null,
        stage.reused ? 'REUSED' : null,
        stage.recoveryType,
      ]
        .filter(Boolean)
        .join(' · ');
      return `<tr><td>${escapeMissionText(stage.name)}${stageDetail ? `<small>${escapeMissionText(stageDetail)}</small>` : ''}</td><td>${escapeMissionText(stage.status)}</td><td>${escapeMissionText(destination)}<small>${escapeMissionText(position)}</small></td></tr>`;
    });
    layerState._missionPanel.querySelector('[data-mission-stages]').innerHTML =
      missionTableRows(stageRows, 3, 'NO STAGE RE-ENTRY / RECOVERY DATA');
    const stageSection = layerState._missionPanel.querySelector(
      '[data-mission-stages-section]',
    );
    if (stageSection) stageSection.hidden = stageRows.length === 0;
    updateMissionTelemetry(true);
    layerState._missionPanel.querySelector('[data-mission-index]').textContent =
      `${index + 1} / ${layerState._launches.length}`;
    layerState._missionPanel.querySelector('[data-mission-prev]').disabled =
      index <= 0;
    layerState._missionPanel.querySelector('[data-mission-next]').disabled =
      index < 0 || index >= layerState._launches.length - 1;
    parts.replay.syncReplayButton();
    const panelScroller = layerState._missionPanel.closest(
      ":root[data-ui-theme='cyber'] .cyber-panel-body, .global-context-panel-inner",
    );
    if (panelScroller) panelScroller.scrollTop = 0;
  }

  function renderMissionRoster() {
    if (!layerState._missionRoster) return;
    const list = layerState._missionRoster.querySelector(
      '[data-mission-roster-list]',
    );
    const count = layerState._missionRoster.querySelector(
      '[data-mission-roster-count]',
    );
    if (count) count.textContent = `${layerState._launches.length} / 30D`;
    if (!list) return;
    const focusSnapshot = captureMissionRosterFocus(list);
    layerState._missionRosterPreviewOwnership?.reset();
    const entries = parts.policyHelpers.missionRosterEntries(
      layerState._launches,
    );
    if (!entries.length) {
      list.innerHTML =
        '<div class="space-mission-roster-empty">NO MISSIONS AVAILABLE IN THE CURRENT 30-DAY WINDOW</div>';
      restoreMissionRosterFocus(
        list,
        focusSnapshot,
        layerState._missionRoster.querySelector(
          '[data-mission-roster-focus-continuation]',
        ),
      );
      return;
    }
    list.innerHTML = entries
      .map(({ launch, index }) => {
        const color = parts.model.missionMarkerColor(launch).toCssColorString();
        const date = launch.launchTime?.slice(0, 10) || 'DATE UNAVAILABLE';
        const provider = launch.provider || 'UNSPECIFIED OPERATOR';
        const sourceGroup = String(launch.sourceGroup || 'BUILT-IN').trim();
        const label = parts.overlays
          .shortMissionLabel(launch.name, 27)
          .toUpperCase();
        const groupTag = ` · ${escapeMissionText(sourceGroup.toUpperCase())}`;
        return `<button type="button" class="space-mission-roster-item" data-mission-roster-index="${index}" data-mission-roster-id="${escapeMissionText(launch.id)}" aria-label="Select ${escapeMissionText(label)}"><span class="space-mission-roster-marker" style="--mission-roster-color:${color}" aria-hidden="true"></span><span class="space-mission-roster-copy"><strong>${escapeMissionText(label)}</strong><small>${escapeMissionText(provider)} · ${escapeMissionText(date)}${groupTag}</small></span><span class="space-mission-roster-chevron" aria-hidden="true">›</span></button>`;
      })
      .join('');
    list.querySelectorAll('[data-mission-roster-index]').forEach((button) => {
      const index = Number(button.dataset.missionRosterIndex);
      bindMissionRosterItemKeyboardPreview(
        button,
        index,
        layerState._missionRosterPreviewOwnership,
        layerState._missionRoster,
      );
    });
    restoreMissionRosterFocus(
      list,
      focusSnapshot,
      layerState._missionRoster.querySelector(
        '[data-mission-roster-focus-continuation]',
      ),
    );
  }

  function escapeMissionText(value) {
    return String(value ?? '').replace(
      /[&<>"']/g,
      (character) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[character],
    );
  }

  function updateMissionTelemetry(force = false) {
    if (
      !layerState._missionPanel ||
      !layerState._selectedLaunchId ||
      !layerState._dataSource
    )
      return;
    const now = performance.now();
    if (!force && now - layerState._lastPanelTelemetryMs < 250) return;
    layerState._lastPanelTelemetryMs = now;
    const satellite = layerState._dataSource.entities.getById(
      `rocket-satellite:${layerState._selectedLaunchId}`,
    );
    const position = satellite?.position?.getValue(
      Cesium.JulianDate.now(layerState._declutterTime),
    );
    const altitudeM = position
      ? Cesium.Cartographic.fromCartesian(position)?.height
      : null;
    setMissionPanelField(
      '[data-mission-distance]',
      Number.isFinite(altitudeM)
        ? `${Math.max(0, altitudeM / 1000).toLocaleString(undefined, { maximumFractionDigits: 0 })} KM`
        : null,
    );
    const speedMps = layerState._satelliteTelemetry.get(
      layerState._selectedLaunchId,
    )?.speedMps;
    setMissionPanelField(
      '[data-mission-speed]',
      Number.isFinite(speedMps)
        ? `${(speedMps / 1000).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} KM/S`
        : null,
      Number.isFinite(speedMps)
        ? `${(speedMps * 3.6).toLocaleString(undefined, { maximumFractionDigits: 0 })} km/h`
        : '',
    );
  }

  function refreshMissionLandingSiteMetrics() {
    if (!layerState._missionPanel) return;
    const selection = layerState._missionPanel.querySelector(
      '[data-mission-site-selector]',
    );
    const dateInput = layerState._missionPanel.querySelector(
      '[data-mission-analysis-date]',
    );
    const timeInput = layerState._missionPanel.querySelector(
      '[data-mission-analysis-time]',
    );
    if (!selection || !dateInput || !timeInput) return;
    const site =
      LUNAR_SITE_OPTIONS.find((item) => item.id === selection.value) ||
      LUNAR_SITE_OPTIONS[0];
    const metrics = computeLandingSiteMetrics(
      site,
      dateInput.value,
      timeInput.value,
    );
    const siteName = layerState._missionPanel.querySelector(
      '[data-mission-site-analysis-name]',
    );
    const sunEl = layerState._missionPanel.querySelector(
      '[data-mission-sun-elevation]',
    );
    const earthEl = layerState._missionPanel.querySelector(
      '[data-mission-earth-elevation]',
    );
    const power = layerState._missionPanel.querySelector(
      '[data-mission-power-potential]',
    );
    const window = layerState._missionPanel.querySelector(
      '[data-mission-communication-window]',
    );
    const status = layerState._missionPanel.querySelector(
      '[data-mission-site-status]',
    );
    if (siteName) siteName.textContent = `${site.name}`;
    if (sunEl) sunEl.textContent = `${metrics.sunElevation.toFixed(1)}°`;
    if (earthEl) earthEl.textContent = `${metrics.earthElevation.toFixed(1)}°`;
    if (power) power.textContent = `${metrics.powerPotential.toFixed(0)}%`;
    if (window) window.textContent = `${metrics.windowHours} h`;
    if (status) {
      const summary = metrics.daylight
        ? metrics.earthVisible
          ? 'Sunlight + Earth visible'
          : 'Sunlight + Earth below horizon'
        : 'Dark site / low power potential';
      status.textContent = summary;
    }
  }

  function selectMissionAt(index) {
    const launch = layerState._launches[index];
    if (!launch) return;
    parts.selection.setSelectedMission(launch.id, true);
    parts.selection.focusMission(launch);
  }

  function clearMissionRosterPreviewState() {
    if (layerState._missionRosterHoverTimer)
      clearTimeout(layerState._missionRosterHoverTimer);
    layerState._missionRosterHoverTimer = null;
    const changed = layerState._hoveredRosterLaunchId !== null;
    layerState._hoveredRosterLaunchId = null;
    if (changed) parts.overlays.syncMissionOverlayEntries();
  }

  function clearMissionRosterHover() {
    if (layerState._missionRosterPreviewOwnership)
      layerState._missionRosterPreviewOwnership.reset();
    else clearMissionRosterPreviewState();
  }

  function scheduleMissionRosterPreview(index) {
    const launch = layerState._launches[index];
    if (!launch || layerState._selectedLaunchId) return;
    if (layerState._missionRosterHoverTimer)
      clearTimeout(layerState._missionRosterHoverTimer);
    layerState._hoveredRosterLaunchId = launch.id;
    parts.overlays.syncMissionOverlayEntries();
    layerState._missionRosterHoverTimer = setTimeout(() => {
      layerState._missionRosterHoverTimer = null;
      if (layerState._hoveredRosterLaunchId !== launch.id) return;
      const currentLaunch = resolveMissionRosterPreviewLaunch(
        layerState._launches,
        launch.id,
      );
      if (currentLaunch)
        parts.policyHelpers.previewMissionFromRoster(currentLaunch);
    }, 140);
  }

  function createMissionPanel() {
    if (layerState._missionPanel || typeof document === 'undefined') return;
    const host =
      document.getElementById('space-mission-panel-host') ||
      document.getElementById('right-context-rail');
    if (!host) return;
    layerState._missionRoster = document.getElementById('space-mission-roster');
    if (layerState._missionRoster) {
      layerState._missionRosterPreviewOwnership =
        createMissionRosterPreviewOwnership({
          preview: scheduleMissionRosterPreview,
          clear: clearMissionRosterPreviewState,
        });
      layerState._missionRoster.onclick = (event) => {
        const button =
          event.target instanceof Element
            ? event.target.closest('[data-mission-roster-index]')
            : null;
        if (!button) return;
        selectMissionAt(Number(button.dataset.missionRosterIndex));
      };
    }
    layerState._missionPanel = document.createElement('aside');
    layerState._missionPanel.id = 'space-mission-panel';
    layerState._missionPanel.className = 'context-space-mission-detail';
    layerState._missionPanel.setAttribute(
      'aria-label',
      'Selected Space Mission',
    );
    layerState._missionPanel.innerHTML = `<div class="space-mission-view-header"><span>SELECTED SPACE MISSION</span><button type="button" data-mission-close title="Show all missions" aria-label="Deselect mission">×</button></div><div class="space-mission-detail"><strong data-mission-title>MISSION</strong><span data-mission-field data-mission-provider></span><span data-mission-field>STATUS · <b data-mission-status></b></span><span data-mission-field>LAUNCH SITE · <b data-mission-site></b></span><span data-mission-field>LAUNCH TIME · <b data-mission-time></b></span><span data-mission-field>ORBIT · <b data-mission-orbit></b></span><span>ASCENT PATH · <b data-mission-ascent-source></b></span><span data-mission-field>CURRENT DISTANCE FROM EARTH · <b data-mission-distance></b></span><span data-mission-field>SATELLITE SPEED · <b data-mission-speed></b></span></div><section class="mission-data-section mission-site-analysis"><h4>LANDING SITE ANALYSIS</h4><div class="mission-site-analysis-controls"><label>LANDING SITE<select data-mission-site-selector aria-label="Select landing site">${LUNAR_SITE_OPTIONS.map((site) => `<option value="${site.id}">${site.name}</option>`).join('')}</select></label><div class="mission-site-date-grid"><label>DATE<input type="date" data-mission-analysis-date value="2026-01-01" /></label><label>TIME<input type="time" data-mission-analysis-time value="12:00" /></label></div></div><div class="mission-site-analysis-kpis"><div><span>SITE</span><strong data-mission-site-analysis-name>South Pole</strong></div><div><span>SUN ELEV.</span><strong data-mission-sun-elevation>0.0°</strong></div><div><span>EARTH ELEV.</span><strong data-mission-earth-elevation>0.0°</strong></div><div><span>POWER</span><strong data-mission-power-potential>0%</strong></div><div><span>DTE WINDOW</span><strong data-mission-communication-window>0 h</strong></div></div><p class="mission-site-status" data-mission-site-status>Sunlight + Earth below horizon</p></section><section class="mission-data-section"><h4>PAYLOAD</h4><div class="mission-table-scroll"><table class="mission-data-table"><thead><tr><th>NAME</th><th>TYPE</th><th>DESTINATION</th></tr></thead><tbody data-mission-payloads></tbody></table></div></section><section class="mission-data-section" data-mission-stages-section><h4>STAGE / RE-ENTRY / RECOVERY</h4><div class="mission-table-scroll"><table class="mission-data-table"><thead><tr><th>STAGE</th><th>STATUS</th><th>FINAL POSITION</th></tr></thead><tbody data-mission-stages></tbody></table></div></section><div class="mission-replay-speed-control"><div class="mission-replay-speed-header"><label for="space-mission-replay-speed">REPLAY SPEED</label><output class="gev-slider-value" for="space-mission-replay-speed" data-mission-replay-speed-output>1×</output></div><input id="space-mission-replay-speed" class="gev-quantitative-slider" type="range" min="0.25" max="4" step="0.25" value="1" data-mission-replay-speed aria-label="Replay speed multiplier"><div class="mission-replay-speed-scale" aria-hidden="true"><span>0.25×</span><span>1×</span><span>4×</span></div></div><div class="mission-action-row"><button type="button" class="mission-focus-button" data-mission-focus>FOCUS</button><button type="button" class="mission-replay-button" data-mission-replay aria-pressed="false">REPLAY ASCENT</button></div><div class="space-mission-nav"><button type="button" class="mission-nav-button" data-mission-prev title="Previous mission"><span aria-hidden="true">‹</span> PREV</button><span class="mission-nav-index" data-mission-index>—</span><button type="button" class="mission-nav-button" data-mission-next title="Next mission">NEXT <span aria-hidden="true">›</span></button></div><button type="button" class="panel-layer-toggle" data-mission-show-all>SHOW ALL / DESELECT</button>`;
    layerState._missionPanel
      .querySelector('.mission-action-row')
      .insertAdjacentHTML(
        'beforeend',
        `<div class="mission-replay-transport" data-mission-replay-transport hidden>
      <button type="button" data-mission-replay-toggle title="Pause replay" aria-label="Pause replay">Ⅱ</button>
      <button type="button" class="cancel" data-mission-replay-cancel title="Cancel replay" aria-label="Cancel replay"><span aria-hidden="true">×</span></button>
    </div>`,
      );
    host.appendChild(layerState._missionPanel);
    layerState._missionPanel
      .querySelector('[data-mission-prev]')
      .addEventListener('click', () =>
        selectMissionAt(
          layerState._launches.findIndex(
            (item) => item.id === layerState._selectedLaunchId,
          ) - 1,
        ),
      );
    layerState._missionPanel
      .querySelector('[data-mission-next]')
      .addEventListener('click', () =>
        selectMissionAt(
          layerState._launches.findIndex(
            (item) => item.id === layerState._selectedLaunchId,
          ) + 1,
        ),
      );
    layerState._missionPanel
      .querySelector('[data-mission-close]')
      .addEventListener('click', () =>
        parts.selection.setSelectedMission(null),
      );
    layerState._missionPanel
      .querySelector('[data-mission-show-all]')
      .addEventListener('click', () =>
        parts.selection.setSelectedMission(null),
      );
    layerState._missionPanel
      .querySelector('[data-mission-focus]')
      .addEventListener('click', () => {
        const launch = layerState._launches.find(
          (item) => item.id === layerState._selectedLaunchId,
        );
        if (launch) parts.selection.focusLaunchSite(launch);
      });
    layerState._missionPanel
      .querySelector('[data-mission-replay]')
      .addEventListener('click', () => {
        if (layerState._selectedLaunchId)
          parts.replay.startMissionReplay(layerState._selectedLaunchId);
      });
    layerState._missionPanel
      .querySelector('[data-mission-replay-toggle]')
      .addEventListener('click', () => {
        if (layerState._replayPaused) parts.replay.resumeMissionReplay();
        else parts.replay.pauseMissionReplay();
      });
    layerState._missionPanel
      .querySelector('[data-mission-replay-cancel]')
      .addEventListener('click', parts.replay.stopMissionReplay);
    layerState._missionPanel
      .querySelector('[data-mission-replay-speed]')
      .addEventListener('input', (event) => {
        parts.replay.setReplaySpeed(event.currentTarget.value);
      });
    const siteSelector = layerState._missionPanel.querySelector(
      '[data-mission-site-selector]',
    );
    const analysisDate = layerState._missionPanel.querySelector(
      '[data-mission-analysis-date]',
    );
    const analysisTime = layerState._missionPanel.querySelector(
      '[data-mission-analysis-time]',
    );
    const refreshSiteAnalysis = () => refreshMissionLandingSiteMetrics();
    siteSelector?.addEventListener('change', refreshSiteAnalysis);
    analysisDate?.addEventListener('input', refreshSiteAnalysis);
    analysisTime?.addEventListener('input', refreshSiteAnalysis);
    refreshMissionLandingSiteMetrics();
    parts.replay.syncReplaySpeedControl();
  }
  return {
    missionHoverPreviewRange,
    createMissionRosterPreviewOwnership,
    bindMissionRosterItemKeyboardPreview,
    captureMissionRosterFocus,
    restoreMissionRosterFocus,
    resolveMissionRosterPreviewLaunch,
    missionTableRows,
    setMissionPanelField,
    renderMissionPanel,
    renderMissionRoster,
    escapeMissionText,
    updateMissionTelemetry,
    selectMissionAt,
    clearMissionRosterPreviewState,
    clearMissionRosterHover,
    scheduleMissionRosterPreview,
    createMissionPanel,
  };
}
