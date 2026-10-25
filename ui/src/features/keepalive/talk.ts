// Plays a scene of the script: shows a line, waits, shows the next; offers
// the choices whose conditions hold; does the effects on the way. It knows
// nothing of the screen: the engine reads `shown` and calls advance() and
// choose(). Where it is (scene and node) is two values, so a save can stop
// in the middle of a conversation and pick it up again.

import { isEnd, type Node, type Scene } from './script';
import type { Effect } from './story';

/** What the talk needs from the game: to test conditions and to do effects. */
export type Stage = {
  test(cond: string): boolean;
  act(fx: Effect[]): void;
};

export type Choice = { text: string; index: number };

/** Steps through nodes without showing anything this many times, and it's a loop. */
const RUNAWAY = 400;

export class Talk {
  scene: Scene | null = null;
  at = 0;
  /** The line or the choices on screen now. */
  who = '';
  text = '';
  choices: Choice[] = [];
  /** Called with each line shown, and each choice made (who is '>'). */
  onLine: (who: string, text: string) => void = () => {};
  /** Called when a scene ends, with its id (a chained scene ends only at its own end). */
  onEnd: (id: string) => void = () => {};

  constructor(
    private readonly scenes: ReadonlyMap<string, Scene>,
    private readonly stage: Stage,
  ) {}

  get active(): boolean {
    return this.scene !== null;
  }

  get choosing(): boolean {
    return this.choices.length > 0;
  }

  has(id: string): boolean {
    return this.scenes.has(id);
  }

  start(id: string): void {
    const scene = this.scenes.get(id);
    if (!scene) throw new Error(`There's no scene called ${id}.`);
    this.scene = scene;
    this.at = 0;
    this.run();
  }

  /** Picks a saved conversation up at the node it stopped on. */
  resume(id: string, at: number): boolean {
    const scene = this.scenes.get(id);
    if (!scene || at < 0 || at >= scene.nodes.length) return false;
    const node = scene.nodes[at];
    if (node?.k !== 'line' && node?.k !== 'menu') return false;
    this.scene = scene;
    this.at = at;
    this.run();
    return true;
  }

  /** On from a line (a menu waits for a choice). */
  advance(): void {
    if (!this.scene || this.choosing) return;
    this.at += 1;
    this.run();
  }

  choose(index: number): void {
    const scene = this.scene;
    const node = scene?.nodes[this.at];
    if (!scene || node?.k !== 'menu') return;
    const option = node.options[index];
    if (!option || !this.choices.some((c) => c.index === index)) return;
    this.onLine('>', option.text);
    this.choices = [];
    this.stage.act(option.fx);
    if (option.to) this.go(option.to);
    else this.at += 1;
    if (this.scene) this.run();
  }

  stop(): void {
    this.scene = null;
    this.choices = [];
    this.who = '';
    this.text = '';
  }

  private go(to: string): void {
    const scene = this.scene;
    if (!scene) return;
    if (isEnd(to)) {
      this.at = scene.nodes.length;
    } else if (to.startsWith('@')) {
      const next = this.scenes.get(to.slice(1));
      if (!next) throw new Error(`Scene ${scene.id} goes on to ${to}, which isn't written.`);
      this.scene = next;
      this.at = 0;
    } else {
      const at = scene.labels.get(to);
      if (at === undefined) throw new Error(`Scene ${scene.id} goes to #${to}, which isn't there.`);
      this.at = at;
    }
  }

  /** Runs effects and jumps until there's a line or a menu to show, or the end. */
  private run(): void {
    for (let guard = 0; guard < RUNAWAY; guard += 1) {
      const scene = this.scene;
      if (!scene) return;
      const node: Node | undefined = scene.nodes[this.at];
      if (!node) {
        this.stop();
        this.onEnd(scene.id);
        return;
      }
      switch (node.k) {
        case 'line':
          this.who = node.who;
          this.text = node.text;
          this.choices = [];
          this.onLine(node.who, node.text);
          return;
        case 'menu': {
          const choices: Choice[] = [];
          node.options.forEach((option, index) => {
            if (!option.if || this.stage.test(option.if)) choices.push({ text: option.text, index });
          });
          if (choices.length === 0) {
            // Nothing to choose: carry on as if past it.
            this.at += 1;
            break;
          }
          this.choices = choices;
          return;
        }
        case 'fx':
          this.stage.act(node.fx);
          // An effect can end the talk (a scene that moves you elsewhere ends it first).
          if (this.scene !== scene) return;
          this.at += 1;
          break;
        case 'branch':
          if (this.stage.test(node.if)) this.go(node.to);
          else this.at += 1;
          break;
        case 'jump':
          this.go(node.to);
          break;
      }
    }
    throw new Error(`Scene ${this.scene?.id ?? '?'} loops without saying anything.`);
  }
}
