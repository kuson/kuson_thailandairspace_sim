// simState.js — global sim policy flags shared across subsystems.
//
// The single sanctioned seam for Strict-CAAT enforcement (spec §3.12). Any
// code that gates physical enforcement on the CAAT mode MUST read it through
// `simState.isStrictCaat()` — never a scattered window/global check. Default
// is OFF so the Airspace Tour and non-drone presets fly unrestricted; the
// alert system still reports violations advisorily regardless of this flag.

const LS_KEY = "kuson.sim.strictCaat";

function loadStrict() {
  try {
    return localStorage.getItem(LS_KEY) === "1";
  } catch {
    return false; // private mode / no storage → safe default OFF
  }
}

export const simState = {
  strictCaat: loadStrict(),

  isStrictCaat() {
    return this.strictCaat === true;
  },

  setStrictCaat(on) {
    this.strictCaat = !!on;
    try {
      localStorage.setItem(LS_KEY, this.strictCaat ? "1" : "0");
    } catch {
      /* private mode — in-memory only */
    }
    return this.strictCaat;
  },
};
