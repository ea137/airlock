// Why a service failed, and whether it matters, in plain words: what it is
// (for the ones laptops commonly have), how it ended, and what to do. The
// hub gives the facts (`UnitWhy`); this says them.

import type { ServiceView, UnitWhy } from '../../lib/api';

export type Level = 'safe' | 'look' | 'worry';

export type ServiceStory = {
  /** What it is, when Airlock knows the service. */
  what: string | null;
  verdict: { level: Level; headline: string; why: string };
  /** How it ended, from systemd's result. */
  ended: string | null;
  todo: string | null;
  /** A command for the laptop's terminal that does it. */
  command: string | null;
};

type Known = {
  test: RegExp;
  what: string;
  level: Level;
  why: string;
  /** What to do, given the facts: the package it came from and its file. */
  todo: (why: UnitWhy | null) => { todo: string; command: string | null };
};

/** Removing what installed it: its package, or the installer's own script. */
function removal(why: UnitWhy | null, what: string): { todo: string; command: string | null } {
  const guest = why?.file && /^(\/opt\/VBoxGuestAdditions-[^/]+)\//.exec(why.file)?.[1];
  if (guest) return { todo: `If you don't need ${what}, remove it with its own uninstaller:`, command: `sudo ${guest}/uninstall.sh` };
  if (why?.package) return { todo: `If you don't need ${what}, remove it:`, command: `sudo apt purge ${why.package}` };
  return { todo: `If you don't need ${what}, remove it from the App Center or with apt.`, command: null };
}

const nothing = () => ({ todo: 'Nothing: it does no harm.', command: null });

const KNOWN: Known[] = [
  {
    test: /^vbox(drv|autostart-service|balloonctrl-service|web-service)\.service$/,
    what: 'VirtualBox, which runs virtual machines. At each start it builds a driver for the version of Linux this laptop runs.',
    level: 'safe',
    why: "It fails when VirtualBox can't build that driver, usually after a Linux update or with an old VirtualBox. Only virtual machines need it.",
    todo: (why) =>
      why?.package
        ? { todo: `If you use VirtualBox, install its current version. If not, remove it:`, command: `sudo apt purge ${why.package}` }
        : removal(why, 'VirtualBox'),
  },
  {
    test: /^vboxadd(-service)?\.service$/,
    what: "VirtualBox's Guest Additions, made for a system running inside a VirtualBox virtual machine.",
    level: 'safe',
    why: 'On a real laptop it has nothing to do, so it fails. Nothing else depends on it.',
    todo: (why) => removal(why, 'it'),
  },
  {
    test: /^(NetworkManager|systemd-networkd)-wait-online\.service$/,
    what: 'It holds the start of the laptop until the network is up, for services that need it at once.',
    level: 'safe',
    why: 'It fails when there was no network within its time, like starting up away from Wi-Fi. The network still comes up when it can.',
    todo: nothing,
  },
  {
    test: /^(apport|apport-autoreport|whoopsie)\.service$/,
    what: "Ubuntu's crash reporter, which collects reports when a program crashes.",
    level: 'safe',
    why: 'Only crash reports are missed.',
    todo: nothing,
  },
  {
    test: /^fwupd(-refresh)?\.service$/,
    what: 'The firmware updater, which checks for updates to the laptop’s own hardware.',
    level: 'safe',
    why: 'It fails when it can’t reach the update server, and tries again later.',
    todo: nothing,
  },
  {
    test: /^plymouth/,
    what: 'The splash screen shown while the laptop starts.',
    level: 'safe',
    why: 'Only the splash screen is affected.',
    todo: nothing,
  },
  {
    test: /^bluetooth\.service$/,
    what: 'Bluetooth.',
    level: 'look',
    why: "It fails without a Bluetooth adapter, or with one switched off. Bluetooth devices won't connect until it runs.",
    todo: () => ({ todo: 'If you use Bluetooth, try starting it again:', command: 'sudo systemctl restart bluetooth' }),
  },
  {
    test: /^cups(-browsed)?\.service$/,
    what: 'Printing (CUPS).',
    level: 'look',
    why: "You can't print until it runs.",
    todo: () => ({ todo: 'If you print, try starting it again:', command: 'sudo systemctl restart cups' }),
  },
  {
    test: /^snapd/,
    what: 'Snap, which installs and updates the apps from the App Center.',
    level: 'worry',
    why: "Snap apps may not start or update while it's down.",
    todo: () => ({ todo: 'Start it again:', command: 'sudo systemctl restart snapd' }),
  },
  {
    test: /^(docker|containerd)\.service$/,
    what: 'Docker, which runs containers.',
    level: 'worry',
    why: "Your containers don't run while it's down.",
    todo: () => ({ todo: 'Start it again; the log above says what stopped it:', command: 'sudo systemctl restart docker' }),
  },
  {
    test: /^(postgresql|mysql|mariadb|redis-server|redis|mongod)(@.*)?\.service$/,
    what: 'A database server.',
    level: 'worry',
    why: "Apps that use it can't reach their data while it's down.",
    todo: () => ({ todo: 'The log above says what stopped it; fix that, then start it again.', command: null }),
  },
];

/** systemd's result for how it ended, in words. */
function endedWords(why: UnitWhy | null): string | null {
  if (!why?.result) return null;
  switch (why.result) {
    case 'success':
      return 'It ended normally.';
    case 'exit-code':
      return why.exit_status === null ? 'It ended with an error.' : `It ended with an error (exit status ${why.exit_status}).`;
    case 'signal':
      return 'It was killed by a signal.';
    case 'core-dump':
      return 'It crashed.';
    case 'timeout':
      return 'It took too long, so systemd gave up on it.';
    case 'start-limit-hit':
      return 'It failed again and again, so systemd stopped trying.';
    case 'oom-kill':
      return 'It ran out of memory and was stopped.';
    case 'watchdog':
      return "It stopped answering systemd's checks.";
    case 'resources':
      return "systemd couldn't set it up: something it needs (a file, folder or user) is missing.";
    case 'exec-condition':
    case 'condition':
      return "A condition it needs to start wasn't met.";
    case 'protocol':
      return "It didn't start the way it said it would.";
    default:
      return `systemd says: ${why.result}.`;
  }
}

const HEADLINES: Record<Level, string> = { safe: 'Safe to ignore', look: 'Worth a look', worry: 'Worth fixing' };

export function serviceStory(service: ServiceView, why: UnitWhy | null): ServiceStory {
  const known = KNOWN.find((entry) => entry.test.test(service.unit));
  if (known) {
    const help = known.todo(why);
    return {
      what: known.what,
      verdict: { level: known.level, headline: HEADLINES[known.level], why: known.why },
      ended: endedWords(why),
      todo: help.todo,
      command: help.command,
    };
  }
  const yours = service.scope === 'user';
  return {
    what: null,
    verdict: yours
      ? { level: 'worry', headline: HEADLINES.worry, why: "It's one of yours, so something you set up isn't running." }
      : { level: 'look', headline: HEADLINES.look, why: "Airlock doesn't know this one; its log may say what it does and why it stopped." },
    ended: endedWords(why),
    todo: yours ? 'Its log says why. Once fixed, start it again:' : null,
    command: yours ? `systemctl --user restart ${service.unit}` : null,
  };
}
