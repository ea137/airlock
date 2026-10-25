// Ask Claude: whether it's open, what it's about, the conversation so far,
// and the model this phone asks with. The conversation lasts until it's
// asked about something else.

import { type AskRequest, askClaude } from '../../lib/api';
import { handleError } from '../../lib/session.svelte';

/** What the question is about: a title, and what the screen showed, in words. */
export type About = { title: string; context: string };

export type Turn = {
  question: string;
  answer: string;
  /** What Claude checked on the laptop, in order. */
  looked: string[];
  error: string | null;
  done: boolean;
};

const MODEL_KEY = 'airlock.askModel';

function savedModel(): string | null {
  try {
    return localStorage.getItem(MODEL_KEY);
  } catch {
    return null;
  }
}

class Asking {
  open = $state(false);
  about = $state<About | null>(null);
  turns = $state<Turn[]>([]);
  busy = $state(false);
  /** The model this phone asks with; none means the laptop's default. */
  model = $state<string | null>(savedModel());
  #stop: AbortController | null = null;

  /** Opens it, about `about` or the laptop as a whole. Asking about
   * something else starts a new conversation. */
  start(about: About | null) {
    if (about?.title !== this.about?.title || about?.context !== this.about?.context) {
      this.stop();
      this.turns = [];
    }
    this.about = about;
    this.open = true;
  }

  close() {
    this.open = false;
  }

  setModel(id: string) {
    this.model = id;
    try {
      localStorage.setItem(MODEL_KEY, id);
    } catch {
      // Not remembered; it still applies now.
    }
  }

  stop() {
    this.#stop?.abort();
  }

  async ask(question: string) {
    if (this.busy || !question.trim()) return;
    const earlier = this.turns
      .filter((turn) => turn.done && !turn.error)
      .map((turn) => ({ question: turn.question, answer: turn.answer }));
    this.turns.push({ question, answer: '', looked: [], error: null, done: false });
    const turn = this.turns[this.turns.length - 1];
    if (!turn) return;
    const request: AskRequest = { question, earlier, model: this.model ?? undefined };
    if (this.about) request.about = `${this.about.title}\n${this.about.context}`;
    const stop = new AbortController();
    this.#stop = stop;
    this.busy = true;
    try {
      await askClaude(
        request,
        (event) => {
          if ('text' in event) turn.answer += event.text;
          else if ('looking' in event) turn.looked.push(event.looking);
          else if ('done' in event) turn.done = true;
          else turn.error = event.error;
        },
        stop.signal,
      );
      if (!turn.done && !turn.error) turn.error = 'The answer stopped short.';
    } catch (error) {
      turn.error = stop.signal.aborted ? 'Stopped.' : handleError(error).message;
    } finally {
      this.busy = false;
      this.#stop = null;
    }
  }
}

export const asking = new Asking();

export function askAbout(about?: About) {
  asking.start(about ?? null);
}
