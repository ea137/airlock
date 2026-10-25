// What the System screen's words mean, for its "?" marks. Plain words, no
// jargon left unexplained.

export type HelpText = { title: string; text: string };

export const HELP = {
  cpu: {
    title: 'CPU',
    text: 'How much of one processor core it used over the last few seconds. 100% is one core kept fully busy; a program using several cores can go past 100%. The graph is the last couple of minutes.',
  },
  laptopCpu: {
    title: 'CPU, the whole laptop',
    text: 'How busy all the processor cores are together, from 0% (idle) to 100% (every core flat out), over the last couple of minutes.',
  },
  memory: {
    title: 'Memory',
    text: 'The memory a process holds right now (its resident memory). Libraries several programs share count in each of them, so adding processes up gives more than the laptop really uses.',
  },
  laptopMemory: {
    title: 'Memory, the whole laptop',
    text: 'Memory in use by programs, out of all there is. The rest is free or holds files the laptop can drop at once if a program needs the room.',
  },
  pid: {
    title: 'Process number (PID)',
    text: 'The number the system gave this process when it started. Numbers are reused later, so Airlock also checks when it started before stopping anything.',
  },
  parent: {
    title: 'Started by',
    text: 'The process that started this one. Apps start many helpers; terminals start shells; systemd starts services.',
  },
  user: {
    title: 'User',
    text: 'Whose process it is. Yours can be stopped from here; the system\'s (root and the like) are only for looking.',
  },
  state: {
    title: 'State',
    text: 'Running: using a core right now. Sleeping: waiting for something, which is normal and costs nothing. Disk: waiting on the disk. Stopped: paused, like after Ctrl+Z. Zombie: finished, waiting for its parent to notice.',
  },
  threads: {
    title: 'Threads',
    text: 'How many lines of work it runs at once. Browsers and editors run dozens; that alone isn\'t a problem.',
  },
  nice: {
    title: 'Niceness',
    text: 'How politely it shares the processor, from -20 (gets first pick) to 19 (lets everything else go first). Most programs are 0.',
  },
  started: {
    title: 'Running for',
    text: 'How long ago it started.',
  },
  cwd: {
    title: 'Working folder',
    text: 'The folder it works in. Files it opens by a short name are looked for here.',
  },
  ports: {
    title: 'Ports',
    text: 'Network ports it listens on, waiting for connections. A dev server listens on one, which is how a browser reaches it.',
  },
  unit: {
    title: 'Runs in',
    text: 'The service or app group the system started it in. Services are started and restarted by systemd; apps get a group when you open them from the desktop.',
  },
  command: {
    title: 'Command',
    text: 'Exactly how it was started: the program and everything it was given.',
  },
  kind: {
    title: 'Kinds',
    text: 'Apps: things you opened, with all their helpers. Dev servers: your projects being served. Terminals: things running in a terminal. Services: background programs systemd looks after. Desktop: what keeps your session going. System: everything else the computer runs.',
  },
  group: {
    title: 'By app',
    text: 'Puts an app\'s helpers together under it, with their CPU and memory added up. Chrome, for one, runs a process per tab.',
  },
  keep: {
    title: 'Why it can\'t be stopped here',
    text: 'Airlock won\'t stop the system\'s processes, your desktop session, its own hub or its terminals. Close those where they belong.',
  },
  serviceState: {
    title: 'Service state',
    text: 'Running: started and working. Exited: did its job and finished, which is normal for some. Failed: it stopped with an error; its log on the laptop says why (journalctl --user -u NAME). Inactive: not running.',
  },
  enabled: {
    title: 'Starts by itself',
    text: 'Enabled: starts at login (yours) or at boot (the system\'s). Disabled: only when started by hand. Static: started by something else, like a timer.',
  },
  restarts: {
    title: 'Restarts',
    text: 'How many times systemd started it again after it stopped unexpectedly, since it was first started.',
  },
  serviceCpu: {
    title: 'CPU time',
    text: 'All the processor time it has used since it started, added up.',
  },
  scope: {
    title: 'Yours or the system\'s',
    text: 'Yours run as you and start with your login (systemctl --user). The system\'s run for the whole computer and start at boot; stopping them needs your password, so they\'re only shown here.',
  },
  timer: {
    title: 'Timers',
    text: 'Timers start a service on a schedule, like cron. Next is when it runs again; last is when it last ran.',
  },
  load: {
    title: 'Load',
    text: 'How many programs wanted a core, on average, over the last minute. Below the number of cores, the laptop keeps up; above it, things wait their turn.',
  },
} satisfies Record<string, HelpText>;
