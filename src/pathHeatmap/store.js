import { recordKey } from "./gridMath.js";

const DB_NAME = "kuson-path-heatmap";
const DB_VERSION = 1;
const STORE_NAME = "cells";

function cellCoordKey(cellX, cellY) {
  return `${cellX}:${cellY}`;
}

function createStoreApi(backend, ops) {
  return {
    backend,
    error: ops.error,
    incrementMany: ops.incrementMany,
    sumRange: ops.sumRange,
    pruneOlderThan: ops.pruneOlderThan,
    clear: ops.clear,
    exportAll: ops.exportAll,
  };
}

export function createMemoryStore() {
  const map = new Map();

  return createStoreApi("memory", {
    async incrementMany(records) {
      for (const rec of records) {
        const key = recordKey(rec.bucketId, rec.cellX, rec.cellY, rec.altBin);
        const existing = map.get(key);
        if (existing) {
          existing.count += rec.count;
        } else {
          map.set(key, {
            bucketId: rec.bucketId,
            cellX: rec.cellX,
            cellY: rec.cellY,
            altBin: rec.altBin,
            count: rec.count,
          });
        }
      }
    },

    async sumRange({ fromBucket, toBucket }) {
      const cells = new Map();
      for (const rec of map.values()) {
        if (rec.bucketId < fromBucket || rec.bucketId > toBucket) continue;
        const ck = cellCoordKey(rec.cellX, rec.cellY);
        cells.set(ck, (cells.get(ck) ?? 0) + rec.count);
      }
      return cells;
    },

    async pruneOlderThan(bucketId) {
      for (const [key, rec] of map) {
        if (rec.bucketId < bucketId) map.delete(key);
      }
    },

    async clear() {
      map.clear();
    },

    async exportAll() {
      return [...map.values()];
    },
  });
}

function openIdb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const os = db.createObjectStore(STORE_NAME, { keyPath: "key" });
        os.createIndex("byBucket", "bucketId", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbRunTx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const os = tx.objectStore(STORE_NAME);
    let result;
    try {
      result = fn(os, tx);
    } catch (err) {
      tx.abort();
      reject(err);
      return;
    }
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function createIdbStore(db) {
  return createStoreApi("idb", {
    incrementMany(records) {
      return idbRunTx(db, "readwrite", (os) => {
        for (const rec of records) {
          const key = recordKey(rec.bucketId, rec.cellX, rec.cellY, rec.altBin);
          const getReq = os.get(key);
          getReq.onsuccess = () => {
            const count = (getReq.result?.count ?? 0) + rec.count;
            os.put({
              key,
              bucketId: rec.bucketId,
              cellX: rec.cellX,
              cellY: rec.cellY,
              altBin: rec.altBin,
              count,
            });
          };
        }
      });
    },

    sumRange({ fromBucket, toBucket }) {
      const cells = new Map();
      return idbRunTx(db, "readonly", (os) => {
        const req = os.getAll();
        req.onsuccess = () => {
          for (const rec of req.result) {
            if (rec.bucketId < fromBucket || rec.bucketId > toBucket) continue;
            const ck = cellCoordKey(rec.cellX, rec.cellY);
            cells.set(ck, (cells.get(ck) ?? 0) + rec.count);
          }
        };
      }).then(() => cells);
    },

    pruneOlderThan(bucketId) {
      return idbRunTx(db, "readwrite", (os) => {
        const index = os.index("byBucket");
        const range = IDBKeyRange.upperBound(bucketId - 1);
        const cursorReq = index.openCursor(range);
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (!cursor) return;
          os.delete(cursor.primaryKey);
          cursor.continue();
        };
      });
    },

    clear() {
      return idbRunTx(db, "readwrite", (os) => {
        os.clear();
      });
    },

    exportAll() {
      let rows;
      return idbRunTx(db, "readonly", (os) => {
        const req = os.getAll();
        req.onsuccess = () => {
          rows = req.result.map(({ key: _key, ...rec }) => rec);
        };
      }).then(() => rows);
    },
  });
}

export async function openHeatStore() {
  if (typeof indexedDB === "undefined") {
    const store = createMemoryStore();
    store.error = "indexedDB unavailable";
    return store;
  }
  try {
    const db = await openIdb();
    return createIdbStore(db);
  } catch (err) {
    const store = createMemoryStore();
    store.error = String(err?.message ?? err);
    return store;
  }
}
