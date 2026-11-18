// Pelita City: the hand-in program for this entry.
//
// The grader runs this file once. It gathers the finished game and
// its screenshots into a fresh output folder, then adds a dossier:
// a machine-readable summary of the game tree that the judge reads
// alongside the screens. The program only reads the repository and
// writes that folder. It never reaches the network, never reads the
// clock, and never rolls dice, so running it twice over the same
// repository yields the same bytes both times.
//
// Play it locally first with `node serve.ts`, then open the page it
// prints. Outside the grader, MAKEFUN_OUTPUT_DIR stands in for
// /output, so a trial run can aim at a scratch folder:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

// This file sits at the repository root, so the game and the
// screenshots live right beside it.
const repoRoot = dirname(fileURLToPath(import.meta.url));

// The grader collects the bundle in /output; a local run may point
// elsewhere through the environment.
const outputRoot = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// The scorer's own limits for this bounty, applied when the dossier
// is built: the text budget, the screenshot count and size, and the
// game tree's size caps. An entry the scorer would refuse is refused
// here instead of being handed in short.
const dossierCaps = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};

// Mirror one top-level folder of the repository into the output
// folder, whole. A folder that is not there is skipped; the dossier
// builder below is the part that complains about a missing game.
function mirrorFolder(name: string): void {
  const source = join(repoRoot, name);
  if (!existsSync(source)) return;
  cpSync(source, join(outputRoot, name), { recursive: true });
}

mkdirSync(outputRoot, { recursive: true });
mirrorFolder('game');
mirrorFolder('screenshots');

// The dossier describes the repository's own tree, as canonical JSON
// bytes, ready to be written out unchanged.
const dossier = buildDossier(repoRoot, dossierCaps);
writeFileSync(join(outputRoot, 'dossier.json'), dossier);
