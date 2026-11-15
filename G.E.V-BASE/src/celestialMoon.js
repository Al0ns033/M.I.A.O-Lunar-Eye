import * as Cesium from 'cesium';

export function computeEarthMoonReference(time = Cesium.JulianDate.now()) {
  const moonInertial = new Cesium.Cartesian3();
  Cesium.Simon1994PlanetaryPositions.computeMoonPositionInEarthInertialFrame(
    time,
    moonInertial,
  );
  const fixedMatrix =
    Cesium.Transforms.computeIcrfToFixedMatrix(
      time,
      new Cesium.Matrix3(),
    ) ||
    Cesium.Transforms.computeTemeToPseudoFixedMatrix(
      time,
      new Cesium.Matrix3(),
    );
  const moonFixed = fixedMatrix
    ? Cesium.Matrix3.multiplyByVector(
        fixedMatrix,
        moonInertial,
        new Cesium.Cartesian3(),
      )
    : moonInertial;
  const distanceMeters = Cesium.Cartesian3.magnitude(moonFixed) || 384_400_000;
  const direction = Cesium.Cartesian3.normalize(
    moonFixed,
    new Cesium.Cartesian3(),
  );
  return {
    cartesian: moonFixed,
    direction,
    distanceMeters,
  };
}
