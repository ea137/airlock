// Runs the game: steps the play exactly 60 times a second whatever the
// screen's rate, draws after each frame, moves between the title, a zone's
// card, play, pause, the world map and game over, plays the music and
// effects, and saves. It runs only while the game is open and showing:
// stop() cancels the frame loop, silences the sound and saves.

import { type Sfx, Sound } from './audio';
import { EV, EVENT_STRIDE } from './events';
import { type Buttons, Keys, Merge, noButtons } from './input';
import { jingle } from './music';
import { Renderer, type Screen, TITLE_MAP_Y } from './render';
import { clearSave, readSave, readSettings, restore, snapshot, writeSave, writeSettings } from './save';
import { type Input, Play } from './sim';
import type { Skin } from './skin';
import { clock, type MapAction, type MapButton, type Spot, WorldMap } from './world';

export const TITLE = 'HOP COUNT';

const STEP_MS = 1000 / 60;
const SAVE_EVERY = 300;
const CARD_TICKS = 110;

const MENU_BUTTONS: (keyof Buttons)[] = ['up', 'down', 'a', 'b', 'start', 'select'];
const MAP_BUTTONS: MapButton[] = ['left', 'right', 'up', 'down', 'a', 'b'];

const SOUNDS: Partial<Record<number, Sfx>> = {
  [EV.JUMP]: 'jump',
  [EV.STOMP]: 'stomp',
  [EV.BIT]: 'bit',
  [EV.BUMP]: 'bump',
  [EV.BREAK]: 'break',
  [EV.POWER]: 'power',
  [EV.GROW]: 'grow',
  [EV.HURT]: 'hurt',
  [EV.KICK]: 'kick',
  [EV.SPRING]: 'spring',
  [EV.KEY]: 'key',
  [EV.LIFE]: 'life',
  [EV.CHECK]: 'check',
  [EV.FLAG]: 'flag',
  [EV.SHOOT]: 'shoot',
  [EV.SWITCH]: 'switch',
  [EV.PIPE]: 'pipe',
  [EV.SPLASH]: 'splash',
  [EV.BOSS_HIT]: 'bossHit',
  [EV.BOSS_DIE]: 'bossDie',
  [EV.SWIM]: 'swim',
  [EV.FLAP]: 'flap',
  [EV.ITEM]: 'item',
  [EV.LOCK]: 'power',
  [EV.KILL]: 'stomp',
  [EV.BOSS_LAND]: 'land',
};

export class Game {
  readonly play: Play;
  readonly renderer: Renderer;
  readonly sound = new Sound();
  screen: Screen = 'title';
  /** Called when the screen changes (the page shows the pause menu), and when the map's packet moves (the page says where). */
  onScreen: (screen: Screen) => void = () => {};
  /** The world map while it's up. */
  private map: WorldMap | null = null;
  /** Where B on the map goes back to. */
  private mapBack: Screen = 'paused';
  /** The map was opened partway through a hop: picking that hop carries on where it was. */
  private mapResumes = false;
  /** The buttons from each source, merged each tick. */
  readonly keys = noButtons();
  readonly touch = noButtons();
  /** The keyboard, which the page feeds; its presses last until a tick has seen them. */
  readonly keyboard = new Keys(this.keys);
  /** The Game Boy case's buttons, shared with its shell. */
  readonly pad: Buttons;
  /** The three as one, where the latest of left and right counts. */
  private readonly sources: Merge;
  private readonly held = noButtons();
  private readonly before = noButtons();
  private readonly input: Input = { left: false, right: false, up: false, down: false, a: false, b: false };
  private frameId = 0;
  private last = 0;
  private spare = 0;
  private cardLeft = 0;
  private sinceSave = 0;
  /** The hop the card was last shown for, as zone * 8 + hop. */
  private placed = 0;
  /** What's playing: zone * 16 + hop * 2 + boss, or -1 to start again. */
  private song = -1;
  private wasMode = '';
  muted: boolean;
  /** A button pressed while the pause menu is up (the case's buttons drive it). */
  onMenu: (button: keyof Buttons) => void = () => {};
  /** B and Select together: close the game. */
  onClose: () => void = () => {};

  constructor(canvas: HTMLCanvasElement, pad = noButtons()) {
    this.pad = pad;
    this.sources = new Merge([this.keys, this.touch, pad]);
    this.renderer = new Renderer(canvas);
    this.muted = readSettings().muted;
    this.sound.muted = this.muted;
    const saved = readSave();
    this.play = new Play((Math.random() * 2 ** 32) >>> 0);
    if (saved) {
      restore(this.play, saved);
      this.screen = 'paused';
      this.placed = this.where();
    } else {
      this.screen = 'title';
    }
  }

  get running(): boolean {
    return this.frameId !== 0;
  }

  setSkin(skin: Skin, motion: boolean): void {
    this.renderer.setSkin(skin, motion);
    this.sound.setTimbre(skin.theme);
    if (!this.running) this.render();
  }

  resize(w: number, h: number): void {
    this.renderer.resize(w, h);
    this.play.viewW = w;
    this.play.viewH = h;
    // A resumed game keeps its camera exactly; a fresh one starts on the packet.
    if (this.screen === 'title' || this.screen === 'card') this.play.snapCamera();
    if (!this.running) this.render();
  }

  /** Starts the frame loop (the game is open and showing). */
  start(): void {
    if (this.frameId) return;
    this.last = performance.now();
    this.spare = 0;
    this.frameId = requestAnimationFrame(this.tick);
    if (this.screen === 'play') this.sound.resume();
  }

  /** Stops everything: no frames, no sound, and the game saved. */
  stop(): void {
    if (this.frameId) cancelAnimationFrame(this.frameId);
    this.frameId = 0;
    this.sound.suspend();
    this.save();
  }

  close(): void {
    this.stop();
    this.sound.close();
  }

  save(): void {
    if (this.screen === 'title') return;
    writeSave(snapshot(this.play));
  }

  /** Lets the sound start: call from a touch, click or key. */
  unlockSound(): void {
    this.sound.unlock();
    if (this.screen !== 'play') this.sound.suspend();
  }

  pause(): void {
    if (this.screen !== 'play' && this.screen !== 'card') return;
    this.setScreen('paused');
    this.sound.sfx('pause');
    this.sound.suspend();
    this.save();
  }

  resume(): void {
    if (this.screen !== 'paused') return;
    this.setScreen('play');
    this.sound.resume();
    this.song = -1;
  }

  newGame(): void {
    clearSave();
    this.play.newGame((Math.random() * 2 ** 32) >>> 0);
    this.showCard();
  }

  /** Opens the world map, from the title or the pause menu. */
  openMap(): void {
    if (this.screen !== 'title' && this.screen !== 'paused') return;
    this.mapBack = this.screen;
    this.mapResumes = this.screen === 'paused';
    this.showMap(null);
  }

  /** A tap on the canvas, in page pixels: starts on the title and after a game over, picks on the map. */
  tapAt(clientX: number, clientY: number): void {
    const rect = this.renderer.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const x = ((clientX - rect.left) * this.renderer.w) / rect.width;
    const y = ((clientY - rect.top) * this.renderer.h) / rect.height;
    if (this.screen === 'map' && this.map) this.mapAct(this.map.tap(x, y));
    else if (this.screen === 'title' && Math.abs(y - TITLE_MAP_Y - 2) <= 6) this.openMap();
    else if (this.screen === 'title') this.newGame();
    else if (this.screen === 'over') this.retry();
  }

  /** The map's picked hop in words, for a screen reader. */
  mapStatus(): string {
    const map = this.map;
    if (!map) return '';
    const node = map.picked;
    const zone = map.zones[node.zone - 1];
    const where = `${node.zone}-${node.hop}, ${node.hop === 4 ? `the core of ${zone?.name ?? 'the zone'}` : `${zone?.name ?? 'zone'} hop ${node.hop}`}`;
    if (!node.open) return `World map. ${where}: locked. B to go back.`;
    const record = this.play.world.get(node.zone, node.hop);
    const done = record.cleared ? 'cleared' : record.backdoor ? 'left by its backdoor' : 'not cleared yet';
    const time = record.time > 0 ? `, best time ${clock(record.time)}` : '';
    const here = this.mapResumes && node.zone === this.play.zone && node.hop === this.play.hop;
    return `World map. ${where}: ${done}, ${record.keys.length} of 3 keys${time}. A to ${here ? 'carry on' : 'play'}, B to go back.`;
  }

  /** After a game over: the zone again from its first hop. */
  private retry(): void {
    this.play.continueZone();
    this.showCard();
  }

  private showMap(from: Spot | null): void {
    const play = this.play;
    this.map = new WorldMap(play.world, play.seed, { zone: play.zone, hop: play.hop }, from ? play.opened : [], from);
    this.map.tick(this.held, this.renderer.w);
    this.sound.stopSong();
    this.sound.suspend();
    this.setScreen('map');
  }

  /** What the map asked for: a move to read out, a hop to play, or back. */
  private mapAct(action: MapAction): void {
    if (action === null || action === 'locked') return;
    if (action === 'moved') {
      this.onScreen('map');
      return;
    }
    this.map = null;
    if (action === 'back') {
      this.setScreen(this.mapBack);
      return;
    }
    const play = this.play;
    const here = action.zone === play.zone && action.hop === play.hop;
    if (this.mapBack === 'title') {
      // Nothing played yet: only the first hop is open.
      this.newGame();
    } else if (here && this.mapResumes) {
      this.setScreen('play');
      this.sound.resume();
      this.song = -1;
    } else {
      if (!here) play.startLevel(action.zone, action.hop);
      // The map hushed the sound; the hop has its own.
      this.sound.resume();
      this.showCard();
    }
  }

  toggleMute(): void {
    this.muted = !this.muted;
    this.sound.setMuted(this.muted);
    writeSettings({ muted: this.muted });
    if (!this.muted && this.screen === 'play') this.sound.resume();
  }

  private setScreen(screen: Screen): void {
    if (screen === this.screen) return;
    this.screen = screen;
    this.onScreen(screen);
  }

  private showCard(): void {
    this.cardLeft = CARD_TICKS;
    this.placed = this.where();
    this.song = -1;
    this.sound.stopSong();
    this.setScreen('card');
    this.play.snapCamera();
  }

  private where(): number {
    return this.play.zone * 8 + this.play.hop;
  }

  private readonly tick = (now: number): void => {
    this.frameId = requestAnimationFrame(this.tick);
    // A long gap (the tab was away) isn't caught up.
    const elapsed = Math.min(100, now - this.last);
    this.last = now;
    this.spare += elapsed;
    let steps = 0;
    while (this.spare >= STEP_MS && steps < 4) {
      this.spare -= STEP_MS;
      this.update();
      steps += 1;
    }
    if (steps === 4) this.spare = 0;
    this.render();
    this.sound.pump();
  };

  private pressed(name: keyof Buttons): boolean {
    return this.held[name] && !this.before[name];
  }

  /** One fixed step: buttons, then the screen's own logic. */
  private update(): void {
    this.sources.into(this.held);
    this.keyboard.seen();
    const play = this.play;
    if (this.held.b && this.held.select && !(this.before.b && this.before.select)) {
      Object.assign(this.before, this.held);
      this.onClose();
      return;
    }
    switch (this.screen) {
      case 'title':
        if (this.pressed('start') || this.pressed('a')) this.newGame();
        else if (this.pressed('b') || this.pressed('select')) this.openMap();
        break;
      case 'map': {
        const map = this.map;
        if (!map) break;
        let action: MapAction = null;
        for (const button of MAP_BUTTONS) if (this.pressed(button)) action = map.press(button) ?? action;
        if (this.pressed('start')) action = map.press('a');
        const walked = map.tick(this.held, this.renderer.w);
        this.mapAct(action ?? walked);
        break;
      }
      case 'card':
        this.cardLeft -= 1;
        if (this.pressed('start')) this.pause();
        else if (this.cardLeft <= 0 || (this.cardLeft < CARD_TICKS - 30 && this.pressed('a'))) this.setScreen('play');
        break;
      case 'paused':
        for (const button of MENU_BUTTONS) if (this.pressed(button)) this.onMenu(button);
        break;
      case 'over':
        if (this.pressed('a') || this.pressed('start')) this.retry();
        break;
      case 'play':
        if (this.pressed('start')) {
          this.pause();
          break;
        }
        this.input.left = this.held.left;
        this.input.right = this.held.right;
        this.input.up = this.held.up;
        this.input.down = this.held.down;
        this.input.a = this.held.a;
        this.input.b = this.held.b;
        play.step(this.input);
        this.renderer.effects(play);
        this.sounds();
        this.music();
        if (play.mode === 'over') {
          this.sound.playJingle(jingle('over', play.level.zone.song));
          this.setScreen('over');
          this.save();
        } else if (this.where() !== this.placed) {
          // Cleared: the map, with what that opened, and the packet off to the next hop.
          const from = { zone: Math.floor(this.placed / 8), hop: this.placed % 8 };
          this.placed = this.where();
          this.mapBack = 'paused';
          this.mapResumes = false;
          this.showMap(from);
          this.save();
        }
        this.sinceSave += 1;
        if (this.sinceSave >= SAVE_EVERY) {
          this.sinceSave = 0;
          this.save();
        }
        break;
    }
    Object.assign(this.before, this.held);
  }

  private sounds(): void {
    const ev = this.play.events;
    for (let i = 0; i < ev.count; i += 1) {
      const what = ev.data[i * EVENT_STRIDE] ?? 0;
      if (what === EV.DIE) this.sound.sfx('die');
      else if (what === EV.CLEAR || what === EV.SECRET) this.sound.playJingle(jingle('clear', this.play.level.zone.song));
      else if (what === EV.RESPAWN) this.song = -1;
      else {
        const sfx = SOUNDS[what];
        if (sfx) this.sound.sfx(sfx);
      }
    }
  }

  /** Plays the right song: the zone's, the boss's, faster with the lock. */
  private music(): void {
    const play = this.play;
    if (play.mode === 'dying' || play.mode === 'clear' || play.mode === 'over') {
      this.wasMode = play.mode;
      return;
    }
    const boss = play.bossOn && (play.bossEnt?.state ?? -1) >= 0;
    const song = play.zone * 16 + play.hop * 2 + (boss ? 1 : 0);
    if (song !== this.song || this.wasMode !== play.mode) {
      this.song = song;
      this.wasMode = play.mode;
      this.sound.playSong(play.level.zone.song, boss);
    }
    this.sound.speed = play.star > 0 ? 1.25 : 1;
  }

  render(): void {
    if (this.screen === 'map' && this.map) this.renderer.drawMap(this.play, this.map, this.mapResumes);
    else this.renderer.draw(this.play, this.screen, { best: this.play.best, muted: this.muted, title: TITLE, card: this.cardLeft });
  }
}
