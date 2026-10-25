// What of the story is loaded: the areas, the scenes (parsed as each part
// arrives), the companions' talks, the logs' titles and the endings.
// Loopback comes with the game; each chapter is fetched once, the first
// time it's asked for, and kept.

import { SPEAKERS } from './cast';
import { CHAPTER_PARTS, type Ending, type Part, type TalkRule } from './content';
import { parseScript, type Scene } from './script';
import type { AreaSpec } from './world';

export class Library {
  readonly scenes = new Map<string, Scene>();
  readonly areas: AreaSpec[] = [];
  readonly talks: TalkRule[] = [];
  readonly logs: Record<string, string> = {};
  readonly endings: Record<string, Ending> = {};
  /** Called with each part's areas as it's added (the world takes them). */
  onAreas: (areas: AreaSpec[]) => void = () => {};
  private readonly have = new Set<number>();
  private readonly pending = new Map<number, Promise<void>>();

  add(part: Part, chapter: number): void {
    if (this.have.has(chapter)) return;
    this.have.add(chapter);
    parseScript(part.script, SPEAKERS, this.scenes);
    this.areas.push(...part.areas);
    this.talks.push(...(part.talks ?? []));
    Object.assign(this.logs, part.logs ?? {});
    Object.assign(this.endings, part.endings ?? {});
    this.onAreas(part.areas);
  }

  has(chapter: number): boolean {
    return this.have.has(chapter) || !(chapter in CHAPTER_PARTS);
  }

  /** Fetches a chapter, once; a chapter that doesn't exist is there already. */
  load(chapter: number): Promise<void> {
    if (this.has(chapter)) return Promise.resolve();
    const known = this.pending.get(chapter);
    if (known) return known;
    const fetch = CHAPTER_PARTS[chapter];
    if (!fetch) return Promise.resolve();
    const promise = fetch().then(
      (module) => {
        this.pending.delete(chapter);
        this.add(module.PART, chapter);
      },
      (error: unknown) => {
        // Try again next time it's needed.
        this.pending.delete(chapter);
        throw error;
      },
    );
    this.pending.set(chapter, promise);
    return promise;
  }

  /** Every chapter up to and including this one. */
  async loadUpTo(chapter: number): Promise<void> {
    await Promise.all(Object.keys(CHAPTER_PARTS).map(Number).filter((n) => n <= chapter).map((n) => this.load(n)));
  }
}
