import type { Part } from '../content';
import { boss, door, exit, gate, ghost, item, mark, mover, node, npc, plate, sentry, sign, sweeper, trigger } from '../world';

const gateStreet = `
####################
#&..,,..,....,,..."#
#....x.......t.....#
w..+...............#
#..................#
#"....::::::::....&#
####:###############
#...:..g...h...k...e
####################`;

const hall = `
########n#########
#&.....:::....&###
#......:::......A#
#..   .:::.   ...#
#     m          #
#                #
#                #
#                #
#..a..........,,.#
w.....+.......,,"#
##################`;

const tower = `
######################
##&...:S:...&#########
##.L..:::....#########
##....:::....#########
#######.##############
#......:......#.....##
#..r...:...q..#.....##
#......:......#.....##
#......:......T..*...e
#......:......#.....##
#######s#######.....##
######################`;

const gears = `
########################
#&..######.F############
#....vvvvvv.n###########
#....vvvvvv.#          #
w....vvvvvv..zzzzzzzzz.e
#....vvvvvv.#          #
#...#      .############
##%#####################
##L#####################
########################`;

const escapement = `
######################
#&.....#####S#####...#
#......#.............#
#..+...#...o.........#
#......#.............#
w...................De
#......#.............#
#......#...o.........#
#......#.............#
#......#....o.....p..#
#&.....#########T#####
######################`;

const core = `
################
#&............&#
#..............#
#..............#
#..............#
#......B.......#
w..............#
#..............#
#..............#
#&............&#
################`;

const script = String.raw`
@c1.arrive
: The Crontab. Brass streets, clock towers, a thousand gears. Not one of them is turning.
cron: Listen. Can you hear it?
: You can't hear anything.
cron: Exactly. The Crontab used to tick so loud you could dance to it. Now it's just... waiting.
cron: Everything here runs on a schedule. If the schedule says a gate opens at the top of the minute, it opens at the top of the minute. Even now.
cron: My tower's north, past the Pendulum Hall. My mainspring's at the top. If I can get wound, I can be useful.
> You're already useful. -> kind ~ cron+1
> Lead on. -> end
#kind
cron: I... thank you. I'll write that down. I don't have anywhere to write it. I'll remember it very precisely instead.
~ chapter:1 +c1.arrived

@c1.gates
: GATE STREET. GATES OPEN ON THE MINUTE. MIND THE SECONDS.
cron: Wait for one to open, go through, wait for the next. Patience is just timing you haven't done yet.

@tock.talk
? beat.spinlock -> after
tock: Is it time? It's always 00:00 now. I keep getting up for midnight, and midnight keeps not finishing.
-> end
#after
tock: Listen! Ticking! Ticking everywhere! I've never been so pleased to be a minute late.

@c1.hall
cron: The Pendulum Hall. The pendulums carry you over the drop, back and forth, forever. Normally.
cron: They've stopped. The regulator's down there by the wall. Give it a ping.

@alarm.talk
? letter.alarm -> after
alarm: RING! RING! RING! Sorry. Sorry! I can't stop. I was set for 00:00 and nobody's come to turn me off.
alarm: Nobody's come at all. I ring and I ring and nothing answers.
-> end
#after
alarm: I read it every hour. On the hour. Ring!

@alarm.letter
alarm: RING! A letter? For me? Nobody writes to an alarm. People only ever want us to stop.
: She opens it. Her bells go quiet for the first time in a fortnight.
alarm: It's from the Snooze Button. My brother. He says... he says he's sorry for all the times he made me wait nine minutes.
alarm: He says he's fine. He says he's out past the Stacks and the roads are bad but he's fine.
alarm: Oh, thank you. Thank you, little ping. Ring. Ring. That's a happy ring.
~ -carry.alarm +letter.alarm cron+1
cron: That was nicely done. Mailer will feel it.

@c1.tower
cron: My tower. Home. It looks smaller when you've been away. Or I've got bigger. No: I've got braver. That's the same as bigger.
cron: The watch-clocks on this floor turn round and look about. Don't be where they're looking.
cron: My mainspring's at the top. If I can wind it, I can hold time still for you. Four seconds. That's all I've got. But it's a very good four seconds.

@c1.wind
? can.freeze -> wound
: Cron's mainspring sits under a glass dome, slack and dull. There's a key in it, waiting.
cron: There it is. Run right down. Could you... would you turn the key? I can't reach my own back.
> Wind it gently. -> gentle ~ cron+1
> Wind it all the way, fast. -> fast
#gentle
: You turn the key slowly. Click. Click. Click. Cron's ticking steadies, then deepens.
cron: Oh. Oh, that's lovely. That's like a holiday.
-> taught
#fast
: You crank it hard. Cron rattles from top to bottom and his bells ring on their own.
cron: WAH. Yes. That's. That's wound. Very wound. I can see through time a bit.
#taught
~ +can.freeze sfx:power
cron: There. I'm wound. Watch this.
: Cron tenses. Everything stops: the dust in the air, the watch-clocks, the gears below. Then it all starts again.
cron: Freeze. When I'm walking in front, press A and I'll hold time still. Things that move stop. Things that watch stop watching. Beams stop burning.
cron: Four seconds, then I need to wind back up. Don't waste them. Well. Do, if you like. But not on purpose.
cron: The way east goes through the spring room. The spring's loose in there, swinging round like mad. Hold it still and walk through.
-> end
#wound
cron: Still wound. I can feel it. Ticking, tight, ready.

@c1.spring
cron: The loose spring. It goes round too fast to get past. So don't let it go round. Hold time still, then walk.

@c1.gears
cron: The gearworks. Mind the belts: they run downhill into the drop whether we like it or not.
cron: Unless time isn't running. Then nothing's running.
cron: And the bridge out of here only lights while the relay's lit. It goes out before anyone could walk across. Anyone with no friends.

@c1.escape
cron: The Escapement. The watch-clocks in here don't turn. They stare down their line forever.
cron: I can hold their eyes still for four seconds. Or you could put something in their way. A crate, say. Even a watch-clock can't see through a crate.
cron: There's a beacon by the door. Rest a moment if you want. I'll be here. I'm always here, technically.

@spinlock.meet
: In the heart of the Crontab, the main lock is spinning. Faster than anything should spin. Its arms throw light round the room.
cron: Spinlock. The master lock. It's meant to hold the gears until it's released, then let go. Something stopped the release from ever coming.
cron: So it's waiting. Spinning and waiting, as fast as it can, for a signal that isn't coming. Jamming everything.
spinlock: LOCKED. WAITING. LOCKED. WAITING. RELEASE NOT RECEIVED. RETRYING. RETRYING. RETRYING.
cron: You can't hit it while it's spinning. Pings just bounce off. But if I hold time still...
cron: Then you walk in between the arms and ping it, right in the middle. And you get out before I let go.
> Ready when you are. -> go ~ cron+1
> What if it hurts you? -> worry ~ cron+1
#worry
cron: Then it hurts me. I'd rather that than tick for nothing for ever. Ready?
#go
~ boss

@spinlock.again
spinlock: RETRYING. RETRYING. RETRYING.
cron: Hold still, walk in, ping, get out. We've got this. We've got about four seconds of this.
~ boss -seen.spinlock.again

@spinlock.down
: The ping lands. Spinlock shudders, slows, and stops. Its arms fold away. Somewhere above you a gear turns. Then another. Then all of them.
: The Crontab ticks.
cron: Listen! LISTEN! It's ticking! Everything's ticking! It's... it's 14:07! It's 14:07 and four seconds! I KNOW WHAT TIME IT IS!
spinlock: release... received... thank... you...
: Beyond the lock, the far wall of the core has fallen away. You can see out of the Crontab, to the east, where the routes to the rest of the network should be.
: There's nothing there. Not dark: nothing. A hole in the world where the roads end.
cron: That's... that's where my job goes. Every night. Straight into that.
: Something speaks out of the hole. Not loud. It doesn't need to be.
sys: KEEPALIVE FROM GATEWAY: MISSED.
sys: KEEPALIVE FROM GATEWAY: MISSED.
sys: ROUTE CLOSED.
: Then nothing again.
cron: Echo. Gateway is Gran. That thing knows Gran.
> We should tell her. -> home
> Are you all right, Cron? -> ok ~ cron+1
#ok
cron: No. Yes. I'm ticking. That's the main thing. Let's go home.
#home
cron: Back to Loopback. Gran will know what it means. She knows what everything means. She just doesn't always say.
~ goto:gran:@ face:down

@cron.talk1
cron: Can I tell you something? It's about the job. My midnight job.
cron: Everyone thinks a cron job is a chore. Rotate the logs, empty the bins. Mine isn't.
cron: Every night I send the far host one line: "still here." And it sends one back: "got it." That's the whole job.
> Who set it up? -> who
> That's a lovely job. -> lovely ~ cron+1
#who
cron: I don't know. It was in my table when I started. Somebody wanted a far-off host told, every night, that we're still here.
-> on
#lovely
cron: It is, isn't it? Nobody's ever said so.
#on
cron: Fourteen nights it's gone out and nothing's come back. I keep thinking: what if the host thinks we've stopped?
? cron>=5 -> ask
cron: Anyway. Anyway! Onward. On schedule. Ish.
-> end
#ask
cron: If we ever find it, the far host... would you let me run my job? Just once more? I'd like it to know.
> Of course. -> yes ~ +q.cron cron+1
> If there's time. -> maybe ~ +q.cron
#yes
cron: Thank you. I'll keep it ready. It's only one line.
-> end
#maybe
cron: There's always time. That's my department.

@cron.talk2
cron: You know what I was afraid of, all those years in my tower? Being late.
cron: Not for anything. Just late. Showing up after the moment had gone, with everyone looking at me.
cron: And then the moment stopped coming at all, and I found out there's something worse than being late.
> Being forgotten? -> forgot ~ cron+1
> Being early. -> early ~ cron+1
#forgot
cron: Being nowhere. With nobody to be late for.
cron: I'm not nowhere now. I'm here. With you. Right on time.
-> end
#early
cron: Ha! Early! Early is the worst! You stand there, and stand there...
cron: No. You're right. It's not worse than nowhere. Nothing is.

@cron.talk3
cron: Echo, when this is done... what happens to a ping, after?
cron: You go out, you find someone, you come back. And then?
> I'll stay. In Loopback. -> stay ~ cron+1
> I don't know yet. -> dunno
> Pings get dropped. That's fine. -> drop ~ cron-1
#stay
cron: Good. Good. I'll come by. Every day. Same time. I'll be the one ringing.
-> end
#dunno
cron: That's all right. Nobody's scheduled you. You can be whatever o'clock you like.
-> end
#drop
cron: Don't. Don't say that like it's nothing. I've been dropped. It isn't fine.
cron: ...Sorry. I'm a bit wound.

@cron.idle
? chapter>=5 -> c5
? chapter>=4 -> c4
? chapter>=3 -> c3
? chapter>=2 -> c2
cron: It's 14:02. Probably. My sense of time is rusty. Everything else of me is brass.
-> end
#c2
cron: Sudo's been in that cell since before my last calibration. I'd have gone mad. Madder.
-> end
#c3
cron: Float asked me what time it was and when I told her she said "roughly?" Roughly! It's never roughly!
-> end
#c4
cron: Tel's older than my epoch. I tried to do the sum and dropped a gear.
-> end
#c5
cron: Whatever happens in there, I'm holding the time for you. All of it I've got.

@log.2
: LOG. "WATCHDOG, SPEC 1: resets any route that stops answering. Must be sent a keepalive every sixty seconds, or it assumes the worst. Do not let it assume the worst. — GW"

@log.3
: LOG. "The Worm got in at 03:14. It was everywhere by 03:15. He couldn't keep it out. He took it personally. He takes everything personally. — GW"
`;

export const PART: Part = {
  areas: [
    {
      id: 'c1-gate',
      name: 'Gate Street',
      chapter: 1,
      at: [154, 72],
      travel: 'x',
      map: gateStreet,
      key: {
        w: exit('loopback', 'E'),
        e: exit('c1-hall', 'w'),
        x: mark(),
        t: npc('tock', 'tock.talk'),
        g: gate(150, 60, 0),
        h: gate(150, 60, 50),
        k: gate(150, 60, 100),
        '&': sign('c1.gates'),
      },
      enter: [{ if: '', scene: 'c1.arrive' }],
      hint: 'The gates keep time, dear. Wait just short of each one, and go when it lifts.',
    },
    {
      id: 'c1-hall',
      name: 'The Pendulum Hall',
      chapter: 1,
      at: [170, 62],
      map: hall,
      key: {
        w: exit('c1-gate', 'e'),
        n: exit('c1-tower', 's'),
        a: node('a'),
        m: mover('d3', 0.45, 'a'),
        A: npc('alarm', [
          ['carry.alarm', 'alarm.letter'],
          ['', 'alarm.talk'],
        ]),
      },
      enter: [{ if: '', scene: 'c1.hall' }],
      hint: "That regulator by the wall wants a ping. Then ride the pendulum up, love.",
    },
    {
      id: 'c1-tower',
      name: "Cron's tower",
      chapter: 1,
      at: [184, 48],
      map: tower,
      key: {
        s: exit('c1-hall', 'n'),
        e: exit('c1-gears', 'w'),
        S: sign('c1.wind'),
        L: item('log.3', 'log'),
        r: sentry(1, 110, 4),
        q: sentry(3, 110, 4),
        '*': sweeper(4, 2.3, 0.45),
        T: trigger('c1.spring', 'can.freeze'),
      },
      enter: [{ if: '', scene: 'c1.tower' }],
      hint: "Up the middle when the watch-clocks look away. Then the spring room: hold it still, then walk.",
    },
    {
      id: 'c1-gears',
      name: 'The gearworks',
      chapter: 1,
      at: [202, 60],
      map: gears,
      key: {
        w: exit('c1-tower', 'e'),
        e: exit('c1-escape', 'w'),
        n: node('a', 70),
        z: ghost('a'),
        F: item('frag.2', 'fragment', true),
        L: item('log.2', 'log'),
      },
      enter: [{ if: '', scene: 'c1.gears' }],
      hint: 'Light the relay, then ask Cron for his four seconds. The bridge stays while time does.',
    },
    {
      id: 'c1-escape',
      name: 'The Escapement',
      chapter: 1,
      at: [220, 74],
      map: escapement,
      key: {
        w: exit('c1-gears', 'e'),
        e: exit('c1-core', 'w'),
        D: door('a'),
        p: plate('a'),
        S: sentry(2, 0, 9),
        T: sentry(0, 0, 9),
      },
      signals: { a: { latch: 'c1.escape.open' } },
      enter: [{ if: '', scene: 'c1.escape' }],
      hint: "A watch-clock can't see through a crate. Nor can I, mind. And the plate wants a crate as well.",
    },
    {
      id: 'c1-core',
      name: 'The core',
      chapter: 1,
      at: [238, 62],
      map: core,
      key: {
        w: exit('c1-escape', 'e'),
        B: boss('spinlock'),
      },
      enter: [
        { if: '!beat.spinlock', scene: 'spinlock.meet' },
        { if: '!beat.spinlock', scene: 'spinlock.again' },
      ],
      hint: 'Freeze it, walk in between the arms, ping it, walk out. Mind the arms when they start again.',
    },
  ],
  script,
  talks: [
    { who: 'cron', scene: 'cron.talk1', if: 'chapter>=1' },
    { who: 'cron', scene: 'cron.talk2', if: 'chapter>=2' },
    { who: 'cron', scene: 'cron.talk3', if: 'chapter>=4' },
  ],
  logs: { 'log.2': 'Watchdog, spec 1', 'log.3': 'The Worm' },
};
