// World geometry and tuning constants. The city is a square grid of roads;
// everything else (spawns, AI, rendering) derives from these numbers.

export const STEP = 1 / 60;
export const WORLD = 3200; // world is WORLD x WORLD pixels, origin at top-left
export const BLOCK = 400; // distance between road centre lines
export const ROAD_W = 64; // road width
export const NODES = 9; // intersections per side (0..8), at multiples of BLOCK
export const CITY_SEED = 20261117; // fixed: the same city every load

export const SAVE_KEY = 'pelita-city-save-v1';
export const DAY_LEN = 240; // seconds per full day/night cycle

// Player on foot
export const WALK_SPEED = 175;
export const RUN_SPEED = 235; // while holding Shift
export const PLAYER_R = 14;
export const PLAYER_HP = 100;
export const PUNCH_RANGE = 52;
export const PUNCH_DMG = 25;
export const SHOT_DMG = 34;

// Driving
export const CAR_ACCEL = 420;
export const CAR_BRAKE = 620;
export const CAR_MAX_SPEED = 540;
export const CAR_REVERSE_MAX = 170;
export const CAR_TURN = 2.6; // rad/s at full lock, scaled by speed
export const CAR_GRIP = 1.6; // lateral velocity damping (1/s)

// Wanted / police
export const MAX_WANTED = 5;
export const COP_TOP_SPEED = 560;
export const COP_ACCEL = 470;
export const DECAY_UNSEEN = 8; // seconds unseen before stars start dropping
export const DECAY_PERIOD = 6; // seconds per star lost while unseen

// Combat
export const BULLET_SPEED = 920;
export const ENEMY_BULLET_SPEED = 700;
export const MELEE_HP = 60;
export const SHOOTER_HP = 50;
export const MELEE_DMG = 8;
export const ENEMY_SHOT_DMG = 10;

// Palette (canvas colours live here so render + minimap agree)
export const COLORS = {
  grass: '#39543a',
  grassDark: '#314a33',
  sidewalk: '#5d5f5b',
  sidewalkEdge: '#4c4e4a',
  road: '#33363c',
  roadEdge: '#2a2d32',
  marking: '#c9c46a',
  crosswalk: '#d8d8d2',
  buildingRoof: '#7d7468',
  buildingSide: '#5f584e',
  park: '#2e4a2c',
  water: '#3d6a8a',
};
