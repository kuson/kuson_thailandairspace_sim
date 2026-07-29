/** Parse one JSONL shard blob; skip bad lines. */
export function parseShardText(text) {
  const records = [];
  let skipped = 0;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      skipped++;
      continue;
    }
    let obj;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      skipped++;
      continue;
    }
    if (!isValidRecord(obj)) {
      skipped++;
      continue;
    }
    records.push({
      bucketId: obj.bucketId,
      cellX: obj.cellX,
      cellY: obj.cellY,
      altBin: obj.altBin,
      count: obj.count,
    });
  }
  return { records, skipped };
}

function isValidRecord(obj) {
  return (
    obj != null &&
    Number.isInteger(obj.bucketId) &&
    Number.isInteger(obj.cellX) &&
    Number.isInteger(obj.cellY) &&
    Number.isInteger(obj.altBin) &&
    obj.altBin >= 0 &&
    obj.altBin <= 3 &&
    Number.isInteger(obj.count) &&
    obj.count > 0
  );
}

/** Merge shard records into the heat store. */
export async function mergeRecords(store, records) {
  if (!records.length) return;
  await store.incrementMany(records);
}
