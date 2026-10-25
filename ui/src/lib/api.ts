// The hub's API. Every call goes through `call`, which parses the response at
// the boundary and throws an ApiError saying what was being attempted and why
// it failed. URLs are relative, so the UI works under any mount path.

import { z } from 'zod';

const Device = z.object({ id: z.string(), name: z.string() });

const Session = z.discriminatedUnion('paired', [
  z.object({
    paired: z.literal(true),
    device: Device,
    host: z.string(),
    home: z.string(),
    lock: z.enum(['none', 'locked', 'unlocked']),
    /** Dev servers are previewed on this host at this port, when set up. */
    preview_port: z.number().nullable().optional(),
  }),
  z.object({ paired: z.literal(false) }),
]);
export type Session = z.infer<typeof Session>;

const PairStart = z.object({ code: z.string(), expires_in: z.number() });

const PairStatus = z.discriminatedUnion('state', [
  z.object({ state: z.literal('pending'), code: z.string() }),
  z.object({ state: z.literal('approved'), device: Device }),
  z.object({ state: z.enum(['denied', 'expired', 'done', 'none']) }),
]);
export type PairStatus = z.infer<typeof PairStatus>;

const Tab = z.object({
  id: z.number(),
  index: z.number(),
  name: z.string(),
  active: z.boolean(),
  cwd: z.string(),
  folder: z.string(),
  command: z.string(),
});
export type Tab = z.infer<typeof Tab>;

const Terminal = z.object({
  id: z.number(),
  name: z.string(),
  created_at: z.number(),
  activity_at: z.number(),
  tabs: z.array(Tab),
  preview: z.array(z.string()),
});
export type Terminal = z.infer<typeof Terminal>;

const Created = z.object({ id: z.number() });

const Project = z.object({ name: z.string(), path: z.string(), changed_at: z.number() });
const Root = z.object({ name: z.string(), path: z.string(), projects: z.array(Project) });
export type Root = z.infer<typeof Root>;

const Folders = z.object({ home: z.string(), open: z.array(z.string()), roots: z.array(Root) });
export type Folders = z.infer<typeof Folders>;

const SessionState = z.enum(['working', 'needs_you', 'idle', 'ended']);
export type SessionState = z.infer<typeof SessionState>;

const Waiting = z.object({
  kind: z.enum(['permission', 'question']),
  headline: z.string(),
  detail: z.string().nullable(),
  since: z.number(),
});

const ClaudeSession = z.object({
  id: z.string(),
  title: z.string().nullable(),
  state: SessionState,
  doing: z.string(),
  waiting: Waiting.nullable(),
  started_at: z.number(),
  updated_at: z.number(),
  cwd: z.string(),
  repo: z.string().nullable(),
  repo_name: z.string().nullable(),
  worktree: z.string().nullable(),
  branch: z.string().nullable(),
  terminal: z.object({ terminal: z.number(), tab: z.number() }).nullable(),
  laptop_tab: z.number().nullable(),
  background: z.array(z.string()),
  /** `used` is a percent; `size` is in tokens. */
  context: z.object({ used: z.number(), size: z.number() }).nullish(),
  terminal_name: z.string().nullish(),
  answerable: z.boolean(),
  place: z.object({
    kind: z.enum(['airlock', 'tmux', 'laptop', 'elsewhere', 'unknown']),
    app: z.string().nullable(),
  }),
});
export type ClaudeSession = z.infer<typeof ClaudeSession>;

const Worktree = z.object({
  path: z.string(),
  name: z.string(),
  branch: z.string().nullable(),
  head: z.string(),
  compared_to: z.string().nullable(),
  ahead: z.number(),
  behind: z.number(),
  changes: z.number(),
});
export type Worktree = z.infer<typeof Worktree>;

const RepoSummary = z.object({
  key: z.string(),
  name: z.string(),
  github: z.string().nullable(),
  base: z.string().nullable(),
  worktrees: z.array(Worktree),
  needs_you: z.number(),
  working: z.number(),
  idle: z.number(),
});
export type RepoSummary = z.infer<typeof RepoSummary>;

const ProjectSummary = z.object({
  name: z.string(),
  path: z.string(),
  repo: z.string().nullable(),
  branch: z.string().nullable(),
  changes: z.number(),
  ahead: z.number(),
  behind: z.number(),
  worktrees: z.number(),
  needs_you: z.number(),
  working: z.number(),
  idle: z.number(),
  active_at: z.number(),
});
export type ProjectSummary = z.infer<typeof ProjectSummary>;

const ProjectGroup = z.object({ name: z.string(), path: z.string().nullable(), projects: z.array(ProjectSummary) });
export type ProjectGroup = z.infer<typeof ProjectGroup>;

const Center = z.object({
  sessions: z.array(ClaudeSession),
  repos: z.array(RepoSummary),
  groups: z.array(ProjectGroup),
});
export type Center = z.infer<typeof Center>;

const PullRequest = z.object({
  number: z.number(),
  title: z.string(),
  state: z.string(),
  head: z.string(),
  url: z.string(),
  draft: z.boolean(),
});
export type PullRequest = z.infer<typeof PullRequest>;

const AttentionLink = z.discriminatedUnion('to', [
  z.object({ to: z.literal('session'), id: z.string() }),
  z.object({ to: z.literal('pull'), repo: z.string(), number: z.number() }),
  z.object({ to: z.literal('system'), tab: z.enum(['overview', 'processes', 'services']) }),
  z.object({ to: z.literal('port'), port: z.number() }),
  z.object({ to: z.literal('service'), unit: z.string(), scope: z.enum(['user', 'system']) }),
  z.object({ to: z.literal('edits') }),
]);
export type AttentionLink = z.infer<typeof AttentionLink>;

const AttentionItem = z.object({
  id: z.string(),
  level: z.enum(['act', 'look', 'fyi']),
  kind: z.string(),
  title: z.string(),
  detail: z.string().nullable(),
  since: z.number().nullable(),
  link: AttentionLink,
});
export type AttentionItem = z.infer<typeof AttentionItem>;

const Attention = z.object({
  needs_you: z.array(ClaudeSession),
  items: z.array(AttentionItem),
  now: z.object({
    working: z.number(),
    terminals: z.number(),
    servers: z.array(z.tuple([z.string(), z.number()])),
  }),
  /** Every Claude session going on, and those closed in the last hour. */
  sessions: z.array(ClaudeSession),
  /** The Claude plan's usage, as a session's status line last said (percent, and when it starts over). */
  usage: z
    .object({
      five_hour: z.object({ used: z.number(), resets_at: z.number().nullable() }).nullable(),
      seven_day: z.object({ used: z.number(), resets_at: z.number().nullable() }).nullable(),
      at: z.number(),
    })
    .nullable()
    .default(null),
});
export type Attention = z.infer<typeof Attention>;
export type Usage = NonNullable<Attention['usage']>;

const RepoTab = z.object({
  terminal: z.number(),
  terminal_name: z.string(),
  tab: z.number(),
  index: z.number(),
  name: z.string(),
  folder: z.string(),
  command: z.string(),
  active: z.boolean(),
});
export type RepoTab = z.infer<typeof RepoTab>;

const FolderDetail = z.object({
  name: z.string(),
  path: z.string(),
  sessions: z.array(ClaudeSession),
  tabs: z.array(RepoTab),
});
export type FolderDetail = z.infer<typeof FolderDetail>;

const RepoDetail = z.object({
  repo: RepoSummary,
  worktrees: z.array(z.object({ worktree: Worktree, sessions: z.array(ClaudeSession), tabs: z.array(RepoTab) })),
  pulls: z.array(PullRequest).nullable(),
  pulls_note: z.string().nullable(),
});
export type RepoDetail = z.infer<typeof RepoDetail>;

const FileChange = z.object({ path: z.string(), added: z.number().nullable(), removed: z.number().nullable() });
export type FileChange = z.infer<typeof FileChange>;

const Step = z.object({
  seq: z.number(),
  at: z.number(),
  text: z.string(),
  file: z.string().nullable(),
  tool: z.string().nullable(),
  input: z.record(z.string(), z.unknown()).nullable(),
});
export type Step = z.infer<typeof Step>;

const StepDetail = z.object({
  step: Step,
  cwd: z.string(),
  call: z.object({
    tool: z.string(),
    input: z.record(z.string(), z.unknown()),
    output: z.string().nullable(),
    failed: z.boolean(),
    diff: z.array(z.object({ tag: z.enum([' ', '+', '-', '@']), text: z.string() })),
  }),
});
export type StepDetail = z.infer<typeof StepDetail>;

const SessionScreen = z.object({ text: z.string(), width: z.number(), height: z.number() });
export type SessionScreen = z.infer<typeof SessionScreen>;

const SessionDetail = z.object({
  session: ClaudeSession,
  timeline: z.array(Step),
  files: z.array(FileChange),
  compared_to: z.string().nullable(),
  github_url: z.string().nullable(),
});
export type SessionDetail = z.infer<typeof SessionDetail>;

const PullDetail = z.object({
  number: z.number(),
  title: z.string(),
  state: z.string(),
  draft: z.boolean(),
  head: z.string(),
  base: z.string(),
  additions: z.number(),
  deletions: z.number(),
  changed_files: z.number(),
  created_at: z.string(),
  merged_at: z.string().nullable(),
  closed_at: z.string().nullable(),
  url: z.string(),
  checks: z.array(z.object({ name: z.string(), outcome: z.enum(['passed', 'failed', 'running', 'skipped', 'other']) })),
  files: z.array(FileChange),
});
export type PullDetail = z.infer<typeof PullDetail>;

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
export type DiffFile = z.infer<typeof DiffFile>;

const DiffAnswer = z.object({
  diff: z.object({ files: z.array(DiffFile), truncated: z.boolean() }),
  compared_to: z.string().nullable().optional(),
});
export type DiffAnswer = z.infer<typeof DiffAnswer>;

export type Choice = 'once' | 'always' | 'deny';

const FileEntry = z.object({
  name: z.string(),
  path: z.string(),
  kind: z.enum(['dir', 'file']),
  size: z.number(),
  modified: z.number(),
  items: z.number().nullable(),
  sensitive: z.boolean(),
});
export type FileEntry = z.infer<typeof FileEntry>;

const Folder = z.object({
  path: z.string(),
  name: z.string(),
  parent: z.string().nullable(),
  entries: z.array(FileEntry),
  hidden: z.number(),
});
export type Folder = z.infer<typeof Folder>;

const FileRead = z.object({
  path: z.string(),
  name: z.string(),
  folder: z.string().nullable(),
  size: z.number(),
  modified: z.number(),
  sensitive: z.boolean(),
  kind: z.enum(['text', 'markdown', 'html', 'image', 'binary']),
  text: z.string().optional(),
  html: z.string().optional(),
  hash: z.string().optional(),
  lines: z.number().optional(),
  language: z.string().nullable().optional(),
  too_big: z.boolean().optional(),
});
export type FileRead = z.infer<typeof FileRead>;

const MyChange = z.object({
  id: z.string(),
  path: z.string(),
  created_at: z.number(),
  state: z.enum(['pending', 'written', 'declined', 'withdrawn']),
  decided_at: z.number().nullable(),
  outcome: z.string().nullable(),
});
export type MyChange = z.infer<typeof MyChange>;

const TerminalLink = z.object({ terminal: z.number(), tab: z.number() });

const ProcessView = z.object({
  pid: z.number(),
  started: z.number(),
  label: z.string(),
  comm: z.string(),
  running_for: z.number(),
  cpu: z.number().nullable(),
  memory: z.number(),
  cwd: z.string().nullable(),
  terminal: TerminalLink.nullable(),
  orphaned: z.boolean(),
  ports: z.array(z.number()),
});
export type ProcessView = z.infer<typeof ProcessView>;

const PortKind = z.enum([
  'airlock',
  'tailscale',
  'ssh',
  'dns',
  'rpcbind',
  'printing',
  'postgres',
  'mysql',
  'redis',
  'mongodb',
  'memcached',
  'dev',
  'container',
  'program',
  'unknown',
]);
export type PortKind = z.infer<typeof PortKind>;

const PortView = z.object({
  port: z.number(),
  address: z.string(),
  exposure: z.enum(['laptop', 'tailnet', 'all', 'one']),
  name: z.string(),
  pid: z.number().nullable(),
  started: z.number().nullable(),
  dev: z.boolean(),
  terminal: TerminalLink.nullable(),
  /** A kind this phone doesn't know yet reads as unknown. */
  kind: PortKind.catch('unknown'),
  verdict: z.enum(['safe', 'look', 'worry']),
  owner: z.enum(['you', 'docker', 'system']),
  container: z.string().nullable(),
  image: z.string().nullable(),
});
export type PortView = z.infer<typeof PortView>;

const SystemView = z.object({
  resources: z.object({
    load: z.number(),
    cpus: z.number(),
    memory_used: z.number(),
    memory_total: z.number(),
    disk_used: z.number(),
    disk_total: z.number(),
    battery: z.number().nullable(),
    charging: z.boolean().nullable(),
  }),
  ports: z.array(PortView),
  jobs: z.array(ProcessView),
  heavy: z.array(ProcessView),
  /** Whether the laptop's firewall is on; null without one the hub knows. */
  firewall: z.boolean().nullable(),
  services: z.array(z.object({ unit: z.string(), description: z.string() })),
  timers: z.array(z.object({ unit: z.string(), activates: z.string(), next: z.number().nullable() })),
});
export type SystemView = z.infer<typeof SystemView>;

const ProcessKind = z.enum(['app', 'dev', 'terminal', 'service', 'desktop', 'system', 'other']);
export type ProcessKind = z.infer<typeof ProcessKind>;

const ProcessRow = z.object({
  pid: z.number(),
  ppid: z.number(),
  started: z.number(),
  name: z.string(),
  program: z.string(),
  command: z.string(),
  user: z.string(),
  mine: z.boolean(),
  state: z.enum(['running', 'sleeping', 'disk', 'stopped', 'zombie', 'idle']),
  threads: z.number(),
  nice: z.number(),
  cpu: z.number().nullable(),
  cpu_history: z.array(z.number()),
  memory: z.number(),
  running_for: z.number(),
  cwd: z.string().nullable(),
  ports: z.array(z.number()),
  terminal: TerminalLink.nullable(),
  unit: z.string().nullable(),
  app: z.string().nullable(),
  kind: ProcessKind,
  about: z.string().nullable(),
  keep: z.string().nullable(),
});
export type ProcessRow = z.infer<typeof ProcessRow>;

const ProcessesView = z.object({
  processes: z.array(ProcessRow),
  cpus: z.number(),
  memory_total: z.number(),
  cpu: z.array(z.number()),
  memory: z.array(z.number()),
});
export type ProcessesView = z.infer<typeof ProcessesView>;

const ProcessDetail = z.object({
  pid: z.number(),
  command: z.string(),
  exe: z.string().nullable(),
  parent: z.string().nullable(),
  package: z.string().nullable(),
  package_about: z.string().nullable(),
});
export type ProcessDetail = z.infer<typeof ProcessDetail>;

const ServiceView = z.object({
  unit: z.string(),
  scope: z.enum(['user', 'system']),
  description: z.string(),
  active: z.string(),
  sub: z.string(),
  enabled: z.string().nullable(),
  since: z.number().nullable(),
  pid: z.number().nullable(),
  memory: z.number().nullable(),
  cpu_seconds: z.number().nullable(),
  restarts: z.number().nullable(),
  keep: z.string().nullable(),
});
export type ServiceView = z.infer<typeof ServiceView>;

const TimerView = z.object({
  unit: z.string(),
  scope: z.enum(['user', 'system']),
  description: z.string(),
  activates: z.string(),
  next: z.number().nullable(),
  last: z.number().nullable(),
  keep: z.string().nullable(),
});
export type TimerView = z.infer<typeof TimerView>;

const UnitsView = z.object({ services: z.array(ServiceView), timers: z.array(TimerView) });
export type UnitsView = z.infer<typeof UnitsView>;

const LaptopTab = z.object({
  id: z.number(),
  title: z.string().nullable(),
  folder: z.string(),
  command: z.string(),
  opened_at: z.number(),
  active_at: z.number(),
  on_phone: z.boolean(),
});
export type LaptopTab = z.infer<typeof LaptopTab>;

const LaptopTabs = z.object({ tabs: z.array(LaptopTab), shared: z.boolean() });
export type LaptopTabs = z.infer<typeof LaptopTabs>;

const UnitWhy = z.object({
  result: z.string().nullable(),
  exit_status: z.number().nullable(),
  log: z.array(z.string()),
  log_note: z.string().nullable(),
  package: z.string().nullable(),
  file: z.string().nullable(),
});
export type UnitWhy = z.infer<typeof UnitWhy>;

/**
 * The address of a file's own bytes (images, sandboxed web pages). Given the
 * modified time, the browser keeps it until the file changes.
 */
export function rawUrl(path: string, modified?: number): string {
  const version = modified === undefined ? '' : `&v=${modified}`;
  return `api/files/raw?path=${encodeURIComponent(path)}${version}`;
}

/** A failed call. `status` is 0 when the laptop didn't answer at all. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get unpaired(): boolean {
    return this.status === 401;
  }

  get locked(): boolean {
    return this.status === 423;
  }
}

async function reasonOf(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && 'error' in parsed && typeof parsed.error === 'string') {
      return parsed.error;
    }
  } catch {
    // Plain text.
  }
  return text.trim() || `the laptop answered ${res.status}`;
}

async function call<T>(what: string, path: string, schema: z.ZodType<T> | null, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      credentials: 'same-origin',
      ...init,
      headers: init.body ? { 'Content-Type': 'application/json' } : {},
    });
  } catch (error) {
    throw new ApiError(0, `Couldn't ${what}: the laptop didn't answer (${(error as Error).message}).`);
  }
  if (!res.ok) {
    throw new ApiError(res.status, `Couldn't ${what}: ${await reasonOf(res)}`);
  }
  if (schema === null) {
    return undefined as T;
  }
  const parsed = schema.safeParse(await res.json());
  if (!parsed.success) {
    throw new ApiError(res.status, `Couldn't ${what}: the laptop sent something unexpected (${parsed.error.message}).`);
  }
  return parsed.data;
}

const json = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });

/** The models Claude answers with, the default first. */
const AskModels = z.object({ models: z.array(z.object({ id: z.string(), name: z.string() })) });
export type AskModels = z.infer<typeof AskModels>;

/** One piece of an answer as it comes: some of its text, something it
 * checks, or how it ended. */
const AskEvent = z.union([
  z.object({ text: z.string() }),
  z.object({ looking: z.string() }),
  z.object({ done: z.literal(true) }),
  z.object({ error: z.string() }),
]);
export type AskEvent = z.infer<typeof AskEvent>;

export type AskRequest = {
  question: string;
  about?: string;
  earlier?: { question: string; answer: string }[];
  model?: string;
};

export async function askClaude(
  request: AskRequest,
  onevent: (event: AskEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const what = 'ask Claude';
  let res: Response;
  try {
    res = await fetch('api/ask', {
      ...json(request),
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      signal,
    });
  } catch (error) {
    throw new ApiError(0, `Couldn't ${what}: the laptop didn't answer (${(error as Error).message}).`);
  }
  if (!res.ok || !res.body) {
    throw new ApiError(res.status, `Couldn't ${what}: ${await reasonOf(res)}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    let end = pending.indexOf('\n');
    while (end >= 0) {
      const line = pending.slice(0, end).trim();
      pending = pending.slice(end + 1);
      end = pending.indexOf('\n');
      if (!line) continue;
      try {
        const event = AskEvent.safeParse(JSON.parse(line));
        if (event.success) onevent(event.data);
      } catch {
        // A line that isn't one: skipped.
      }
    }
  }
}

export const api = {
  session: () => call('check this device', 'api/session', Session),
  pair: (name: string) => call('ask the laptop to pair', 'api/pair', PairStart, json({ name })),
  pairStatus: () => call('check the pairing request', 'api/pair/status', PairStatus),

  terminals: () => call('list the terminals', 'api/terminals', z.array(Terminal)),
  createTerminal: (name: string, cwd: string) =>
    call(`open a terminal in ${cwd}`, 'api/terminals', Created, json({ name, cwd })),
  renameTerminal: (id: number, name: string) =>
    call(`rename the terminal to "${name}"`, `api/terminals/${id}`, null, { method: 'PATCH', body: JSON.stringify({ name }) }),
  closeTerminal: (id: number) => call('close the terminal', `api/terminals/${id}`, null, { method: 'DELETE' }),

  newTab: (terminal: number) => call('open a tab', `api/terminals/${terminal}/tabs`, Created, json({})),
  selectTab: (tab: number) => call('switch tabs', `api/tabs/${tab}/select`, null, { method: 'POST' }),
  renameTab: (tab: number, name: string) =>
    call(name ? `rename the tab to "${name}"` : 'reset the tab name', `api/tabs/${tab}`, null, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),
  closeTab: (tab: number) => call('close the tab', `api/tabs/${tab}`, null, { method: 'DELETE' }),

  folders: () => call('list start folders', 'api/folders', Folders),

  // Face ID. The options and credentials pass through as WebAuthn JSON;
  // lib/passkey.ts turns them into what the browser takes and gives.
  faceIdSetupStart: () => call('start setting up Face ID', 'api/faceid/setup/start', z.unknown(), json({})),
  faceIdSetupFinish: (credential: unknown) =>
    call('set up Face ID', 'api/faceid/setup/finish', null, json(credential)),
  unlockStart: () => call('start unlocking', 'api/faceid/unlock/start', z.unknown(), json({})),
  unlockFinish: (assertion: unknown) => call('unlock with Face ID', 'api/faceid/unlock/finish', null, json(assertion)),

  attention: () => call('read what needs you', 'api/attention', Attention),
  center: () => call('read your projects and sessions', 'api/center', Center),
  folderProject: (path: string) =>
    call(`read the project ${path}`, `api/center/folder?path=${encodeURIComponent(path)}`, FolderDetail),
  repo: (key: string) => call('read the repo', `api/center/repos/${encodeURIComponent(key)}`, RepoDetail),
  claudeSession: (id: string) =>
    call('read the session', `api/center/sessions/${encodeURIComponent(id)}`, SessionDetail),
  stepDetail: (id: string, seq: number) =>
    call('read that step', `api/center/sessions/${encodeURIComponent(id)}/steps/${seq}`, StepDetail),
  sessionScreen: (id: string) =>
    call("read the session's screen", `api/center/sessions/${encodeURIComponent(id)}/screen`, SessionScreen),
  typeIntoSession: (id: string, typed: { text: string } | { key: string }) =>
    call('type into the session', `api/center/sessions/${encodeURIComponent(id)}/type`, null, json(typed)),
  continueSession: (id: string) =>
    call(
      'continue the session here',
      `api/center/sessions/${encodeURIComponent(id)}/continue`,
      z.object({ terminal: z.number() }),
      json({}),
    ),
  moveSession: (id: string) =>
    call(
      'move the session here',
      `api/center/sessions/${encodeURIComponent(id)}/move`,
      z.object({ terminal: z.number() }),
      json({}),
    ),
  answer: (id: string, choice: Choice) =>
    call(
      choice === 'deny' ? 'deny it' : 'allow it',
      `api/center/sessions/${encodeURIComponent(id)}/answer`,
      null,
      json({ choice }),
    ),
  worktreeDiff: (key: string, worktree: string) =>
    call(
      'read the diff',
      `api/center/repos/${encodeURIComponent(key)}/diff?worktree=${encodeURIComponent(worktree)}`,
      DiffAnswer,
    ),
  pull: (key: string, number: number) =>
    call(`read pull request #${number}`, `api/center/repos/${encodeURIComponent(key)}/prs/${number}`, PullDetail),
  pullDiff: (key: string, number: number) =>
    call(`read the diff of #${number}`, `api/center/repos/${encodeURIComponent(key)}/prs/${number}/diff`, DiffAnswer),

  folder: (path: string, hidden: boolean) =>
    call(`open ${path}`, `api/files?path=${encodeURIComponent(path)}${hidden ? '&hidden=1' : ''}`, Folder),
  readFile: (path: string) => call(`open ${path}`, `api/files/read?path=${encodeURIComponent(path)}`, FileRead),
  searchFiles: (path: string, query: string) =>
    call(
      `search ${path}`,
      `api/files/search?path=${encodeURIComponent(path)}&q=${encodeURIComponent(query)}`,
      z.object({ entries: z.array(FileEntry) }),
    ),
  openOnLaptop: (path: string) => call(`open ${path} on the laptop`, 'api/files/open', null, json({ path })),
  proposeEdit: (path: string, baseText: string, text: string) =>
    call(`send the edit of ${path}`, 'api/files/changes', MyChange, json({ path, base_text: baseText, text })),
  myEdits: () => call('list your edits', 'api/files/changes', z.object({ changes: z.array(MyChange) })),
  withdrawEdit: (id: string) =>
    call('take the edit back', `api/files/changes/${encodeURIComponent(id)}`, null, { method: 'DELETE' }),

  system: () => call("read the laptop's state", 'api/system', SystemView),
  processes: () => call("list the laptop's processes", 'api/system/processes', ProcessesView),
  processDetail: (pid: number, started: number) =>
    call(`read process ${pid}`, `api/system/processes/${pid}?started=${started}`, ProcessDetail),
  units: () => call("list the laptop's services and timers", 'api/system/units', UnitsView),
  unitWhy: (unit: string, scope: ServiceView['scope']) =>
    call(
      `read why ${unit} stopped`,
      `api/system/units/why?unit=${encodeURIComponent(unit)}&scope=${scope}`,
      UnitWhy,
    ),
  stopProcess: (name: string, pid: number, started: number, force: boolean) =>
    call(`stop ${name}`, 'api/system/stop', z.object({ stopped: z.boolean() }), json({ pid, started, force })),
  stopUnit: (unit: string) => call(`stop ${unit}`, 'api/system/services/stop', z.object({ stopped: z.boolean() }), json({ unit })),
  stopContainer: (name: string) =>
    call(`stop the ${name} container`, 'api/system/containers/stop', z.object({ stopped: z.boolean() }), json({ name })),
  openDevServer: (port: number) => call(`open :${port} on the laptop`, 'api/system/open', null, json({ port })),
  terminalToBottom: (terminal: number) =>
    call('go back to the bottom of the terminal', `api/terminals/${terminal}/bottom`, null, { method: 'POST' }),
  terminalText: (terminal: number) =>
    call("read the terminal's text", `api/terminals/${terminal}/text`, z.object({ text: z.string() })),
  pushKey: () => call("read the laptop's notification key", 'api/push/key', z.object({ key: z.string() })),
  pushSubscribe: (subscription: { endpoint: string; keys: { p256dh: string; auth: string } }) =>
    call('turn notifications on', 'api/push/subscribe', null, json(subscription)),
  pushUnsubscribe: (endpoint: string) => call('turn notifications off', 'api/push/unsubscribe', null, json({ endpoint })),
  pushTest: () => call('send a test notification', 'api/push/test', null, json({})),
  laptopTabs: () => call("list the laptop's terminal tabs", 'api/laptop-tabs', LaptopTabs),
  askModels: () => call("list Claude's models", 'api/ask/models', AskModels),
};

function socketUrl(pathAndQuery: string): string {
  const url = new URL(pathAndQuery, location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

function streamUrl(path: string, cols: number, rows: number): string {
  return socketUrl(`${path}?cols=${cols}&rows=${rows}`);
}

export function newsUrl(): string {
  return socketUrl('api/events');
}

export function attachUrl(terminal: number, cols: number, rows: number): string {
  return streamUrl(`api/terminals/${terminal}/attach`, cols, rows);
}

export function laptopTabUrl(tab: number, cols: number, rows: number): string {
  return streamUrl(`api/laptop-tabs/${tab}/attach`, cols, rows);
}
