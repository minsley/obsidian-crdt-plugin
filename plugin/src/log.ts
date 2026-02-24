const TAG = "[crdt-coeditor]";

/** Settable at runtime via plugin settings. */
let _debug = false;

export function setDebug(enabled: boolean) {
  _debug = enabled;
}

/** Always printed (errors, important state changes). */
export function log(...args: unknown[]) {
  console.log(TAG, ...args);
}

/** Only printed when debug logging is on. */
export function debug(...args: unknown[]) {
  if (_debug) console.log(TAG, ...args);
}

/** Always printed. */
export function warn(...args: unknown[]) {
  console.warn(TAG, ...args);
}
