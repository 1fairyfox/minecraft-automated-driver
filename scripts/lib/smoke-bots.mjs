// Shared Mineflayer bot registry for the real smoke scripts (nav-smoke, combat-smoke): loads the
// pathfinder (navigate), collectblock (gather) and pvp (hunt) plugins once, so each smoke expresses
// only its scenario, not the plugin-wiring boilerplate (and so the wiring lives in exactly one place).
import mineflayer from 'mineflayer';
import { Vec3 } from 'vec3';
import pathfinderPkg from 'mineflayer-pathfinder'; // CommonJS — import the default, then destructure
import { plugin as collectBlock } from 'mineflayer-collectblock';
import { plugin as pvp } from 'mineflayer-pvp';
import { createBotRegistry } from '../../src/bot.mjs';

const { pathfinder, Movements, goals } = pathfinderPkg;

/** A bot registry whose bots have pathfinder + collectblock + pvp loaded (navigate/gather/hunt). */
export function createSmokeBots() {
  return createBotRegistry({
    createBot: (opts) => {
      const b = mineflayer.createBot(opts);
      b.vec3 = (x, y, z) => new Vec3(x, y, z);
      b.loadPlugin(pathfinder);
      b.loadPlugin(collectBlock);
      b.loadPlugin(pvp);
      b.once('spawn', () => b.pathfinder.setMovements(new Movements(b)));
      return b;
    },
    goalNear: (x, y, z, range) => new goals.GoalNear(x, y, z, range),
  });
}
