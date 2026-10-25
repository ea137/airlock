// Runs the story: steps the world exactly 60 times a second whatever the
// screen's rate, draws after each frame, and moves between the title, a
// chapter's card, play, a conversation, the menus and the ending. It plays
// the music and the sounds, lets the companions speak up, and saves. It
// runs only while the game is open and showing: stop() cancels the frame
// loop, silences the sound and saves.
//
// The page sees the game through `view`, a plain object it hands in (a
// Svelte state, there) that the engine writes only when something on it
// changes: the line being typed, the choices, a remark, which menu is up.

import { Sound, type Sfx } from '../game/audio';
import { jingle } from '../game/music';
import type { Skin } from '../game/skin';
import { CHATS, LEAD, REMARKS, TEL_HINT } from './banter';
import { personOf } from './cast';
import { chapterOf, CORE, LAST_CHAPTER, START } from './content';
import { Controls, emptyFrame, type Frame } from './input';
import { EV, NO } from './kinds';
import { Library } from './library';
import { nextNode, worldMap, type WorldMap } from './map';
import { Renderer, type Screen } from './render';
import { clearSave, readSave, readSettings, restore, snapshot, writeSave, writeSettings } from './save';
import { World } from './sim';
import { CHAPTER_SONG, songFor } from './songs';
import { type Choice, Talk } from './talk';
import type { Companion } from './world';

export const TITLE = 'KEEPALIVE';

const STEP_MS = 1000 / 60;
const SAVE_EVERY = 300;
/** Letters typed a tick. */
const TYPE_RATE = 0.8;
const CARD_TICKS = 220;
const REMARK_TICKS = 200;
const CHAT_EVERY = 2400;

export type Menu = '' | 'pause' | 'rest' | 'map' | 'log' | 'quests' | 'party';

/** The chapters' cards: the label, the name, and a line under it. */
export const CHAPTERS: [string, string, string][] = [
  ['PROLOGUE', 'LOOPBACK', 'THE LAST TOWN THAT ANSWERS'],
  ['CHAPTER 1', 'THE CRONTAB', 'EVERYTHING ON TIME. NOTHING ARRIVES.'],
  ['CHAPTER 2', 'PERMISSION DENIED', 'THE STACKS, WHERE ROOT KEEPS THINGS'],
  ['CHAPTER 3', 'PACKET LOSS', 'ACROSS THE BUFFER'],
  ['CHAPTER 4', 'LEGACY', 'THE OLD PORTS, IN THE CLEAR'],
  ['CHAPTER 5', 'KEEPALIVE', 'INTO THE NULL'],
  ['EPILOGUE', 'REPLY', 'THE NETWORK, AFTER'],
];

/** What the page shows over the canvas. */
export type View = {
  screen: Screen;
  /** The line: who says it, their name and colour, its words and how many are typed. */
  who: string;
  name: string;
  colour: string;
  text: string;
  shown: number;
  choices: Choice[];
  /** A companion's remark over the play. */
  toast: string;
  toastName: string;
  toastColour: string;
  toastId: number;
  menu: Menu;
  /** Which ending was reached, once one is. */
  ending: string;
  /** What a screen reader hears. */
  status: string;
  hasSave: boolean;
  /** The chapters a save needs are still on their way. */
  loading: boolean;
  /** The place picked on the world map, by its index. */
  mapAt: number;
  /** Bumped whenever the lists in the menus may have changed. */
  version: number;
};

export function emptyView(): View {
  return {
    screen: 'title',
    who: '',
    name: '',
    colour: '',
    text: '',
    shown: 0,
    choices: [],
    toast: '',
    toastName: '',
    toastColour: '',
    toastId: 0,
    menu: '',
    ending: '',
    status: '',
    hasSave: false,
    loading: false,
    mapAt: 0,
    version: 0,
  };
}

const SOUNDS: Partial<Record<number, Sfx>> = {
  [EV.PING]: 'bit',
  [EV.FREEZE]: 'power',
  [EV.THAW]: 'pause',
  [EV.HOVER]: 'flap',
  [EV.FORCE]: 'kick',
  [EV.BREAK]: 'break',
  [EV.PUSH]: 'bump',
  [EV.FILL]: 'land',
  [EV.HURT]: 'hurt',
  [EV.FALL]: 'pipe',
  [EV.TIMEOUT]: 'die',
  [EV.CAUGHT]: 'hurt',
  [EV.NODE]: 'switch',
  [EV.SWITCH]: 'item',
  [EV.BUMP]: 'bump',
  [EV.BOSS_HIT]: 'bossHit',
  [EV.BOSS_DOWN]: 'bossDie',
  [EV.CHECK]: 'check',
  [EV.NO]: 'bump',
  [EV.STUN]: 'stomp',
  [EV.POP]: 'stomp',
  [EV.WHIFF]: 'swim',
  [EV.SHOT]: 'shoot',
  [EV.CRUSH]: 'land',
  [EV.BOSS_PHASE]: 'grow',
};

const ITEM_WORDS = ['A LOG', 'A FRAGMENT', 'A LETTER', 'A SPARE HEARTBEAT', 'A KEY'];

export class Game {
  readonly world: World;
  readonly talk: Talk;
  readonly renderer: Renderer;
  readonly sound = new Sound();
  readonly controls = new Controls();
  /** The Game Boy case's buttons, shared with its shell (polled each tick). */
  pad: Record<string, boolean> | null = null;
  readonly view: View;
  muted: boolean;
  /** A key's control while a menu is up (the page moves focus with it). */
  onMenu: (control: 'up' | 'down' | 'left' | 'right' | 'a' | 'b') => void = () => {};
  /** B and Select together: close the game. */
  onClose: () => void = () => {};
  /** Everything held let go of: the shell lets go of the case's buttons too. */
  onLetGo: () => void = () => {};
  /** The log of what was said, for rereading. */
  readonly log: [string, string][] = [];
  private readonly frame: Frame = emptyFrame();
  private frameId = 0;
  private last = 0;
  private spare = 0;
  private sinceSave = 0;
  private played = 0;
  private typed = 0;
  private cardLeft = 0;
  private card = 0;
  private pendingCard = -1;
  private pendingEnd = false;
  private song = '';
  private songOverride = '';
  private remarkLeft = 0;
  private readonly queue: [Companion, string][] = [];
  private sinceChat = 0;
  private readonly said = new Set<number>();
  private counter = 0;

  constructor(canvas: HTMLCanvasElement, view: View, library = new Library()) {
    this.view = view;
    this.library = library;
    library.add(CORE, 0);
    this.renderer = new Renderer(canvas);
    this.world = new World(library.areas, START.area);
    library.onAreas = (areas) => this.world.addAreas(areas);
    this.talk = new Talk(library.scenes, { test: (c) => this.world.story.test(c), act: (fx) => this.world.act(fx) });
    this.talk.onLine = (who, text) => this.line(who, text);
    this.talk.onEnd = () => this.endTalk();
    const settings = readSettings();
    this.muted = settings.muted;
    this.sound.muted = this.muted;
    this.world.newGame(START.area, START.mark);
    this.world.want = '';
    this.setScreen('title');
    const saved = readSave();
    if (saved) {
      // The chapters the save needs come first; until then, Continue waits.
      view.loading = true;
      void library.loadUpTo(Math.max(saved.chapter, chapterOf(saved.area))).then(
        () => {
          if (restore(this.world, saved)) {
            this.log.push(...saved.log);
            this.played = saved.played;
            view.hasSave = true;
            this.resumeTalk = saved.talk;
            this.prefetch();
          }
          view.loading = false;
          this.describe();
        },
        () => {
          view.loading = false;
        },
      );
    } else {
      this.prefetch();
    }
  }

  readonly library: Library;

  /** Fetches the chapter after the one you're in, so it's there by the time you are. */
  private prefetch(): void {
    const next = Math.max(this.world.story.chapter, chapterOf(this.world.area.id)) + 1;
    if (next <= LAST_CHAPTER) this.library.load(next).catch(() => {});
  }

  /** A conversation the save stopped in, to pick up on Continue. */
  private resumeTalk: [string, number] | null = null;

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
    if (!this.running) this.render();
  }

  start(): void {
    if (this.frameId) return;
    this.last = performance.now();
    this.spare = 0;
    this.frameId = requestAnimationFrame(this.tick);
    if (this.view.screen !== 'menu') this.sound.resume();
  }

  /** Stops everything: no frames, no sound, nothing held, and the game saved. */
  stop(): void {
    if (this.frameId) cancelAnimationFrame(this.frameId);
    this.frameId = 0;
    this.controls.clear();
    this.sound.suspend();
    this.save();
  }

  close(): void {
    this.stop();
    this.sound.close();
  }

  save(): void {
    if (this.view.screen === 'title' && !this.view.hasSave) return;
    if (this.view.screen === 'title') return;
    const talk: [string, number] | null = this.talk.scene ? [this.talk.scene.id, this.talk.at] : null;
    writeSave(snapshot(this.world, talk, this.log, this.played));
    this.view.hasSave = true;
  }

  /** Starts the sound on a touch or key; muted, there's no sound at all to start. */
  unlockSound(): void {
    if (this.muted) return;
    this.sound.unlock();
    if (this.view.screen === 'menu') this.sound.suspend();
  }

  /** Called from the touch or key that asked for it, so unmuting can start the sound. */
  toggleMute(): void {
    this.muted = !this.muted;
    this.sound.setMuted(this.muted);
    writeSettings({ muted: this.muted });
    if (this.muted) return;
    this.unlockSound();
    if (this.view.screen !== 'menu') this.sound.resume();
  }

  private setScreen(screen: Screen): void {
    if (this.view.screen !== screen) this.view.screen = screen;
    if (screen !== 'menu' && this.view.menu) this.view.menu = '';
    // Whatever was held lets go: a key held into a menu shouldn't walk on after.
    this.controls.clear();
    this.describe();
  }

  continueGame(): void {
    if (!this.view.hasSave) {
      this.newGame();
      return;
    }
    this.setScreen('play');
    this.song = '';
    const talk = this.resumeTalk;
    this.resumeTalk = null;
    if (talk && this.talk.resume(talk[0], talk[1])) this.setScreen('talk');
  }

  newGame(): void {
    clearSave();
    this.log.length = 0;
    this.played = 0;
    this.resumeTalk = null;
    this.talk.stop();
    this.world.newGame(START.area, START.mark);
    this.view.hasSave = false;
    this.showCard(0);
    this.prefetch();
  }

  toTitle(): void {
    this.save();
    this.setScreen('title');
  }

  /** After the ending: walk about the network as it is now. */
  keepPlaying(): void {
    this.setScreen('play');
    this.song = '';
    this.save();
  }

  private showCard(chapter: number): void {
    this.card = chapter;
    this.cardLeft = CARD_TICKS;
    this.setScreen('card');
  }

  pause(): void {
    if (this.view.screen !== 'play') return;
    this.openMenu('pause');
  }

  openMenu(menu: Menu): void {
    this.view.menu = menu;
    this.view.version += 1;
    if (this.view.screen !== 'menu') {
      this.release();
      this.setScreen('menu');
      this.view.menu = menu;
      this.sound.sfx('pause');
      this.sound.suspend();
      this.save();
    }
    this.describe();
  }

  resume(): void {
    if (this.view.screen !== 'menu') return;
    this.view.menu = '';
    this.setScreen(this.talk.active ? 'talk' : 'play');
    this.sound.resume();
  }

  /** The map as it was when opened, and the place picked on it. */
  map: WorldMap = { nodes: [], edges: [] };

  /** Where Back goes from the map: the pause menu it was opened from, or straight back to play. */
  mapBack: Menu = '';

  openMap(): void {
    this.mapBack = this.view.screen === 'menu' ? 'pause' : '';
    this.map = worldMap(this.world.specList, this.world.story, this.world.area.id);
    const here = this.map.nodes.findIndex((n) => n.here);
    this.view.mapAt = Math.max(0, here);
    this.openMenu('map');
  }

  mapMove(dir: number): void {
    const next = nextNode(this.map, this.view.mapAt, dir);
    if (next !== this.view.mapAt) {
      this.view.mapAt = next;
      this.sound.sfx('beat');
    }
  }

  mapPick(index: number): void {
    if (this.map.nodes[index]) this.view.mapAt = index;
  }

  /** Whether the map can take you to a place now: been there, a way in, and no fight on. */
  canTravel(index: number): boolean {
    const n = this.map.nodes[index];
    return !!n && n.visited && n.travel !== '' && !n.here && !this.fighting && this.world.hasArea(n.id);
  }

  travel(index: number): void {
    const n = this.map.nodes[index];
    if (!n || !this.canTravel(index)) return;
    this.world.act([{ k: 'world', verb: 'goto', args: [n.id, n.travel] }]);
    this.resume();
    this.save();
  }

  /** At a beacon: hear what a companion has to say. */
  restTalk(who: Companion): void {
    const scene = this.restScene(who);
    if (!scene) return;
    this.view.menu = '';
    this.setScreen('play');
    this.sound.resume();
    this.beginTalk(scene);
  }

  /** The scene a companion would play at a beacon, and whether it's new. */
  restScene(who: Companion): string {
    const story = this.world.story;
    for (const rule of this.library.talks) {
      if (rule.who !== who || story.has(`seen.${rule.scene}`) || !this.talk.has(rule.scene)) continue;
      if (story.test(rule.if)) return rule.scene;
    }
    return `${who}.idle`;
  }

  hasNews(who: Companion): boolean {
    return this.restScene(who) !== `${who}.idle`;
  }

  private beginTalk(id: string): void {
    if (!this.talk.has(id)) {
      console.error(`Keepalive: no scene ${id}`);
      return;
    }
    this.world.story.flags.add(`seen.${id}`);
    this.controls.clear();
    this.view.toast = '';
    this.setScreen('talk');
    this.talk.start(id);
    this.afterTalkStep();
  }

  private line(who: string, text: string): void {
    this.log.push([who, text]);
    if (this.log.length > 200) this.log.splice(0, this.log.length - 200);
    if (who === '>') return;
    const person = who ? personOf(who) : null;
    this.view.who = who;
    this.view.name = person?.name ?? '';
    this.view.colour = person ? this.renderer.nameColour(person.colour) : '';
    this.view.text = text;
    this.view.shown = 0;
    this.view.choices = [];
    this.typed = 0;
    this.view.version += 1;
  }

  /** On from the line on screen: finish typing it, or go to the next. */
  advance(): void {
    if (this.view.screen !== 'talk') return;
    if (this.view.choices.length > 0) return;
    if (this.view.shown < this.view.text.length) {
      this.view.shown = this.view.text.length;
      this.typed = this.view.shown;
      this.afterTyped();
      return;
    }
    this.talk.advance();
    this.afterTalkStep();
  }

  choose(index: number): void {
    if (this.view.screen !== 'talk' || !this.view.choices.some((c) => c.index === index)) return;
    this.sound.sfx('switch');
    this.view.choices = [];
    this.talk.choose(index);
    this.afterTalkStep();
  }

  /** After the talk moves: show its choices once the line is typed, act on notices. */
  private afterTalkStep(): void {
    this.notices();
    if (this.talk.active && this.view.shown >= this.view.text.length) this.afterTyped();
    if (this.talk.active && this.talk.choosing && this.view.text === '') this.view.choices = this.talk.choices;
    this.describe();
  }

  private afterTyped(): void {
    if (this.talk.choosing) this.view.choices = this.talk.choices;
  }

  private endTalk(): void {
    this.view.who = '';
    this.view.name = '';
    this.view.text = '';
    this.view.shown = 0;
    this.view.choices = [];
    this.view.version += 1;
    // What the scene did to the world (moved you, started a fight) is seen to now.
    this.renderer.effects(this.world);
    this.reactions();
    this.world.events.clear();
    this.notices();
    if (this.pendingEnd) {
      this.pendingEnd = false;
      this.setScreen('end');
      this.song = '';
    } else if (this.pendingMap) {
      this.pendingMap = false;
      this.setScreen('play');
      this.openMap();
    } else if (this.pendingCard >= 0) {
      const chapter = this.pendingCard;
      this.pendingCard = -1;
      this.showCard(chapter);
    } else {
      this.setScreen('play');
    }
    this.save();
  }

  /** What scenes asked of the engine: a chapter's card, a song, a sound, the ending. */
  private notices(): void {
    const list = this.world.notices;
    while (list.length > 0) {
      const notice = list.shift();
      if (!notice) break;
      const [arg = ''] = notice.args;
      switch (notice.verb) {
        case 'chapter':
          this.pendingCard = Number(arg);
          this.songOverride = '';
          break;
        case 'song':
          this.songOverride = arg === 'none' ? '' : arg;
          break;
        case 'sfx':
          this.sound.sfx(arg as Sfx);
          break;
        case 'ending':
          this.view.ending = arg;
          this.world.story.flags.add('ended');
          this.world.story.flags.add(`ending.${arg}`);
          break;
        case 'credits':
          this.pendingEnd = true;
          break;
        case 'map':
          this.pendingMap = true;
          break;
      }
    }
  }

  private pendingMap = false;

  private remark(kind: string, prefer: Companion | null = null, without: Companion | null = null): void {
    const party = this.world.story.party;
    const table = REMARKS[kind];
    if (!table || party.length === 0 || this.remarkLeft > REMARK_TICKS - 60) return;
    const options = party.filter((who) => who !== without && table.warm[who]);
    if (options.length === 0) return;
    const who = prefer && options.includes(prefer) ? prefer : (options[this.counter % options.length] ?? options[0]);
    if (!who) return;
    const cold = this.world.story.trust[who] < 3 ? table.cold?.[who] : undefined;
    const lines = cold ?? table.warm[who] ?? [];
    const text = lines[this.counter % Math.max(1, lines.length)];
    this.counter += 1;
    if (text) this.say(who, text);
  }

  private say(who: Companion | '', text: string, ticks = REMARK_TICKS): void {
    const person = who ? personOf(who) : null;
    this.view.toast = text;
    this.view.toastName = person?.name ?? '';
    this.view.toastColour = person ? this.renderer.nameColour(person.colour) : '';
    this.view.toastId += 1;
    this.remarkLeft = ticks;
  }

  private chatter(): void {
    if (this.remarkLeft > 0) {
      this.remarkLeft -= 1;
      if (this.remarkLeft === 0) {
        const next = this.queue.shift();
        if (next) this.say(next[0], next[1], 170);
        else this.view.toast = '';
      }
      return;
    }
    this.sinceChat += 1;
    if (this.sinceChat < CHAT_EVERY || !this.world.moving) return;
    this.sinceChat = 0;
    const story = this.world.story;
    const chapter = this.world.area.spec.chapter;
    const index = CHATS.findIndex((chat, i) => !this.said.has(i) && chat.chapter === chapter && chat.need.every((who) => story.with(who)));
    const chat = CHATS[index];
    if (!chat) return;
    this.said.add(index);
    const [first, ...rest] = chat.lines;
    if (!first) return;
    this.queue.push(...rest);
    this.say(first[0], first[1], 170);
  }

  private reactions(): void {
    const world = this.world;
    const ev = world.events;
    const front = world.story.party[0] ?? null;
    for (let i = 0; i < ev.count; i += 1) {
      const what = ev.data[i * 4] ?? 0;
      const value = ev.data[i * 4 + 3] ?? 0;
      const sfx = SOUNDS[what];
      if (sfx) this.sound.sfx(sfx);
      switch (what) {
        case EV.FALL:
          this.remark('fall', 'float');
          break;
        case EV.HURT:
          this.remark('hurt');
          break;
        case EV.TIMEOUT:
          this.remark('timeout');
          break;
        case EV.CAUGHT:
          this.remark('caught', 'cron');
          break;
        case EV.SOLVED:
          this.sound.playJingle(jingle('key', this.songNow()));
          this.jingleOut();
          this.remark('solved');
          break;
        case EV.PICK: {
          this.sound.playJingle(jingle('life', this.songNow()));
          this.jingleOut();
          const kind = ['log', 'fragment', 'letter', 'heart', 'key'][value] ?? 'log';
          const title = kind === 'log' ? this.library.logs[world.lastItem] : undefined;
          this.say('', title ? `Found a log: “${title}”` : `Found ${ITEM_WORDS[value]?.toLowerCase() ?? 'something'}.`, 160);
          this.queue.length = 0;
          this.remarkLeft = 160;
          const after = REMARKS[kind]?.warm;
          const who = front && after?.[front] ? front : null;
          const line = who ? after?.[who]?.[0] : undefined;
          if (who && line) this.queue.push([who, line]);
          // A log has words in it: read them out.
          if (kind === 'log' && this.talk.has(world.lastItem) && !world.want) world.want = world.lastItem;
          this.save();
          break;
        }
        case EV.NO:
          if (value === NO.NEED_TEL) this.remark('needTel', null, 'tel');
          else if (value === NO.NEED_SUDO) this.remark('needSudo', null, 'sudo');
          else if (value === NO.HEAVY) this.remark('heavy', null, 'sudo');
          else if (value === NO.TIRED) this.remark('tired', front);
          else if (value === NO.NO_FREEZE) this.remark('noFreeze', 'cron');
          else if (value === NO.NOTHING && front === 'tel') this.say('tel', world.area.spec.hint ?? TEL_HINT[this.counter++ % TEL_HINT.length] ?? '');
          break;
        case EV.SWITCH:
          if (front) this.say(front, LEAD[front][this.counter++ % 3] ?? '', 100);
          break;
        case EV.BOSS_START:
          this.remark('start');
          break;
        case EV.BOSS_HIT:
          this.remarkLeft = 0;
          this.remark('bossHit');
          break;
        case EV.CHECK:
          this.save();
          break;
        case EV.ENTER:
          this.save();
          this.prefetch();
          this.view.version += 1;
          break;
      }
    }
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

  /** The case's buttons, as presses and releases; one still held from before the game opened waits to be let go. */
  private readPad(): void {
    const pad = this.pad;
    if (!pad) return;
    for (const [button, control] of PAD_MAP) {
      if (pad[button] && this.padUp.has(button)) {
        this.controls.press(`case:${button}`, control);
      } else if (!pad[button]) {
        this.padUp.add(button);
        this.controls.release(`case:${button}`);
      }
    }
  }

  private readonly padUp = new Set<string>();

  /** One fixed step: buttons, then the screen's own logic. */
  update(): void {
    this.readPad();
    const f = this.controls.read(this.frame);
    // B and Select together close, as in Hop Count.
    if (f.b && f.select && (f.pressed.b || f.pressed.select)) {
      this.onClose();
      return;
    }
    // Select alone (the case's) switches companion.
    if (f.pressed.select && !f.b) f.pressed.switch = true;
    switch (this.view.screen) {
      case 'title':
      case 'end':
        for (const control of MENU_KEYS) if (f.pressed[control]) this.onMenu(control);
        break;
      case 'card':
        this.cardLeft -= 1;
        if (this.cardLeft <= 0 || (this.cardLeft < CARD_TICKS - 40 && (f.pressed.a || f.pressed.menu))) {
          this.setScreen('play');
          if (this.world.want) this.startWanted();
        }
        break;
      case 'menu':
        for (const control of MENU_KEYS) if (f.pressed[control]) this.onMenu(control);
        if (f.pressed.menu) this.resume();
        break;
      case 'talk':
        this.typing(f);
        break;
      case 'play':
        this.play(f);
        break;
    }
    if (this.view.screen !== 'play') this.music();
    this.chatter();
  }

  private typing(f: Frame): void {
    if (this.view.shown < this.view.text.length) {
      this.typed += TYPE_RATE;
      const next = Math.min(this.view.text.length, Math.floor(this.typed));
      if (next !== this.view.shown) {
        // A soft tick every few letters.
        if (Math.floor(next / 3) !== Math.floor(this.view.shown / 3) && this.view.text[next - 1] !== ' ') this.sound.sfx('beat');
        this.view.shown = next;
        if (next >= this.view.text.length) this.afterTyped();
      }
    }
    if (this.view.choices.length > 0) {
      if (f.pressed.up || f.pressed.down || f.pressed.a || f.pressed.left || f.pressed.right) {
        const control = f.pressed.up ? 'up' : f.pressed.down ? 'down' : f.pressed.left ? 'left' : f.pressed.right ? 'right' : 'a';
        this.onMenu(control);
      }
      return;
    }
    if (f.pressed.a || f.pressed.b) this.advance();
  }

  private play(f: Frame): void {
    const world = this.world;
    if (f.pressed.menu) {
      this.pause();
      return;
    }
    world.step(f);
    this.renderer.effects(world);
    this.played += 1 / 60;
    this.reactions();
    this.notices();
    this.music();
    if (this.pendingCard >= 0) {
      const chapter = this.pendingCard;
      this.pendingCard = -1;
      this.showCard(chapter);
      return;
    }
    if (world.wantRest) {
      world.wantRest = false;
      this.openMenu('rest');
      return;
    }
    if (world.missing && !this.fetching) this.fetchMissing();
    if (world.want) this.startWanted();
    this.sinceSave += 1;
    if (this.sinceSave >= SAVE_EVERY) {
      this.sinceSave = 0;
      this.save();
    }
  }

  private fetching = false;

  /** Echo is at a way into a chapter that hasn't arrived: fetch it, then go on. */
  private fetchMissing(): void {
    const missing = this.world.missing;
    if (!missing) return;
    this.fetching = true;
    const slow = window.setTimeout(() => {
      const front = this.world.story.party[0];
      if (this.fetching && front) this.say(front, 'One moment. The way on is a long one.', 150);
    }, 400);
    this.library.load(chapterOf(missing.to)).then(
      () => {
        window.clearTimeout(slow);
        this.fetching = false;
        if (this.world.missing === missing) this.world.arrive();
      },
      () => {
        window.clearTimeout(slow);
        this.fetching = false;
        this.world.missing = null;
        this.say('', "That way can't be reached just now. Try again in a moment.", 220);
      },
    );
  }

  private startWanted(): void {
    const id = this.world.want;
    this.world.want = '';
    if (id) this.beginTalk(id);
  }

  private songNow() {
    return songFor(CHAPTER_SONG[this.world.area.spec.chapter] ?? 'loopback');
  }

  /** The right song: the title's or the ending's, a scene's, the boss's, the area's. */
  private music(): void {
    // A jingle plays out before the song comes back.
    if (this.songHold > 0) {
      this.songHold -= 1;
      if (this.songHold > 0) return;
      this.song = '';
    }
    const world = this.world;
    const screen = this.view.screen;
    const boss = screen !== 'title' && screen !== 'end' && world.boss !== null && world.boss.state === 1;
    const name =
      screen === 'title' ? 'title' : screen === 'end' ? 'home' : this.songOverride || world.area.spec.song || CHAPTER_SONG[world.area.spec.chapter] || 'loopback';
    const key = `${name}${boss ? '!' : ''}`;
    if (key === this.song) return;
    this.song = key;
    this.sound.playSong(songFor(name), boss);
  }

  private jingleOut(): void {
    this.songHold = 100;
  }

  private songHold = 0;

  render(): void {
    const view = this.view;
    this.renderer.draw(this.world, view.screen, TITLE);
    if (view.screen === 'card') {
      const [label = '', name = '', line = ''] = CHAPTERS[this.card] ?? [];
      this.renderer.card(label, name, line);
    }
    if (view.screen === 'menu' && view.menu === 'map') this.renderer.drawMap(this.map, view.mapAt);
  }

  /** What a screen reader hears, kept short. */
  private describe(): void {
    const world = this.world;
    const view = this.view;
    const area = world.area.spec.name;
    const party = world.story.party.map((who) => personOf(who).name);
    const withText = party.length > 0 ? ` With ${party.join(', ')}.` : '';
    let text = '';
    switch (view.screen) {
      case 'title':
        text = `${TITLE}. ${view.hasSave ? 'Continue or start a new game.' : 'Start a new game.'}`;
        break;
      case 'card': {
        const [label = '', name = ''] = CHAPTERS[this.card] ?? [];
        text = `${label}: ${name}.`;
        break;
      }
      case 'menu':
        text = `Paused in ${area}.${withText}`;
        break;
      case 'end':
        text = 'The end.';
        break;
      default:
        text = `${area}.${withText}`;
    }
    if (view.status !== text) view.status = text;
  }

  /** Lets go of every held control (a lost window, a cancelled touch, a menu opening); one still down has to press again. */
  release(): void {
    this.controls.clear();
    this.onLetGo();
  }

  /** Whether a boss fight is on (travel is off then). */
  get fighting(): boolean {
    return this.world.boss !== null && this.world.boss.state === 1;
  }
}

const PAD_MAP: [string, 'up' | 'right' | 'down' | 'left' | 'a' | 'b' | 'menu' | 'select'][] = [
  ['up', 'up'],
  ['right', 'right'],
  ['down', 'down'],
  ['left', 'left'],
  ['a', 'a'],
  ['b', 'b'],
  ['start', 'menu'],
  ['select', 'select'],
];

const MENU_KEYS = ['up', 'down', 'left', 'right', 'a', 'b'] as const;
