import { FT_TO_M } from "../coords.js";

export const FL100_M = 10000 * FT_TO_M;
export const FL290_M = 29000 * FT_TO_M;

/** @returns {0|1|2|3} 0 = skip splat */
export function altBinFromAltM(altM, onGround) {
  if (onGround || !(typeof altM === "number") || !Number.isFinite(altM)) return 0;
  if (altM < FL100_M) return 1;
  if (altM < FL290_M) return 2;
  return 3;
}
