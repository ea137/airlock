// What the companions say as you go: about a fall, a hit, a puzzle solved,
// a thing found, a door they can't help with; and now and then, walking,
// to each other. Each line is short, shown over the play without stopping
// it. Someone who trusts you little says less, and less kindly.

import type { Companion } from './world';

type Lines = Partial<Record<Companion, string[]>>;

/** Remarks for what just happened, by companion; `cold` ones for low trust. */
export const REMARKS: Record<string, { warm: Lines; cold?: Lines }> = {
  fall: {
    warm: {
      cron: ['Down you went at 14:02. Up again at 14:02. Efficient.', 'Mind the edges. The edges do not mind you.'],
      sudo: ["Got you. Don't make a habit of it.", 'Edge. Noted. Avoid.'],
      float: ['Whoops! A rounding error. I round you back up.', "I'd have caught you, roughly."],
      tel: ['Oh, my dear. Mind your step, the void bites.', "Packets fall in there and never write. Don't you."],
    },
    cold: { sudo: ['Watch it.'], cron: ['Late, and wet.'] },
  },
  hurt: {
    warm: {
      cron: ['Ow. On your behalf. Ow.', "That's going in the log."],
      sudo: ['Hey! Hands off the kid.', 'You okay? Keep moving.'],
      float: ['Ouch, about point seven of an ouch.', 'Are you all there? Most of you?'],
      tel: ['Steady, love.', "That one stung, didn't it."],
    },
    cold: { sudo: ['Keep up.'], float: ['Hm.'] },
  },
  timeout: {
    warm: {
      cron: ['You timed out. I counted. Try again, I will count again.', 'Restarting from the last good time.'],
      sudo: ["Up. We're not done.", 'Again. Smarter this time.'],
      float: ["You went to zero! Don't do that, I can't round from zero.", "Back to the start, about. Exactly, actually."],
      tel: ['There now. Everybody drops a connection once.', 'Deep breath. Reconnect.'],
    },
  },
  caught: {
    warm: {
      cron: ['Seen! Back to the door. Its gaze runs on a schedule, you know.', 'Spotted. Wait for it to look away. Or ask me to hold its eyes still.'],
      sudo: ["It saw us. Back we go. Next time, don't stand in its line.", 'Sentries. Hate sentries.'],
      float: ['It looked right at us! Rude.', "We were seen. That's sort of nice, normally."],
      tel: ['Caught in its log, dear. Quieter next time.'],
    },
  },
  solved: {
    warm: {
      cron: ['There. On time, even.', 'Ha! A good click, that.'],
      sudo: ['Good.', "That's how it's done."],
      float: ['Oh, that was lovely. Do another.', "Clever! Roughly genius."],
      tel: ['Well done, sweetheart.', "Doors open for a polite packet."],
    },
    cold: { sudo: ['Fine.'], cron: ['Adequate.'] },
  },
  log: {
    warm: {
      cron: ['A log! Someone wrote down when things happened. My kind of someone.'],
      sudo: ["Somebody's notes. Lru will want that."],
      float: ['Words from before. Keep them, they get lonely.'],
      tel: ['Oh, a log. I could read it to you. I read everything aloud. I can\'t help it.'],
    },
  },
  fragment: {
    warm: {
      cron: ["A piece of someone. Mote's, I'd wager."],
      sudo: ["That's the kid's. Mote's. Hang on to it."],
      float: ['A fragment! I know how that feels.'],
      tel: ["Little Mote's bytes. He'll be ever so glad."],
    },
  },
  letter: {
    warm: {
      cron: ['A letter. With a due date, I hope.'],
      sudo: ['Mail. For someone out here.'],
      float: ['A letter! Do you think it says something nice?'],
      tel: ["Sealed. I won't read it. I'll try very hard not to read it."],
    },
  },
  heart: {
    warm: {
      cron: ['A spare heartbeat. Keep it on schedule.'],
      sudo: ["More of you to hit. That's good, actually."],
      float: ['You feel more... integer.'],
      tel: ['Stronger now, love.'],
    },
  },
  key: {
    warm: {
      cron: ['A key. Keys are for later.'],
      sudo: ['Key. Doors fear it.'],
      float: ['Shiny.'],
      tel: ['Keep that safe, dear.'],
    },
  },
  needTel: {
    warm: {
      cron: ["It's waiting for a protocol none of us speak. An old one.", "It wants to talk. Not to us, sadly."],
      sudo: ["Can't hit a terminal into talking. I've tried.", "That thing speaks something old. Not my area."],
      float: ['It hums at us. I hum back. Nothing happens.', "It wants someone who talks in plain words."],
    },
  },
  needSudo: {
    warm: {
      cron: ['A cracked wall. Somebody strong could have it down in a second. Not me. I am a clock.', "Root-owned. We'd need permissions."],
      float: ['That wall looks like one good push would do it. Not my kind of push.'],
      tel: ['A wall with a crack in it. In my day we had superusers for that.'],
    },
  },
  heavy: {
    warm: {
      cron: ["Too heavy for us. It's owned by root.", 'It will not budge. Neither would I, at that weight.'],
      float: ["I can lift you, not that. That's at least four bytes."],
      tel: ["That's root's block, dear. You'd want a superuser."],
    },
  },
  tired: {
    warm: {
      cron: ['Winding up! One moment.', 'Not yet. Even I need a tick between tocks.'],
      sudo: ['Give me a second.', 'Catching my breath.'],
      float: ['Need a moment... almost... nearly...', 'Recharging. Ish.'],
    },
  },
  noFreeze: {
    warm: { cron: ["I can't, not yet. My mainspring's run down. It's at the top of my tower.", "If I were wound, I'd stop the world for you. I'm not."] },
  },
  start: {
    warm: {
      cron: ['Hold steady. I will hold time.'],
      sudo: ["Okay. Let's take it apart."],
      float: ["Up, up, let's go."],
      tel: ['Be brave, dear. I am, mostly.'],
    },
  },
  bossHit: {
    warm: {
      cron: ['Hit! Right on the second.', 'Again! Same time!'],
      sudo: ['Yes! Again!', 'It felt that.'],
      float: ['Got it, about. No, exactly! We got it!', 'Ha!'],
      tel: ['Oh, well struck!', 'That rattled its headers.'],
    },
  },
};

/** What the front companion says on taking the lead (not every time). */
export const LEAD: Record<Companion, string[]> = {
  cron: ['Cron. On time.', 'I have the watch.', "Freeze when you're ready."],
  sudo: ['Sudo. Standing by.', "I've got the heavy stuff.", 'Point me at it.'],
  float: ["Float! Up we go, if you like.", "Floating along.", "I'll lift you over."],
  tel: ['Tel here, dear.', "I'll do the talking.", 'Who wants a word?'],
};

/** Tel, asked for a hint where there isn't one written. */
export const TEL_HINT = [
  "Let's see... A relay lit, a door opened. Something here wants pinging, I'd think.",
  "Have a look at what's moving, dear. Things that move can be held still.",
  'When in doubt, talk to everything. That always worked for me.',
];

/** Now and then, walking, companions talk among themselves: who must be there, and what's said. */
export type Chat = { chapter: number; need: Companion[]; lines: [Companion, string][] };

export const CHATS: Chat[] = [
  {
    chapter: 0,
    need: ['cron'],
    lines: [
      ['cron', 'Loopback is nice. Everything you say here comes back to you.'],
      ['cron', 'I said "good morning" to the square once. It said "good morning" for an hour.'],
    ],
  },
  {
    chapter: 1,
    need: ['cron'],
    lines: [
      ['cron', 'We are four minutes behind. No. Five. Is it five?'],
      ['cron', "Don't mind me. I count when I'm nervous. One. Two."],
    ],
  },
  {
    chapter: 1,
    need: ['cron'],
    lines: [['cron', 'Every gear here was once on time. Every one. I wound them all.']],
  },
  {
    chapter: 2,
    need: ['cron', 'sudo'],
    lines: [
      ['cron', 'Sudo, what time did you lock yourself in?'],
      ['sudo', 'Long enough ago.'],
      ['cron', "That isn't a time."],
      ['sudo', "It's the only one I've got."],
    ],
  },
  {
    chapter: 2,
    need: ['sudo'],
    lines: [
      ['sudo', 'Stay behind me in here. The Stacks drop things on people.'],
      ['sudo', 'Usually on purpose.'],
    ],
  },
  {
    chapter: 3,
    need: ['float', 'cron'],
    lines: [
      ['float', "Cron, what's the exact time?"],
      ['cron', '14:07 and twelve seconds.'],
      ['float', 'Mm. I prefer "afternoon-ish".'],
      ['cron', 'That hurts me physically.'],
    ],
  },
  {
    chapter: 3,
    need: ['float', 'sudo'],
    lines: [
      ['float', "Sudo, you're very solid."],
      ['sudo', 'Thanks?'],
      ['float', "I mean it nicely. I've never been solid. I'm mostly decimals."],
    ],
  },
  {
    chapter: 4,
    need: ['tel', 'float'],
    lines: [
      ['tel', 'Float, love, you remind me of a girl I knew on port 79.'],
      ['float', 'Was she nice?'],
      ['tel', 'She told everyone who was logged in. Nobody liked her. I adored her.'],
    ],
  },
  {
    chapter: 4,
    need: ['tel', 'sudo'],
    lines: [
      ['tel', "Sudo, dear, you're thinking very loudly."],
      ['sudo', "You can't hear thoughts."],
      ['tel', "No. But I can hear sighs, and you've done eleven."],
    ],
  },
  {
    chapter: 4,
    need: ['tel', 'cron'],
    lines: [
      ['cron', 'Tel, how old are you?'],
      ['tel', "Older than your epoch, sweetheart. Don't do the sums, you'll faint."],
    ],
  },
  {
    chapter: 5,
    need: ['cron', 'sudo', 'float'],
    lines: [
      ['float', "It's so quiet here."],
      ['sudo', 'Nothing left to make noise.'],
      ['cron', "Then we'll be the noise. On the beat. Together."],
    ],
  },
  {
    chapter: 5,
    need: ['tel'],
    lines: [['tel', "Do you hear that, dear? No? Neither do I. That's what's wrong."]],
  },
  {
    chapter: 6,
    need: ['cron', 'float'],
    lines: [
      ['cron', 'It is 14:22. Nothing is late. Nothing at all.'],
      ['float', 'Approximately perfect.'],
    ],
  },
];
