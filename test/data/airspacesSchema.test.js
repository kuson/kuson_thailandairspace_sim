// test/data/airspacesSchema.test.js — data/airspaces.json vs its JSON Schema.
// No validator dependency: the checks are hand-rolled, but required lists,
// enums, and bounds are READ FROM data/airspaces.schema.json so the test and
// the schema cannot drift apart silently.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const doc = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "airspaces.json"), "utf8"));
const schema = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "airspaces.schema.json"), "utf8"));

const volumeSchema = schema.definitions.volume;
const pairSchema = schema.definitions.latLonPair;
const metaSchema = schema.properties.meta;

// [minimum, maximum] for one latLonPair slot (0 = lat, 1 = lon).
function pairBounds(i) {
  const s = pairSchema.items[i];
  return [s.minimum, s.maximum];
}

function assertLatLonPair(p, label) {
  assert.ok(Array.isArray(p) && p.length === 2, `${label}: must be a [lat, lon] pair`);
  for (let i = 0; i < 2; i++) {
    const [min, max] = pairBounds(i);
    assert.equal(typeof p[i], "number", `${label}[${i}]: must be a number`);
    assert.ok(Number.isFinite(p[i]), `${label}[${i}]: must be finite`);
    assert.ok(p[i] >= min && p[i] <= max, `${label}[${i}]: ${p[i]} outside [${min}, ${max}]`);
  }
}

describe("airspaces.schema.json", () => {
  it("is draft-07 and shaped as this test expects", () => {
    assert.equal(schema.$schema, "http://json-schema.org/draft-07/schema#");
    assert.ok(Array.isArray(volumeSchema.required) && volumeSchema.required.length > 0);
    assert.ok(Array.isArray(volumeSchema.properties.category.enum));
    assert.ok(Array.isArray(volumeSchema.properties.class.enum));
    assert.ok(Array.isArray(volumeSchema.properties.shape.enum));
    assert.equal(pairSchema.items.length, 2);
  });
});

describe("airspaces.json top level", () => {
  it("has meta + airspaces and nothing else", () => {
    assert.deepEqual(Object.keys(doc).sort(), [...schema.required].sort());
    assert.ok(Array.isArray(doc.airspaces));
  });

  it("meta satisfies the schema's required fields/types", () => {
    for (const key of metaSchema.required) {
      assert.ok(key in doc.meta, `meta.${key} missing`);
    }
    assert.equal(typeof doc.meta.centerLat, "number");
    assert.equal(typeof doc.meta.centerLon, "number");
    assert.equal(typeof doc.meta.radiusKm, "number");
    assert.ok(doc.meta.radiusKm > 0);
    assert.equal(typeof doc.meta.sourceAIRAC, "string");
    assert.ok(Array.isArray(doc.meta.sourceUrls));
    for (const u of doc.meta.sourceUrls) assert.equal(typeof u, "string");
    assert.equal(typeof doc.meta.disclaimer, "string");
    assert.ok(Number.isInteger(doc.meta.volumeCount) && doc.meta.volumeCount >= 0);
    // additionalProperties: false
    const allowed = new Set(Object.keys(metaSchema.properties));
    for (const key of Object.keys(doc.meta)) {
      assert.ok(allowed.has(key), `meta.${key} not in schema`);
    }
  });

  it("meta.volumeCount matches the array length", () => {
    assert.equal(doc.meta.volumeCount, doc.airspaces.length);
  });
});

describe("every volume satisfies the schema", () => {
  const props = volumeSchema.properties;
  const allowedKeys = new Set(Object.keys(props));
  const stringMin1 = ["id", "name", "shortName", "source", "description"];

  it("required fields present with correct types", () => {
    for (const a of doc.airspaces) {
      const label = a.id ?? JSON.stringify(a).slice(0, 40);
      for (const key of volumeSchema.required) {
        assert.ok(key in a, `${label}: required "${key}" missing`);
      }
      for (const key of stringMin1) {
        assert.equal(typeof a[key], "string", `${label}.${key}: must be a string`);
        assert.ok(a[key].length >= 1, `${label}.${key}: must be non-empty`);
      }
      assert.match(a.id, new RegExp(props.id.pattern), `${label}: id fails pattern`);
      assert.ok(Number.isInteger(a.lowerFt) && a.lowerFt >= 0, `${label}.lowerFt: integer >= 0`);
      assert.ok(Number.isInteger(a.upperFt) && a.upperFt >= 0, `${label}.upperFt: integer >= 0`);
      assert.equal(typeof a.approximate, "boolean", `${label}.approximate: must be boolean`);
    }
  });

  it("enums match the schema's enums", () => {
    for (const a of doc.airspaces) {
      assert.ok(props.category.enum.includes(a.category), `${a.id}: category "${a.category}"`);
      assert.ok(props.class.enum.includes(a.class), `${a.id}: class "${a.class}"`);
      assert.ok(props.shape.enum.includes(a.shape), `${a.id}: shape "${a.shape}"`);
      // lowerRef/upperRef are optional; when present they must hit the enum.
      if ("lowerRef" in a) assert.ok(props.lowerRef.enum.includes(a.lowerRef), `${a.id}: lowerRef`);
      if ("upperRef" in a) assert.ok(props.upperRef.enum.includes(a.upperRef), `${a.id}: upperRef`);
    }
  });

  it("shape conditionals: circle => center+radiusNM, polygon => points", () => {
    for (const a of doc.airspaces) {
      if (a.shape === "circle") {
        assertLatLonPair(a.center, `${a.id}.center`);
        assert.equal(typeof a.radiusNM, "number", `${a.id}.radiusNM: must be a number`);
        assert.ok(a.radiusNM > 0, `${a.id}.radiusNM: must be > 0`);
      } else {
        assert.ok(Array.isArray(a.points), `${a.id}.points: must be an array`);
        assert.ok(a.points.length >= props.points.minItems, `${a.id}.points: >= ${props.points.minItems} vertices`);
        for (let i = 0; i < a.points.length; i++) {
          assertLatLonPair(a.points[i], `${a.id}.points[${i}]`);
        }
      }
    }
  });

  it("no keys outside the schema (additionalProperties: false)", () => {
    assert.equal(volumeSchema.additionalProperties, false);
    for (const a of doc.airspaces) {
      for (const key of Object.keys(a)) {
        assert.ok(allowedKeys.has(key), `${a.id}: unexpected key "${key}"`);
      }
    }
  });

  it("ids are unique", () => {
    const ids = doc.airspaces.map((a) => a.id);
    assert.equal(new Set(ids).size, ids.length);
  });
});
