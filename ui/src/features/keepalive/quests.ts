// The quests: the story's own, and the ones the people of Loopback and
// your companions give you. Nothing about a quest is stored: where it's at
// follows from the story's flags, so it can never fall out of step with
// what happened. Each step can say where on the world map it's waiting.

import type { Story } from './story';

/** A step: what to do, when it's done, and where on the world map it's waiting. */
export type Step = { text: string; done: string; at?: string };

export type Quest = {
  id: string;
  title: string;
  /** Who it's for. */
  giver: string;
  /** It shows once this holds. */
  start: string;
  steps: Step[];
  side: boolean;
};

export const QUESTS: Quest[] = [
  {
    id: 'main',
    title: 'Are you still there?',
    giver: 'gran',
    start: '',
    side: false,
    steps: [
      { text: 'Talk to Gran, and to whoever is at the door.', done: 'with.cron', at: 'loopback' },
      { text: 'Go east to the Crontab with Cron.', done: 'c1.arrived', at: 'c1-gate' },
      { text: "Climb Cron's tower and wind his mainspring.", done: 'can.freeze', at: 'c1-tower' },
      { text: "Find what's jamming the Crontab's clockwork.", done: 'beat.spinlock', at: 'c1-core' },
      { text: "Go north to the Stacks. The way on is root's.", done: 'with.sudo', at: 'c2-jail' },
      { text: 'Get through the Stacks.', done: 'beat.oom', at: 'c2-arena' },
      { text: 'Cross the Buffer, west of Loopback.', done: 'with.float', at: 'c3-drift' },
      { text: 'Find who is broadcasting, and from where.', done: 'beat.jitter', at: 'c3-maw' },
      { text: 'Follow the broadcast down to the old Ports, south of town.', done: 'with.tel', at: 'c4-museum' },
      { text: 'Find the way to the Watchdog.', done: 'beat.spoofer', at: 'c4-gallery' },
      { text: "Bring the Watchdog Gran's question.", done: 'ended', at: 'c5-core' },
    ],
  },
  {
    id: 'letters',
    title: 'Return to sender',
    giver: 'mailer',
    start: 'q.letters',
    side: true,
    steps: [
      { text: 'Give the Alarm in the Crontab its letter.', done: 'letter.alarm', at: 'c1-hall' },
      { text: 'Give Swap in the Stacks its letter.', done: 'letter.swap', at: 'c2-office' },
      { text: 'Give Buoy in the Buffer its letter.', done: 'letter.buoy', at: 'c3-docks' },
      { text: 'Tell Mailer they were all delivered.', done: 'q.letters.done', at: 'loopback' },
    ],
  },
  {
    id: 'mote',
    title: 'All of Mote',
    giver: 'mote',
    start: 'q.mote',
    side: true,
    steps: [
      { text: "Find Mote's four lost fragments. One is close, one ticks, one's wet, one's in the dark.", done: 'frag.*>=4' },
      { text: 'Bring them to Mote.', done: 'q.mote.done', at: 'loopback' },
    ],
  },
  {
    id: 'archive',
    title: 'Least recently used',
    giver: 'lru',
    start: 'q.archive',
    side: true,
    steps: [
      { text: 'Find the lost logs (eight in all). Ping in corners.', done: 'log.*>=8' },
      { text: 'Bring them to Lru.', done: 'q.archive.done', at: 'loopback' },
    ],
  },
  {
    id: 'reap',
    title: 'Exit status',
    giver: 'defunct',
    start: 'q.reap',
    side: true,
    steps: [
      { text: 'Find someone old enough to take Defunct in, down in the old Ports.', done: 'reap.init', at: 'c4-hall' },
      { text: 'Go back to Defunct.', done: 'q.reap.done', at: 'loopback' },
    ],
  },
  {
    id: 'cron',
    title: 'The midnight job',
    giver: 'cron',
    start: 'q.cron',
    side: true,
    steps: [
      { text: "Find the host Cron's job was for.", done: 'cron.host', at: 'c5-graveyard' },
      { text: 'Let Cron run his job.', done: 'q.cron.done', at: 'c5-graveyard' },
    ],
  },
  {
    id: 'sudo',
    title: 'The orders',
    giver: 'sudo',
    start: 'q.sudo',
    side: true,
    steps: [
      { text: "Find the Admin's last log, in the old Ports.", done: 'sudo.orders', at: 'c4-hall' },
      { text: 'Talk it over with Sudo, at a beacon.', done: 'q.sudo.done' },
    ],
  },
  {
    id: 'float',
    title: 'Exact value',
    giver: 'float',
    start: 'q.float',
    side: true,
    steps: [{ text: "Ask Lru, back in Loopback, what Float's value was.", done: 'q.float.done', at: 'loopback' }],
  },
  {
    id: 'tel',
    title: 'Last session',
    giver: 'tel',
    start: 'q.tel',
    side: true,
    steps: [
      { text: 'Let Tel say goodbye to Gopher, Finger and FTP in the museum.', done: 'bye.*>=3', at: 'c4-museum' },
      { text: 'Close the session with Tel, at a beacon.', done: 'q.tel.done' },
    ],
  },
];

export type QuestState = { quest: Quest; started: boolean; step: number; done: boolean; text: string };

/** Where a quest is: not begun, at a step, or done. */
export function questState(story: Story, quest: Quest): QuestState {
  const started = story.test(quest.start);
  let step = 0;
  while (step < quest.steps.length && story.test(quest.steps[step]?.done ?? '')) step += 1;
  const done = step >= quest.steps.length;
  return { quest, started: started || step > 0, step, done, text: done ? 'Done.' : (quest.steps[step]?.text ?? '') };
}

/** The quests to list: begun ones, the story's first, then open before done. */
export function questList(story: Story): QuestState[] {
  return QUESTS.map((quest) => questState(story, quest))
    .filter((state) => state.started)
    .sort((a, b) => Number(a.quest.side) - Number(b.quest.side) || Number(a.done) - Number(b.done));
}
