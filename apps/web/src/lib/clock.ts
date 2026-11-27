/**
 * Server-authoritative clock. We never trust Date.now() for exam timing:
 * offset = serverNow - clientNow (corrected for half the round-trip), and offline we advance
 * using performance.now() which is monotonic and immune to the user changing the system clock.
 */
let offset = 0;
let anchorPerf = performance.now();
let anchorServer = Date.now();

export function syncClock(serverNow: number, rttMs = 0) {
  anchorServer = serverNow + rttMs / 2;
  anchorPerf = performance.now();
  offset = anchorServer - Date.now();
}
/** Current server time estimated from the monotonic clock since the last sync. */
export const serverNow = () => anchorServer + (performance.now() - anchorPerf);
export const clockOffset = () => offset;
