import * as Cesium from 'cesium';

/** Load Apollo 11 into an existing Cesium Viewer. Returns a cleanup function. */
export async function loadApollo11(viewer, url = '/apollo11/apollo11.czml') {
  const source = await Cesium.CzmlDataSource.load(url);
  const clock = viewer.clock;
  const saved = {
    startTime: clock.startTime.clone(),
    stopTime: clock.stopTime.clone(),
    currentTime: clock.currentTime.clone(),
    multiplier: clock.multiplier,
    clockRange: clock.clockRange,
    clockStep: clock.clockStep,
    shouldAnimate: clock.shouldAnimate,
    trackedEntity: viewer.trackedEntity,
    automaticallyTrackDataSourceClocks: viewer.automaticallyTrackDataSourceClocks,
    globeShow: viewer.scene.globe?.show,
    moonShow: viewer.scene.moon?.show,
  };
  await viewer.dataSources.add(source);
  viewer.automaticallyTrackDataSourceClocks = false;
  clock.startTime = source.clock.startTime.clone();
  clock.stopTime = source.clock.stopTime.clone();
  clock.currentTime = source.clock.startTime.clone();
  clock.clockStep = Cesium.ClockStep.SYSTEM_CLOCK_MULTIPLIER;
  clock.clockRange = Cesium.ClockRange.CLAMPED;
  clock.multiplier = 300;
  clock.shouldAnimate = true;
  viewer.scene.globe.show = true;
  if (viewer.scene.moon) viewer.scene.moon.show = true;
  viewer.timeline?.zoomTo(clock.startTime, clock.stopTime);
  viewer.trackedEntity = source.entities.getById('columbia');
  viewer.scene.requestRender();
  return () => {
    viewer.trackedEntity = saved.trackedEntity;
    viewer.dataSources.remove(source, true);
    viewer.automaticallyTrackDataSourceClocks =
      saved.automaticallyTrackDataSourceClocks;
    clock.clockStep = saved.clockStep;
    clock.startTime = saved.startTime;
    clock.stopTime = saved.stopTime;
    clock.currentTime = saved.currentTime;
    clock.multiplier = saved.multiplier;
    clock.clockRange = saved.clockRange;
    clock.shouldAnimate = saved.shouldAnimate;
    if (viewer.scene.globe) viewer.scene.globe.show = saved.globeShow;
    if (viewer.scene.moon) viewer.scene.moon.show = saved.moonShow;
    viewer.timeline?.zoomTo(clock.startTime, clock.stopTime);
    viewer.scene.requestRender();
  };
}
