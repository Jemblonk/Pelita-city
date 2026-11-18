// Pelita City, handed in.
//
// This is the entrypoint the grader runs. It gathers the finished game and
// its screenshots into the directory the grader reads, then adds the
// summary document the judge uses to look the entry over. It runs on the
// Node standard library alone, talks to no network, and given the same
// repository twice it lays down the same bytes twice.

import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

// Where the finished entry goes: the grader's /output, unless a local run
// points MAKEFUN_OUTPUT_DIR somewhere else.
const destination = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// The repository root is the folder this file lives in, whatever directory
// the program happens to be launched from.
const root = dirname(fileURLToPath(import.meta.url));

// The summary's limits, the same ones the scorer applies: how much source
// text the summary may carry, how many screenshots and how large each may
// be, and how big a game tree it accepts. Passing them all means this
// program refuses exactly where the scorer would refuse.
const summaryCaps = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};

function handIn(): void {
  mkdirSync(destination, { recursive: true });
  cpSync(join(root, 'game'), join(destination, 'game'), { recursive: true });
  cpSync(join(root, 'screenshots'), join(destination, 'screenshots'), {
    recursive: true,
  });
  const summary = buildDossier(destination, summaryCaps);
  writeFileSync(join(destination, 'dossier.json'), summary);
}

handIn();
