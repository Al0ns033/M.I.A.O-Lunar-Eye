const siteData = [
  {
    id: 'shackleton',
    name: 'SHACKLETON RIM',
    lat: -89.9,
    lon: 0,
    slope: 3,
    risk: 'LOW',
  },
  {
    id: 'imbrium',
    name: 'MARE IMBRIUM',
    lat: 32.8,
    lon: -15.6,
    slope: 2,
    risk: 'MEDIUM',
  },
  {
    id: 'tycho',
    name: 'TYCHO BASIN',
    lat: -43.3,
    lon: -11.3,
    slope: 6,
    risk: 'HIGH',
  },
];

const state = {
  activeSiteIndex: 0,
  currentTimeDays: 7.5,
};

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeDegrees(value) {
  const wrapped = value % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

function atan2Deg(y, x) {
  return (Math.atan2(y, x) * RAD + 360) % 360;
}

function projectToMoon(lat, lon, radius = 215) {
  const latRad = lat * DEG;
  const lonRad = lon * DEG;
  const x = 350 + Math.cos(latRad) * Math.sin(lonRad) * radius;
  const y = 350 + Math.sin(latRad) * radius * 0.82;
  return { x, y };
}

function moonSolarAltitude(site, days) {
  const declination = 1.4 * Math.sin((days / 29.53) * Math.PI * 2 - 1.15);
  const hourAngle = normalizeDegrees((days / 29.53) * 360 + site.lon + 180);
  const latRad = site.lat * DEG;
  const hourRad = hourAngle * DEG;
  const sinAltitude =
    Math.sin(latRad) * Math.sin(declination * DEG) +
    Math.cos(latRad) * Math.cos(declination * DEG) * Math.cos(hourRad);
  return Math.asin(clamp(sinAltitude, -1, 1)) * RAD;
}

function moonEarthAltitude(site, days) {
  const declination = 5.2 * Math.sin((days / 27.32) * Math.PI * 2 + 1.2);
  const hourAngle = normalizeDegrees((days / 27.32) * 360 + site.lon + 110);
  const latRad = site.lat * DEG;
  const hourRad = hourAngle * DEG;
  const sinAltitude =
    Math.sin(latRad) * Math.sin(declination * DEG) +
    Math.cos(latRad) * Math.cos(declination * DEG) * Math.cos(hourRad);
  return Math.asin(clamp(sinAltitude, -1, 1)) * RAD;
}

function computePowerPotential(sunAltitude, slopeDeg) {
  const usable = clamp((sunAltitude + 10 - slopeDeg * 0.7) / 55, 0, 1);
  return Math.round(usable * 100);
}

function computeSignalQuality(earthAltitude) {
  const quality = clamp((earthAltitude + 15) / 45, 0, 1);
  return Math.round(quality * 100);
}

function generateDTEWindows(site, days, horizonHours = 24) {
  const windows = [];
  let start = null;
  let previousVisible = false;

  for (let h = 0; h <= horizonHours; h += 0.5) {
    const t = days + h / 24;
    const elevation = moonEarthAltitude(site, t);
    const visible = elevation > 0;

    if (visible && !previousVisible) start = h;

    if (!visible && previousVisible && start !== null) {
      const duration = (h - start).toFixed(1);
      windows.push(`${formatHourLabel(start)} to ${formatHourLabel(h)} (${duration}h)`);
      start = null;
    }

    previousVisible = visible;
  }

  return windows.length ? windows.slice(0, 4) : ['NO DTE WINDOW IN NEXT 24H'];
}

function formatHourLabel(hour) {
  const whole = Math.floor(hour);
  const minutes = Math.round((hour - whole) * 60);
  return `${String(whole).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function renderScene(site) {
  const trajectoryLayer = document.getElementById('trajectoryLayer');
  const siteLayer = document.getElementById('siteLayer');
  const sunLayer = document.getElementById('sunLayer');
  const earthLayer = document.getElementById('earthLayer');

  trajectoryLayer.innerHTML = '';
  siteLayer.innerHTML = '';
  sunLayer.innerHTML = '';
  earthLayer.innerHTML = '';

  const sitePoint = projectToMoon(site.lat, site.lon, 190);
  const trajectory = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  const start = { x: 150, y: 540 };
  const mid = { x: 260, y: 420 };
  trajectory.setAttribute('class', 'trajectory-path');
  trajectory.setAttribute('d', `M ${start.x} ${start.y} Q ${mid.x} ${mid.y} ${sitePoint.x} ${sitePoint.y}`);
  trajectoryLayer.appendChild(trajectory);

  const siteMarker = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  siteMarker.setAttribute('class', 'site-marker');
  siteMarker.setAttribute('cx', sitePoint.x);
  siteMarker.setAttribute('cy', sitePoint.y);
  siteMarker.setAttribute('r', 8);
  siteLayer.appendChild(siteMarker);

  const sunPos = projectToMoon(
    clamp(55 * Math.sin(state.currentTimeDays * 0.7), -55, 55),
    130 + state.currentTimeDays * 8,
    230,
  );

  const sunMarker = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  sunMarker.setAttribute('class', 'sun-marker');
  sunMarker.setAttribute('cx', sunPos.x);
  sunMarker.setAttribute('cy', sunPos.y);
  sunMarker.setAttribute('r', 10);
  sunLayer.appendChild(sunMarker);

  const earthPos = projectToMoon(
    clamp(18 * Math.sin(state.currentTimeDays * 1.1), -18, 18),
    40 + state.currentTimeDays * 10,
    220,
  );

  const earthMarker = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  earthMarker.setAttribute('class', 'earth-marker');
  earthMarker.setAttribute('cx', earthPos.x);
  earthMarker.setAttribute('cy', earthPos.y);
  earthMarker.setAttribute('r', 9);
  earthLayer.appendChild(earthMarker);

  const siteText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  siteText.setAttribute('x', sitePoint.x + 12);
  siteText.setAttribute('y', sitePoint.y - 12);
  siteText.setAttribute('fill', '#f8d065');
  siteText.setAttribute('font-size', '12');
  siteText.textContent = site.name;
  siteLayer.appendChild(siteText);
}

function updateMetrics(site) {
  const sunElevation = moonSolarAltitude(site, state.currentTimeDays);
  const earthElevation = moonEarthAltitude(site, state.currentTimeDays);
  const power = computePowerPotential(sunElevation, site.slope);
  const signal = computeSignalQuality(earthElevation);

  document.getElementById('siteName').textContent = site.name;
  document.getElementById('siteCoords').textContent = `${Math.abs(site.lat).toFixed(1)}° ${site.lat >= 0 ? 'N' : 'S'} · ${Math.abs(site.lon).toFixed(1)}° ${site.lon >= 0 ? 'E' : 'W'}`;
  document.getElementById('sunElevation').textContent = `${sunElevation.toFixed(1)}°`;
  document.getElementById('earthElevation').textContent = `${earthElevation.toFixed(1)}°`;
  document.getElementById('powerPotential').textContent = `${power}%`;
  document.getElementById('slopeValue').textContent = `${site.slope}°`;
  document.getElementById('riskValue').textContent = site.risk;
  document.getElementById('statusText').textContent = `${site.name} ACTIVE`;

  const signalText = signal >= 70 ? 'HIGH' : signal >= 45 ? 'MEDIUM' : 'LOW';
  document.getElementById('windowList').innerHTML = '';
  generateDTEWindows(site, state.currentTimeDays).forEach((windowText) => {
    const item = document.createElement('li');
    item.textContent = windowText;
    document.getElementById('windowList').appendChild(item);
  });
  document.getElementById('statusText').textContent = `${site.name} ACTIVE · ${signalText} DTE`;
}

function updateDateLabel() {
  const base = new Date(Date.UTC(2026, 0, 1, 12, 0, 0));
  const target = new Date(base.getTime() + state.currentTimeDays * 24 * 60 * 60 * 1000);
  document.getElementById('currentDateLabel').textContent = target.toISOString().slice(0, 10);
}

function renderAll() {
  const site = siteData[state.activeSiteIndex];
  renderScene(site);
  updateMetrics(site);
  updateDateLabel();
}

function setupSiteButtons() {
  const siteNames = document.getElementById('siteName');
  siteNames.textContent = siteData[state.activeSiteIndex].name;
  const slider = document.getElementById('timeSlider');
  slider.addEventListener('input', (event) => {
    state.currentTimeDays = (Number(event.target.value) / 100) * 29.5;
    renderAll();
  });
}

function init() {
  setupSiteButtons();
  renderAll();
}

init();
