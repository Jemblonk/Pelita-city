// Save / load through localStorage, fully guarded: private windows and the
// Node harness simply get "no save" instead of an exception.
import { SAVE_KEY } from './config.js';

function storage() {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

export function hasSave() {
  const s = storage();
  if (!s) return false;
  try {
    return s.getItem(SAVE_KEY) !== null;
  } catch {
    return false;
  }
}

export function saveGame(data) {
  const s = storage();
  if (!s) return false;
  try {
    s.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function loadSave() {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (typeof data !== 'object' || data === null) return null;
    return data;
  } catch {
    return null;
  }
}

export function clearSave() {
  const s = storage();
  if (!s) return;
  try {
    s.removeItem(SAVE_KEY);
  } catch {
    // ignore
  }
}
