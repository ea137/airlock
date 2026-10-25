// The laptop app's line to the hub: the app's own commands, which go through
// the admin socket. Every answer is parsed at this boundary, and a failure
// becomes a HubError saying what was being attempted and why it failed.

import { Channel, invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { z } from 'zod';

const Pairing = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  login: z.string(),
  created_at: z.number(),
  expires_at: z.number(),
});
export type Pairing = z.infer<typeof Pairing>;

const Device = z.object({
  id: z.string(),
  name: z.string(),
  login: z.string(),
  created_at: z.number(),
  last_seen: z.number(),
  face_id: z.boolean().default(false),
});
export type Device = z.infer<typeof Device>;

const AuditEntry = z.object({ at: z.number(), actor: z.string(), action: z.string(), detail: z.string() });
export type AuditEntry = z.infer<typeof AuditEntry>;

const Change = z.object({
  id: z.string(),
  path: z.string(),
  device_name: z.string(),
  created_at: z.number(),
  state: z.enum(['pending', 'written', 'declined', 'withdrawn']),
  decided_at: z.number().nullable(),
  outcome: z.string().nullable(),
  conflict: z.boolean(),
  missing: z.boolean(),
});
export type Change = z.infer<typeof Change>;

const DiffFile = z.object({
  path: z.string(),
  old_path: z.string().nullable(),
  status: z.enum(['added', 'deleted', 'renamed', 'modified']),
  binary: z.boolean(),
  added: z.number(),
  removed: z.number(),
  hunks: z.array(
    z.object({
      header: z.string(),
      lines: z.array(z.object({ kind: z.enum(['add', 'del', 'ctx']), text: z.string() })),
    }),
  ),
});
const Diff = z.object({ files: z.array(DiffFile), truncated: z.boolean() });

const ChangeDetail = z.object({
  change: Change,
  phone_diff: Diff,
  laptop_diff: Diff.nullable(),
  can_merge: z.boolean(),
});
export type ChangeDetail = z.infer<typeof ChangeDetail>;

const Settings = z.object({ sensitive_files: z.boolean() });
export type Settings = z.infer<typeof Settings>;

const Tab = z.object({
  id: z.number(),
  index: z.number(),
  name: z.string(),
  active: z.boolean(),
  cwd: z.string(),
  folder: z.string(),
  command: z.string(),
});
const LiveTerminal = z.object({
  id: z.number(),
  name: z.string(),
  created_at: z.number(),
  activity_at: z.number(),
  tabs: z.array(Tab),
  preview: z.array(z.string()),
});
export type LiveTerminal = z.infer<typeof LiveTerminal>;
const LiveTerminals = z.object({ socket: z.string(), terminals: z.array(LiveTerminal) });

const Session = z.object({
  id: z.string(),
  title: z.string().nullable(),
  state: z.enum(['working', 'needs_you', 'idle', 'ended']),
  doing: z.string(),
  started_at: z.number(),
  updated_at: z.number(),
  cwd: z.string(),
  repo_name: z.string().nullable(),
  branch: z.string().nullable(),
  terminal: z.object({ terminal: z.number(), tab: z.number() }).nullable(),
  place: z.object({ kind: z.enum(['airlock', 'tmux', 'laptop', 'elsewhere', 'unknown']), app: z.string().nullable() }),
});
export type Session = z.infer<typeof Session>;

const Step = z.object({
  seq: z.number(),
  at: z.number(),
  text: z.string(),
  file: z.string().nullable(),
  tool: z.string().nullable(),
});
export type Step = z.infer<typeof Step>;

const SessionDetail = z.object({ session: Session, timeline: z.array(Step) });
export type SessionDetail = z.infer<typeof SessionDetail>;

const KeptTab = z.object({
  name: z.string(),
  cwd: z.string(),
  command: z.string(),
  text: z.string().optional(),
  lines: z.number().optional(),
});
const TerminalRecord = z.object({
  key: z.string(),
  terminal: z.number(),
  name: z.string(),
  created_at: z.number(),
  updated_at: z.number(),
  closed_at: z.number().nullable(),
  tabs: z.array(KeptTab),
});
export type TerminalRecord = z.infer<typeof TerminalRecord>;

const SessionRecord = z.object({
  id: z.string(),
  title: z.string().nullable(),
  cwd: z.string(),
  started_at: z.number(),
  updated_at: z.number(),
  ended_at: z.number().nullable(),
  doing: z.string(),
  timeline: z.array(Step),
});
export type SessionRecord = z.infer<typeof SessionRecord>;

const History = z.object({
  terminals: z.array(TerminalRecord),
  sessions: z.array(SessionRecord),
  keep_secs: z.number(),
});
export type History = z.infer<typeof History>;

const Failure = z.object({ kind: z.enum(['hub_down', 'refused', 'broken']), message: z.string() });
type FailureKind = z.infer<typeof Failure>['kind'];

/** A failed call. `down` means the hub isn't running at all. */
export class HubError extends Error {
  constructor(
    readonly kind: FailureKind,
    message: string,
  ) {
    super(message);
    this.name = 'HubError';
  }

  get down(): boolean {
    return this.kind === 'hub_down';
  }
}

async function call<T>(what: string, command: string, schema: z.ZodType<T>, args?: Record<string, unknown>): Promise<T> {
  let answer: unknown;
  try {
    answer = await invoke(command, args);
  } catch (error) {
    const failure = Failure.safeParse(error);
    if (!failure.success) {
      throw new HubError('broken', `Couldn't ${what}: ${String(error)}`);
    }
    const { kind, message } = failure.data;
    throw new HubError(kind, kind === 'hub_down' ? `Couldn't ${what}: the hub isn't running.` : `Couldn't ${what}: ${message}`);
  }
  const parsed = schema.safeParse(answer);
  if (!parsed.success) {
    throw new HubError('broken', `Couldn't ${what}: the hub sent something unexpected (${parsed.error.message}).`);
  }
  return parsed.data;
}

export const hub = {
  pairings: () => call('list the pairing requests', 'pairings', z.array(Pairing)),
  approve: (pairing: Pairing) => call(`let ${pairing.name} in`, 'approve', Pairing, { id: pairing.id }),
  deny: (pairing: Pairing) => call(`turn ${pairing.name} away`, 'deny', Pairing, { id: pairing.id }),
  devices: () => call('list the paired devices', 'devices', z.array(Device)),
  revoke: (device: Device) => call(`revoke ${device.name}`, 'revoke', Device, { id: device.id }),
  activity: () => call('read the audit log', 'activity', z.array(AuditEntry)),
  changes: () => call("list the phone's edits", 'changes', z.array(Change)),
  change: (id: string) => call('read the edit', 'change', ChangeDetail, { id }),
  applyChange: (change: Change, use: 'phone' | 'merge', overwrite = false) =>
    call(`write ${change.path}`, 'apply_change', z.object({ outcome: z.string() }), {
      id: change.id,
      with: use,
      overwrite,
    }),
  declineChange: (change: Change) =>
    call(`turn down the edit of ${change.path}`, 'decline_change', z.null(), { id: change.id }),
  settings: () => call('read the settings', 'settings', Settings),
  saveSettings: (settings: Settings) => call('save the settings', 'save_settings', Settings, { settings }),
  terminals: () => call('list the terminals', 'terminals', LiveTerminals),
  sessions: () => call('list the Claude sessions', 'sessions', z.object({ sessions: z.array(Session) })),
  session: (id: string) => call('read the session', 'session', SessionDetail, { id }),
  history: () => call('read the history', 'history', History),
  terminalRecord: (key: string) => call('read the kept terminal', 'terminal_record', TerminalRecord, { key }),
  deleteTerminalRecord: (key: string) => call('delete the kept terminal', 'delete_terminal_record', z.null(), { key }),
  sessionRecord: (id: string) => call('read the kept session', 'session_record', SessionRecord, { id }),
  deleteSessionRecord: (id: string) => call('delete the kept session', 'delete_session_record', z.null(), { id }),
  /** Opens a terminal in the window; `onoutput` gets its bytes, and an empty chunk when it ends. */
  openTerminal: (terminal: number, cols: number, rows: number, onoutput: (bytes: Uint8Array) => void) => {
    const output = new Channel<ArrayBuffer | number[]>();
    output.onmessage = (message) => onoutput(new Uint8Array(message));
    return call('open the terminal', 'open_terminal', z.number(), { terminal, cols, rows, output });
  },
  terminalInput: (screen: number, data: string) => call('type into the terminal', 'terminal_input', z.null(), { screen, data }),
  terminalResize: (screen: number, cols: number, rows: number) =>
    call('size the terminal', 'terminal_resize', z.null(), { screen, cols, rows }),
  closeTerminal: (screen: number) => call('close the terminal', 'close_terminal', z.null(), { screen }),
  openInTerminalApp: (terminal: number) =>
    call('open it in a terminal window', 'open_in_terminal_app', z.null(), { terminal }),
};

/** A device cut off because a copy of its token turned up. */
const Theft = z.object({ type: z.literal('token_reused'), id: z.string(), name: z.string() });
export type Theft = z.infer<typeof Theft>;

/**
 * Hears the hub. `onchange` runs on every event it sends, so the window can
 * refresh; `ontheft` runs for a copied token; `onlink` runs when the app's
 * link to the hub comes up or goes down (the hub started or stopped).
 * Returns the function that stops listening.
 */
export function followHub(handlers: {
  onchange: () => void;
  ontheft: (theft: Theft) => void;
  onlink: (up: boolean) => void;
}): () => void {
  const listening = [
    listen<unknown>('hub-event', ({ payload }) => {
      const theft = Theft.safeParse(payload);
      if (theft.success) handlers.ontheft(theft.data);
      handlers.onchange();
    }),
    listen<unknown>('hub-link', ({ payload }) => handlers.onlink(payload === 'up')),
  ];
  return () => {
    for (const pending of listening) void pending.then((stop) => stop());
  };
}
