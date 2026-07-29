export const CELL_DEG = 0.02;
export const BUCKET_SEC = 300;
export const BBOX = Object.freeze({
  lamin: 5.5, lomin: 97, lamax: 20.5, lomax: 106,
});

export function gridSize() {
  return {
    cols: Math.round((BBOX.lomax - BBOX.lomin) / CELL_DEG),
    rows: Math.round((BBOX.lamax - BBOX.lamin) / CELL_DEG),
  };
}

export function latLonToCell(lat, lon) {
  if (lat < BBOX.lamin || lat >= BBOX.lamax || lon < BBOX.lomin || lon >= BBOX.lomax) {
    return null;
  }
  return {
    cellX: Math.floor((lon - BBOX.lomin) / CELL_DEG),
    cellY: Math.floor((lat - BBOX.lamin) / CELL_DEG),
  };
}

export function bucketId(epochMs) {
  return Math.floor(epochMs / 1000 / BUCKET_SEC);
}

export function recordKey(bucketId, cellX, cellY, altBin) {
  return `${bucketId}:${cellX}:${cellY}:${altBin}`;
}
