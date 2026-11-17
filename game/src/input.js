// Keyboard + mouse input. The game reads a plain object each frame:
//   keys    — Set of currently held codes (KeyW, ArrowUp, Space, ...)
//   pressed — Set of codes pressed since the last frame (edge-triggered)
//   mouse   — {x, y} canvas pixels, down (held), clicked (edge this frame)
// Systems never touch the DOM; the Node harness builds the same shape by hand.
export function createInput(canvas, onFirstGesture) {
  const input = {
    keys: new Set(),
    pressed: new Set(),
    mouse: { x: 0, y: 0, down: false, clicked: false, rightDown: false },
    _gestured: false,
  };

  function gesture() {
    if (!input._gestured) {
      input._gestured = true;
      if (onFirstGesture) onFirstGesture();
    }
  }

  function onKeyDown(e) {
    gesture();
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
      e.preventDefault();
    }
    if (!e.repeat) input.pressed.add(e.code);
    input.keys.add(e.code);
  }

  function onKeyUp(e) {
    input.keys.delete(e.code);
  }

  function onMove(e) {
    const rect = canvas.getBoundingClientRect();
    input.mouse.x = e.clientX - rect.left;
    input.mouse.y = e.clientY - rect.top;
  }

  function onDown(e) {
    gesture();
    onMove(e);
    if (e.button === 0) {
      input.mouse.down = true;
      input.mouse.clicked = true;
    } else if (e.button === 2) {
      input.mouse.rightDown = true;
    }
  }

  function onUp(e) {
    if (e.button === 0) input.mouse.down = false;
    else if (e.button === 2) input.mouse.rightDown = false;
  }

  function onBlur() {
    input.keys.clear();
    input.mouse.down = false;
    input.mouse.rightDown = false;
  }

  function onContext(e) {
    e.preventDefault();
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  canvas.addEventListener('mousemove', onMove);
  canvas.addEventListener('mousedown', onDown);
  window.addEventListener('mouseup', onUp);
  canvas.addEventListener('contextmenu', onContext);

  input.endFrame = function endFrame() {
    input.pressed.clear();
    input.mouse.clicked = false;
  };

  input.destroy = function destroy() {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
    canvas.removeEventListener('mousemove', onMove);
    canvas.removeEventListener('mousedown', onDown);
    window.removeEventListener('mouseup', onUp);
    canvas.removeEventListener('contextmenu', onContext);
  };

  return input;
}

/** Axis-aligned movement intent from held keys: {x, y} in [-1, 1]. */
export function moveAxis(input) {
  let x = 0;
  let y = 0;
  if (input.keys.has('KeyA') || input.keys.has('ArrowLeft')) x -= 1;
  if (input.keys.has('KeyD') || input.keys.has('ArrowRight')) x += 1;
  if (input.keys.has('KeyW') || input.keys.has('ArrowUp')) y -= 1;
  if (input.keys.has('KeyS') || input.keys.has('ArrowDown')) y += 1;
  if (x !== 0 && y !== 0) {
    x *= Math.SQRT1_2;
    y *= Math.SQRT1_2;
  }
  return { x, y };
}

/** True when any of the given codes was pressed this frame. */
export function wasPressed(input, ...codes) {
  for (const c of codes) if (input.pressed.has(c)) return true;
  return false;
}
