// The bosses that guard each zone's core. Five patterns, each telegraphed
// and each with an opening: the Stack Overflow hops and sends shockwaves
// along the floor; Kernel Panic hovers, bombs, then swoops low; the Spam
// King charges and is dazed when it hits a wall; the Rootkit burrows and
// bursts up under you; the DDoS core hides behind its swarm and comes down
// to rest. All of them get quicker as they lose health.

import { EV } from './events';
import { K } from './kinds';
import type { Ent, Play } from './sim';
import { TILE } from './tiles';

export const BOSS_NAME = {
  hopper: 'STACK OVERFLOW',
  swooper: 'KERNEL PANIC',
  charger: 'SPAM KING',
  burrower: 'ROOTKIT',
  swarm: 'DDOS',
} as const;

function shot(play: Play, x: number, y: number, vx: number, vy: number, gravity: boolean, burst: boolean): void {
  const e = play.spawn(K.SHOT_BOSS, x, y);
  if (!e) return;
  e.x = x;
  e.y = y;
  e.vx = vx;
  e.vy = vy;
  e.state = gravity ? 1 : 0;
  e.c = burst ? 0 : 1;
}

export function maxBossHp(zone: number): number {
  return (3 + Math.min(3, Math.floor((zone - 1) / 4))) * 4;
}

export function updateBoss(play: Play, e: Ent): void {
  const kind = play.level.boss;
  if (!kind) return;
  if (e.t2 > 0) e.t2 -= 1;
  const b = play.body;
  const px = b.x + b.w / 2;
  const ex = e.x + e.w / 2;
  const room = play.level.rooms[0];
  const left = (play.gateX + 1) * TILE;
  const right = ((room?.w ?? 40) - 1) * TILE - e.w;
  const pace = 1 + (1 - e.hp / maxBossHp(play.zone)) * 0.7 + Math.min(0.5, play.zone * 0.03);
  e.t += 1;
  e.a = 0;

  switch (kind) {
    case 'hopper':
      play.fall(e);
      if (e.state === 0) {
        e.vx = 0;
        if (e.t > 55 / pace) {
          e.state = 1;
          e.t = 0;
          e.vx = Math.max(-1.9, Math.min(1.9, (px - ex) / 42));
          e.vy = -4.3;
          e.dir = Math.sign(e.vx) || 1;
        }
      }
      play.moveEnt(e);
      if (e.state === 1 && e.onGround && e.t > 4) {
        e.state = 0;
        e.t = 0;
        play.shake = Math.max(play.shake, 8);
        play.events.push(EV.BOSS_LAND, ex, e.y + e.h);
        for (const dir of [-1, 1]) {
          const wave = play.spawn(K.SHOT_WAVE, e.x + (dir > 0 ? e.w : -8), e.y + e.h - 8);
          if (wave) {
            wave.x = e.x + (dir > 0 ? e.w : -8);
            wave.y = e.y + e.h - wave.h;
            wave.vx = dir * (1.1 + pace * 0.25);
          }
        }
      }
      break;

    case 'swooper': {
      const hoverY = (play.level.rooms[0]?.h ?? 18) * TILE - 12 * TILE;
      if (e.state === 0) {
        e.y += (hoverY - e.y) * 0.05;
        e.x += e.dir * 0.8 * pace;
        if (e.x < left || e.x > right) e.dir = -e.dir;
        if (e.t % Math.round(60 / pace) === 0) shot(play, ex - 2, e.y + e.h, 0, 0.5, true, true);
        if (e.t > 230) {
          e.state = 1;
          e.t = 0;
          e.ox = Math.max(left, Math.min(right, px - e.w / 2));
        }
      } else if (e.state === 1) {
        // The swoop: straight at where the packet was.
        e.x += Math.sign(e.ox - e.x) * Math.min(2, Math.abs(e.ox - e.x));
        e.vy = 2.2;
        if (play.moveEnt(e) & 2 || e.onGround) {
          e.state = 2;
          e.t = 0;
          play.shake = Math.max(play.shake, 6);
          play.events.push(EV.BOSS_LAND, ex, e.y + e.h);
        }
      } else if (e.state === 2) {
        if (e.t > 80 / Math.min(1.4, pace)) {
          e.state = 3;
          e.t = 0;
        }
      } else {
        e.y -= 1.2;
        if (e.y <= hoverY) {
          e.state = 0;
          e.t = 0;
        }
      }
      break;
    }

    case 'charger':
      play.fall(e);
      if (e.state === 0) {
        e.c = 1;
        e.dir = px < ex ? -1 : 1;
        e.vx = e.dir * 0.45 * pace;
        if (e.t % 95 === 0) {
          const spam = play.spawn(K.SHOT_SPAM, e.x, e.y);
          if (spam) {
            spam.vx = e.dir * 1.3;
            spam.vy = -3;
          }
        }
        if (e.t > 150) {
          e.state = 1;
          e.t = 0;
          e.vx = 0;
        }
      } else if (e.state === 1) {
        // The tell: it paws the ground.
        e.vx = 0;
        if (e.t > 36) {
          e.state = 2;
          e.t = 0;
        }
      } else if (e.state === 2) {
        e.vx = e.dir * (2.2 + pace * 0.4);
      } else {
        e.vx = 0;
        e.c = 0;
        if (e.t > 110) {
          e.state = 0;
          e.t = 0;
        }
      }
      if (play.moveEnt(e) & 1 && e.state === 2) {
        e.state = 3;
        e.t = 0;
        e.vy = -2;
        play.shake = Math.max(play.shake, 12);
        play.events.push(EV.BOSS_LAND, ex, e.y + e.h);
      }
      break;

    case 'burrower':
      if (e.state === 0) {
        // Under the floor, following the packet.
        e.a = 1;
        e.c = 1;
        e.x += Math.sign(px - ex) * Math.min(Math.abs(px - ex), 0.9 * pace);
        e.x = Math.max(left, Math.min(right, e.x));
        if (e.t > 110 / pace) {
          e.state = 1;
          e.t = 0;
        }
      } else if (e.state === 1) {
        e.a = 1;
        if (e.t > 32) {
          e.state = 2;
          e.t = 0;
          e.vy = -4.6;
          e.c = 0;
        }
      } else if (e.state === 2) {
        const rising = e.vy < 0;
        play.fall(e);
        play.moveEnt(e);
        if (rising && e.vy >= 0) {
          for (const vx of [-1.3, 0, 1.3]) shot(play, ex - 2, e.y, vx, -1.8, true, false);
        }
        if (e.onGround && e.t > 6) {
          e.state = 3;
          e.t = 0;
          play.events.push(EV.BOSS_LAND, ex, e.y + e.h);
        }
      } else {
        play.fall(e);
        play.moveEnt(e);
        if (e.t > 85 / Math.min(1.5, pace)) {
          e.state = 0;
          e.t = 0;
        }
      }
      break;

    case 'swarm': {
      const hoverY = (play.level.rooms[0]?.h ?? 18) * TILE - 11 * TILE;
      const groundY = (play.level.rooms[0]?.h ?? 18) * TILE - 2 * TILE - e.h;
      if (e.state === 0) {
        e.y += (hoverY + Math.sin(e.t * 0.05) * 6 - e.y) * 0.08;
        e.x += (left + (right - left) / 2 + Math.sin(e.t * 0.017) * 40 - e.x) * 0.03;
        if (e.t % 140 === 20) {
          let moths = 0;
          for (const other of play.ents) if (other.k === K.MOTH && other.state >= 0) moths += 1;
          for (let i = 0; i < 3 && moths < 6; i += 1, moths += 1) {
            const moth = play.spawn(K.MOTH, e.x + i * 6 - 6, e.y);
            if (moth) {
              moth.active = true;
              moth.oy = e.y - 8 + i * 10;
              moth.t = i * 40;
              moth.dir = px < ex ? -1 : 1;
            }
          }
        }
        if (e.t % Math.round(90 / pace) === 0) {
          const dx = px - ex;
          const dy = b.y - e.y;
          const len = Math.max(1, Math.hypot(dx, dy));
          shot(play, ex - 2, e.y + e.h / 2, (dx / len) * 1.1, (dy / len) * 1.1, false, false);
        }
        if (e.t > 320) {
          e.state = 1;
          e.t = 0;
        }
      } else if (e.state === 1) {
        e.y += (groundY - e.y) * 0.08;
        if (e.t > 40) {
          e.state = 2;
          e.t = 0;
        }
      } else if (e.state === 2) {
        if (e.t > 90) {
          e.state = 3;
          e.t = 0;
        }
      } else {
        e.y += (hoverY - e.y) * 0.06;
        if (e.t > 40) {
          e.state = 0;
          e.t = 0;
        }
      }
      break;
    }
  }
}
