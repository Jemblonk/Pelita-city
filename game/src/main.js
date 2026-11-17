// Boot and the one loop: input is read every frame, the world advances in
// fixed 1/60 s steps, and the renderer paints what is there. Modes: title,
// help, play, dialog, pause, busted.
//
// ?seed=N fixes the world/gameplay randomness. ?shot=start|play|chase|mission
// (with &seed=N) stages that scene instead of running the loop, paints it
// twice and sets window.__shotReady for a screenshot.
import { STEP } from './config.js';
import { createState } from './state.js';
import { createAudio } from './audio.js';
import { createInput, wasPressed } from './input.js';
import { createRenderer } from './render.js';
import { updateGame, respawnAfterBusted } from './update.js';
import { hasSave, loadSave, saveGame } from './save.js';
import { stageShot } from './shots.js';

const MAX_FRAME = 0.25;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam >>> 0 : (Math.random() * 4294967296) >>> 0;

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const renderer = createRenderer(canvas);
const audio = createAudio();

function buildSaveData(G) {
  return {
    v: 1,
    x: Math.round(G.player.x),
    y: Math.round(G.player.y),
    cash: G.player.cash,
    hp: Math.round(G.player.hp),
    ammo: G.player.ammo,
    missionIdx: G.mission.idx,
    done: G.mission.done.slice(),
    timeOfDay: G.timeOfDay,
    stats: { ...G.stats },
  };
}

function applySaveData(G, data) {
  G.player.x = data.x;
  G.player.y = data.y;
  G.player.cash = data.cash;
  G.player.hp = Math.min(data.hp, G.player.maxHp);
  G.player.ammo = data.ammo;
  G.player.car = null;
  G.mission.done = Array.isArray(data.done) ? data.done.slice(0, 3) : [false, false, false];
  while (G.mission.done.length < 3) G.mission.done.push(false);
  let idx = 0;
  while (idx < 3 && G.mission.done[idx]) idx += 1;
  G.mission.idx = idx;
  G.mission.stage = idx >= 3 ? 'allDone' : 'idle';
  G.mission.nextT = 2;
  G.mission.data = {};
  G.timeOfDay = typeof data.timeOfDay === 'number' ? data.timeOfDay : 0.32;
  if (data.stats) Object.assign(G.stats, data.stats);
  G.camera.x = G.player.x;
  G.camera.y = G.player.y;
  G.objective = idx >= 3 ? 'All missions complete. Free roam — press N for side jobs.' : 'A new job is coming — explore the city.';
  G.marker = null;
  G.mode = 'play';
}

function announce(message) {
  status.textContent = message;
}

function runShot(name) {
  const G = createState(seed);
  G.viewW = window.innerWidth;
  G.viewH = window.innerHeight;
  renderer.resize(G.viewW, G.viewH);
  const scene = stageShot(name, G);
  const ui = { hasSave: false, hover: null };
  let painted = 0;
  function paint() {
    renderer.draw(G, ui, null);
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
  window.__PELITA__ = { G, scene: scene.screen, stageShot };
}

function runGame() {
  let G = createState(seed);
  const input = createInput(canvas, () => audio.unlock());
  const ui = { hasSave: hasSave(), hover: null };
  let buttons = [];
  let lastMode = G.mode;
  let accumulator = 0;
  let last = performance.now();

  function resize() {
    renderer.resize(window.innerWidth, window.innerHeight);
    G.viewW = window.innerWidth;
    G.viewH = window.innerHeight;
  }
  window.addEventListener('resize', resize);
  resize();

  function startNewGame() {
    G = createState((Math.random() * 4294967296) >>> 0);
    G.viewW = window.innerWidth;
    G.viewH = window.innerHeight;
    G.mode = 'play';
    G.mission.nextT = 1.2;
    announce('Playing. Follow the yellow marker.');
  }

  function continueGame() {
    const data = loadSave();
    if (!data) {
      startNewGame();
      return;
    }
    G = createState(seed);
    G.viewW = window.innerWidth;
    G.viewH = window.innerHeight;
    applySaveData(G, data);
    announce('Save loaded. Playing.');
  }

  function handleButton(id) {
    if (id === 'new') startNewGame();
    else if (id === 'continue') continueGame();
    else if (id === 'help') G.mode = 'help';
    else if (id === 'back') G.mode = 'title';
    else if (id === 'resume') G.mode = 'play';
    else if (id === 'save') {
      if (saveGame(buildSaveData(G))) {
        G.saveFlash = 2.5;
        ui.hasSave = true;
      }
    } else if (id === 'quit') {
      G.mode = 'title';
      ui.hasSave = hasSave();
    } else if (id === 'respawn') {
      respawnAfterBusted(G);
      announce('Back on the streets.');
    }
  }

  function hitButton() {
    const mx = input.mouse.x;
    const my = input.mouse.y;
    for (const b of buttons) {
      if (mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h) return b.id;
    }
    return null;
  }

  function frame(now) {
    requestAnimationFrame(frame);
    const dtReal = Math.min((now - last) / 1000, MAX_FRAME);
    last = now;

    // Hover + click handling for menu buttons.
    ui.hover = hitButton();
    if (input.mouse.clicked && buttons.length > 0) {
      const id = hitButton();
      if (id) handleButton(id);
    }
    // Keyboard shortcuts on menus.
    if (G.mode === 'title' && wasPressed(input, 'Enter', 'Space')) startNewGame();
    else if (G.mode === 'help' && wasPressed(input, 'Escape', 'Enter')) G.mode = 'title';
    else if (G.mode === 'busted' && wasPressed(input, 'Enter', 'Space')) {
      respawnAfterBusted(G);
    }
    // Pause toggle.
    if (wasPressed(input, 'KeyP', 'Escape')) {
      if (G.mode === 'play') {
        G.mode = 'pause';
        audio.stopEngine();
        announce('Paused.');
      } else if (G.mode === 'pause') {
        G.mode = 'play';
        announce('Playing.');
      }
    }

    if (G.mode === 'play' || G.mode === 'dialog') {
      accumulator += dtReal;
      while (accumulator >= STEP) {
        updateGame(G, input, STEP, audio);
        accumulator -= STEP;
        if (G.mode !== 'play' && G.mode !== 'dialog') {
          accumulator = 0;
          break;
        }
      }
    } else {
      accumulator = 0;
    }

    // Autosave after mission completion.
    if (G.needsSave) {
      G.needsSave = false;
      if (saveGame(buildSaveData(G))) ui.hasSave = true;
    }

    if (G.mode !== lastMode) {
      lastMode = G.mode;
      if (G.mode === 'busted') announce('Busted by the police.');
      else if (G.mode === 'pause') announce('Paused.');
    }

    buttons = renderer.draw(G, ui, input) || [];
    input.endFrame();
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && G.mode === 'play') {
      G.mode = 'pause';
      audio.stopEngine();
      announce('Paused.');
    }
  });

  announce('Pelita City. Press Enter to start a new game.');
  window.__PELITA__ = {
    get G() {
      return G;
    },
    step(dt) {
      updateGame(G, input, dt ?? STEP, audio);
    },
    stageShot,
    createState,
  };
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
