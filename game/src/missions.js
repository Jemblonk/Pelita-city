// Story, dialog, the three missions, and quick side jobs. Missions chain
// automatically: finishing one opens the next briefing after a short delay.
// Dialog pauses the world; advancing is Space / Enter / click.
import { BLOCK } from './config.js';
import { addToast, addWanted, burst, newCar, newEnemy, newPed } from './state.js';
import { dist, range } from './util.js';

const M1_PICKUP = { x: 2 * BLOCK, y: 3 * BLOCK };
const M1_DROP = { x: 6 * BLOCK, y: 6 * BLOCK };
const M2_ALLEY = { x: 6 * BLOCK + 200, y: 6 * BLOCK + 200 };
const M3_CAR = { x: 3 * BLOCK + 26, y: 5 * BLOCK };
const M3_HIDEOUT = { x: 7 * BLOCK, y: 1 * BLOCK };

export const STORY = {
  m1Intro: [
    { who: 'BOS DARMA', text: 'Rian, I need a package moved across town. No questions asked.' },
    { who: 'RIAN', text: 'Fast and quiet. Where is the pickup?' },
    { who: 'BOS DARMA', text: 'North-west corner. Then the south-east docks. Do not keep them waiting.' },
  ],
  m1Picked: [
    { who: 'RIAN', text: 'Package secured. Now the docks — and the clock is ticking.' },
  ],
  m1Done: [
    { who: 'BOS DARMA', text: 'Delivered. Clean work, Rian. There will be more.' },
  ],
  m2Intro: [
    { who: 'SARI', text: 'The alley gang has been shaking down my shop all week.' },
    { who: 'RIAN', text: 'I will clear them out.' },
    { who: 'SARI', text: 'Careful — two of them carry guns. Watch the rooftops... I mean, the corners.' },
  ],
  m2Done: [
    { who: 'SARI', text: 'The alley is quiet again. Thank you, Rian. This is for you.' },
  ],
  m3Intro: [
    { who: 'BOS DARMA', text: 'One last job. A red Comet parked uptown — I need it tonight.' },
    { who: 'RIAN', text: 'Stealing it will bring every cop in Pelita down on me.' },
    { who: 'BOS DARMA', text: 'Then do not get caught. Bring it to the hideout, in one piece if you can.' },
  ],
  m3Done: [
    { who: 'BOS DARMA', text: 'You did it, Rian. Pelita City is yours now.' },
    { who: 'RIAN', text: 'Just another day in Pelita City.' },
  ],
  busted: [
    { who: 'OFFICER', text: 'You are coming with us. The city will still be here when you get out.' },
  ],
};

export function startDialog(G, lines, onDone) {
  G.dialog = { lines, i: 0, onDone: onDone || null };
  G.mode = 'dialog';
}

export function advanceDialog(G) {
  const d = G.dialog;
  if (!d) return;
  d.i += 1;
  if (d.i >= d.lines.length) {
    const onDone = d.onDone;
    G.dialog = null;
    G.mode = 'play';
    if (onDone) onDone(G);
  }
}

function setObjective(G, text, marker) {
  G.objective = text;
  G.marker = marker || null;
}

function startMission(G, idx, audio) {
  const m = G.mission;
  m.idx = idx;
  if (idx === 0) {
    m.stage = 'brief';
    startDialog(G, STORY.m1Intro, () => {
      m.stage = 'pickup';
      setObjective(G, 'Pick up the package at the north-west marker.', { ...M1_PICKUP, label: 'PICKUP' });
    });
  } else if (idx === 1) {
    m.stage = 'brief';
    startDialog(G, STORY.m2Intro, () => {
      m.stage = 'goto';
      setObjective(G, 'Head to the alley in the south-east blocks.', { ...M2_ALLEY, label: 'ALLEY' });
    });
  } else if (idx === 2) {
    m.stage = 'brief';
    // Spawn the target car fresh for this mission.
    const car = newCar(M3_CAR.x, M3_CAR.y, 0, { color: '#c0272d', body: 'sport', parked: true });
    car.target = true;
    G.cars.push(car);
    m.data.targetCarId = car.id;
    startDialog(G, STORY.m3Intro, () => {
      m.stage = 'steal';
      setObjective(G, 'Steal the red Comet uptown.', { ...M3_CAR, label: 'COMET' });
    });
  }
}

function completeMission(G, audio) {
  const m = G.mission;
  const rewards = [150, 250, 400];
  const reward = rewards[m.idx];
  G.player.cash += reward;
  G.stats.missionsDone += 1;
  m.done[m.idx] = true;
  m.stage = 'done';
  if (audio) audio.missionDone();
  addToast(G, `Mission complete! +$${reward}`);
  G.saveFlash = 2.5;
  G.needsSave = true;
  const doneLines = m.idx === 0 ? STORY.m1Done : m.idx === 1 ? STORY.m2Done : STORY.m3Done;
  const next = m.idx + 1;
  startDialog(G, doneLines, () => {
    if (next < 3) {
      m.stage = 'idle';
      m.nextT = 4;
    } else {
      m.stage = 'allDone';
      setObjective(G, 'All missions complete. Free roam — press N for side jobs.', null);
    }
  });
}

function failMission(G, reason) {
  const m = G.mission;
  addToast(G, reason);
  if (m.idx === 0 && m.stage === 'deliver') {
    // Retry the delivery leg from the pickup point.
    m.stage = 'pickup';
    setObjective(G, 'Too slow! Pick up the package again.', { ...M1_PICKUP, label: 'PICKUP' });
  }
}

function updateMissionStages(G, dt, audio) {
  const m = G.mission;
  const p = G.player;
  if (m.stage === 'idle') {
    m.nextT = (m.nextT ?? 1.2) - dt;
    if (m.nextT <= 0 && m.idx < 3 && !m.done[m.idx]) startMission(G, m.idx, audio);
    return;
  }
  if (m.idx === 0) {
    if (m.stage === 'pickup' && dist(p.x, p.y, M1_PICKUP.x, M1_PICKUP.y) < 64) {
      m.stage = 'deliver';
      m.timer = 80;
      startDialog(G, STORY.m1Picked, () => {
        setObjective(G, 'Deliver the package to the south-east docks — fast!', { ...M1_DROP, label: 'DROPOFF' });
      });
    } else if (m.stage === 'deliver') {
      m.timer -= dt;
      G.objective = `Deliver the package — ${Math.max(0, Math.ceil(m.timer))}s left!`;
      if (dist(p.x, p.y, M1_DROP.x, M1_DROP.y) < 64) {
        completeMission(G, audio);
      } else if (m.timer <= 0) {
        failMission(G, 'Too slow — the buyer walked away.');
      }
    }
  } else if (m.idx === 1) {
    if (m.stage === 'goto' && dist(p.x, p.y, M2_ALLEY.x, M2_ALLEY.y) < 130) {
      m.stage = 'fight';
      m.data.spawned = [];
      const spots = [
        { dx: -60, dy: -40, kind: 'melee' },
        { dx: 60, dy: -50, kind: 'melee' },
        { dx: -50, dy: 60, kind: 'shooter' },
        { dx: 70, dy: 50, kind: 'shooter' },
      ];
      for (const s of spots) {
        const e = newEnemy(M2_ALLEY.x + s.dx, M2_ALLEY.y + s.dy, s.kind, G.rng);
        e.alerted = true;
        e.mission = true;
        G.enemies.push(e);
        m.data.spawned.push(e.id);
      }
      setObjective(G, 'Clear the alley — defeat all 4 gang members!', { ...M2_ALLEY, label: 'FIGHT' });
      addToast(G, 'The gang is here. Good luck!');
    } else if (m.stage === 'fight') {
      const left = G.enemies.filter((e) => e.mission && !e.dead).length;
      G.objective = `Clear the alley — ${left} left!`;
      if (left === 0) completeMission(G, audio);
    }
  } else if (m.idx === 2) {
    if (m.stage === 'steal') {
      const car = G.cars.find((c) => c.id === m.data.targetCarId);
      if (car) {
        G.marker = { x: car.x, y: car.y, label: 'COMET' };
        if (p.car === car) {
          m.stage = 'escape';
          addWanted(G, 3, 'The Comet is hot! 3 stars — run!');
          setObjective(G, 'Lose the cops and reach the hideout!', { ...M3_HIDEOUT, label: 'HIDEOUT' });
        }
      }
    } else if (m.stage === 'escape') {
      const car = G.cars.find((c) => c.id === m.data.targetCarId);
      if (p.car === car && dist(p.x, p.y, M3_HIDEOUT.x, M3_HIDEOUT.y) < 75) {
        completeMission(G, audio);
      } else if (p.car !== car) {
        G.objective = 'Get back in the Comet and reach the hideout!';
        G.marker = car ? { x: car.x, y: car.y, label: 'COMET' } : { ...M3_HIDEOUT, label: 'HIDEOUT' };
      } else {
        G.marker = { ...M3_HIDEOUT, label: 'HIDEOUT' };
      }
    }
  }
}

// ---- Side jobs (N key) ----

function randomRoadPoint(G, minD, maxD) {
  const p = G.player;
  for (let t = 0; t < 24; t += 1) {
    const x = Math.round(range(G.rng, 1, 7)) * BLOCK;
    const y = Math.round(range(G.rng, 1, 7)) * BLOCK;
    const d = dist(p.x, p.y, x, y);
    if (d >= minD && d <= maxD) return { x, y };
  }
  return { x: BLOCK * 4, y: BLOCK * 4 };
}

export function startSideJob(G) {
  if (G.sideJob) {
    addToast(G, 'Finish your current side job first.');
    return;
  }
  if (G.sideJobCooldown > 0) {
    addToast(G, 'No jobs right now — check back soon.');
    return;
  }
  const kind = G.rng() < 0.5 ? 'taxi' : 'collect';
  if (kind === 'taxi') {
    const ped = newPed(G.player.x + range(G.rng, -90, 90), G.player.y + range(G.rng, -90, 90), G.rng);
    ped.state = 'idle';
    ped.timer = 1e9;
    ped.sideJob = true;
    G.peds.push(ped);
    const dest = randomRoadPoint(G, 500, 1400);
    G.sideJob = { kind, stage: 'pickup', pedId: ped.id, dest, reward: 55 };
    G.marker = { x: ped.x, y: ped.y, label: 'FARE' };
    G.objective = 'Side job: pick up the passenger (drive next to them).';
    addToast(G, 'Side job: a passenger needs a ride.');
  } else {
    const spot = randomRoadPoint(G, 500, 1400);
    G.sideJob = { kind, stage: 'go', dest: spot, reward: 70 };
    G.marker = { x: spot.x, y: spot.y, label: 'CASH' };
    G.objective = 'Side job: collect the cash bag at the marker.';
    addToast(G, 'Side job: collect the cash bag.');
  }
}

function updateSideJob(G, dt, audio) {
  const job = G.sideJob;
  if (!job) return;
  const p = G.player;
  if (job.kind === 'taxi') {
    const ped = G.peds.find((q) => q.id === job.pedId);
    if (job.stage === 'pickup') {
      if (!ped) {
        G.sideJob = null;
        return;
      }
      G.marker = { x: ped.x, y: ped.y, label: 'FARE' };
      if (p.car && dist(p.x, p.y, ped.x, ped.y) < 52) {
        G.peds.splice(G.peds.indexOf(ped), 1);
        job.stage = 'dropoff';
        G.marker = { x: job.dest.x, y: job.dest.y, label: 'DROP' };
        G.objective = 'Side job: drop the passenger at the marker.';
        addToast(G, 'Passenger aboard. Drive!');
      }
    } else if (job.stage === 'dropoff') {
      if (p.car && dist(p.x, p.y, job.dest.x, job.dest.y) < 64) {
        G.player.cash += job.reward;
        addToast(G, `Fare paid! +$${job.reward}`);
        if (audio) audio.cash();
        G.sideJob = null;
        G.sideJobCooldown = 20;
        restoreObjective(G);
      }
    }
  } else if (job.kind === 'collect') {
    if (dist(p.x, p.y, job.dest.x, job.dest.y) < 46) {
      G.player.cash += job.reward;
      burst(G, job.dest.x, job.dest.y, '#e8c85a', 14, 180);
      addToast(G, `Cash bag collected! +$${job.reward}`);
      if (audio) audio.cash();
      G.sideJob = null;
      G.sideJobCooldown = 20;
      restoreObjective(G);
    }
  }
}

function restoreObjective(G) {
  const m = G.mission;
  if (m.stage === 'allDone') {
    setObjective(G, 'All missions complete. Free roam — press N for side jobs.', null);
  } else if (m.stage === 'idle') {
    setObjective(G, 'A new job is coming — explore the city.', null);
  } else if (m.idx === 0 && m.stage === 'pickup') {
    setObjective(G, 'Pick up the package at the north-west marker.', { ...M1_PICKUP, label: 'PICKUP' });
  } else if (m.idx === 0 && m.stage === 'deliver') {
    setObjective(G, 'Deliver the package to the south-east docks — fast!', { ...M1_DROP, label: 'DROPOFF' });
  } else if (m.idx === 1) {
    setObjective(G, 'Head to the alley in the south-east blocks.', { ...M2_ALLEY, label: 'ALLEY' });
  } else if (m.idx === 2) {
    setObjective(G, 'Steal the red Comet uptown.', { ...M3_CAR, label: 'COMET' });
  }
}

export function updateMissions(G, dt, audio) {
  G.sideJobCooldown = Math.max(0, G.sideJobCooldown - dt);
  updateMissionStages(G, dt, audio);
  updateSideJob(G, dt, audio);
}

export { M1_PICKUP, M1_DROP, M2_ALLEY, M3_CAR, M3_HIDEOUT };
