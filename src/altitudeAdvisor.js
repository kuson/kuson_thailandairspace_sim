// altitudeAdvisor.js — per-preset altitude ceiling state machine (spec §10.2).
//
// Owns ALL altitude-ceiling logic. No altitude limits live in drone.js,
// physics.js, or failures.js anymore. Each frame it compares the aircraft's
// altitude against the active preset's operational + regulated ceilings
// (src/ceilings.js) and publishes at most one ALT_* alert to the queue
// (src/alerts.js). Enforcement is NOT done here by default — this is the
// warning surface that always shows. The Strict-CAAT clamp (P2.T6) is the
// only place that acts on these states, and only for the Mavic.
//
// The two ceilings are evaluated independently because they can use different
// reference frames (Mavic regulated = 120 m AGL, operational = 6000 m AMSL).
// Each band carries its own NONE/NEAR/OVER status with hysteresis so the
// banner doesn't flap at the boundary.

import { getCeilings } from "./ceilings.js";
import { alerts as defaultQueue, AlertTier } from "./alerts.js";
import { M_TO_FT } from "./coords.js";

const KEY = "alt";
const NEAR_ENTER = 0.90;
const NEAR_LEAVE = 0.85;
const OVER_ENTER = 1.0;
const OVER_LEAVE = 0.95;

function nextBandStatus(prev, value, ceil) {
  const near = NEAR_ENTER * ceil;
  const nearLeave = NEAR_LEAVE * ceil;
  const overLeave = OVER_LEAVE * ceil;
  switch (prev) {
    case "OVER":
      if (value >= overLeave) return "OVER";
      return value >= nearLeave ? "NEAR" : "NONE";
    case "NEAR":
      if (value >= ceil) return "OVER";
      return value >= nearLeave ? "NEAR" : "NONE";
    default:
      if (value >= ceil) return "OVER";
      if (value >= near) return "NEAR";
      return "NONE";
  }
}

function fmtCeil(band, unitSystem) {
  // band = { m, ref }
  if (unitSystem === "aero" || unitSystem === "imperial") {
    const ft = Math.round(band.m * M_TO_FT);
    return band.ref === "AGL" ? `${ft.toLocaleString()} ft AGL` : `${ft.toLocaleString()} ft`;
  }
  return band.ref === "AGL" ? `${Math.round(band.m)} m AGL` : `${Math.round(band.m)} m`;
}

export class AltitudeAdvisor {
  constructor(queue = defaultQueue) {
    this.queue = queue;
    this.regStatus = "NONE";
    this.opStatus = "NONE";
    this.state = "NORMAL"; // headline state id
  }

  /**
   * @param presetId   active speed preset id
   * @param altM       altitude AMSL (metres)
   * @param aglM       altitude above ground (metres)
   * @param unitSystem "metric" | "aero" — for message formatting
   * @returns the headline state id (NORMAL/AT_OP/OVER_OP/AT_REG/OVER_REG)
   */
  tick(presetId, altM, aglM, unitSystem = "metric") {
    const c = getCeilings(presetId);

    // Unlimited preset (UFO): never warn.
    if (!c.operational && !c.regulated) {
      this._reset();
      return this.state;
    }

    const valFor = (band) => (band.ref === "AGL" ? aglM : altM);

    this.regStatus = c.regulated
      ? nextBandStatus(this.regStatus, valFor(c.regulated), c.regulated.m)
      : "NONE";
    this.opStatus = c.operational
      ? nextBandStatus(this.opStatus, valFor(c.operational), c.operational.m)
      : "NONE";

    // Headline: most physically severe condition first.
    let tier = null;
    let message = null;
    if (this.opStatus === "OVER") {
      this.state = "OVER_OP";
      tier = AlertTier.ALT_OVER_OP;
      message = `OUT OF OPERATION RANGE — descend to ${fmtCeil(c.operational, unitSystem)}`;
    } else if (this.regStatus === "OVER") {
      this.state = "OVER_REG";
      tier = AlertTier.ALT_OVER_REG;
      message = `OUT OF REGULATED RANGE — descend to ${fmtCeil(c.regulated, unitSystem)}`;
    } else if (this.opStatus === "NEAR") {
      this.state = "AT_OP";
      tier = AlertTier.ALT_AT_OP;
      message = `Approaching operational ceiling ${fmtCeil(c.operational, unitSystem)}`;
    } else if (this.regStatus === "NEAR") {
      this.state = "AT_REG";
      tier = AlertTier.ALT_AT_REG;
      message = `Approaching regulated ceiling ${fmtCeil(c.regulated, unitSystem)}`;
    } else {
      this.state = "NORMAL";
    }

    if (tier) {
      this.queue.publish({ key: KEY, tier, message });
    } else {
      this.queue.retract(KEY);
    }
    return this.state;
  }

  _reset() {
    this.regStatus = "NONE";
    this.opStatus = "NONE";
    if (this.state !== "NORMAL") {
      this.state = "NORMAL";
      this.queue.retract(KEY);
    }
  }
}
