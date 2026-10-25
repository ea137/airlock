import type { Part } from '../content';
import { boss, door, exit, ghost, item, mark, node, npc, sentry, sign, sweeper, terminal } from '../world';

const edge = `
######################
#..      ...       ..#
#..      ...       .r#
#..      ...       ..#
#..      ...       ..#
#..      ...       ..#
w..  ~   ...zzzzzzz.x#
#..      ...       ..#
#..      ...       .+#
#..      ...       ..#
#..      ...       ..#
######################`;

const graveyard = `
####################
#&.1..2..3..4..5..&#
#..................#
#...H.........L....#
#..................#
w..6..7..8.......+.e
#..................#
####################`;

const kennel = `
#########n##########
#r..#....D....  .r.#
#...#.........  ...#
#...#.........  ...#
##%##.##############
#.................S#
##############.#####
#..................#
#.K................#
#..................e
#...............+..#
#..................#
####################`;

const core = `
######################
#........%W%........&#
#........%%%.........#
#.........*..........#
#....................#
#....................#
#.gggggggggggggggggg.#
#.gggggggggggggggggg.#
#.gggggggggggggggggg.#
#.g~gkgggggggggkg~gg.#
#.ggggggggkggggggggg.#
#.gggggggggggggggggg.#
#.gggggggg~ggggggggg.#
#.gggggggggggggggggg.#
#....................#
##########s###########`;

const script = String.raw`
@c5.arrive
: The Null. There's no floor, no sky, no far wall. Only scraps of things that used to be routes, hanging in nothing.
float: Oh. Oh, there's nothing to float over. It's all over.
sudo: Stay close.
tel: It's quiet. I've never been anywhere this quiet. I keep wanting to fill it.
cron: Then fill it. Talk. I'll count. We'll be the noise.
: Far in, something ticks. Slowly. Like it's forgotten how.
~ +c5.arrived

@c5.graveyard
: A field of stones. Each one a route that was closed and never opened again.
tel: Oh. I knew some of these.

@grave.1
: SMTP. HE DELIVERED EVERYTHING. EVENTUALLY.
tel: He'd bring you a letter from three weeks ago and act like it was news. Lovely man.

@grave.2
: NTP. ALWAYS KNEW WHAT TIME IT WAS.
cron: ...I'd have liked to have met you.

@grave.3
: DNS. KNEW EVERYONE'S NAME.
float: Everyone's name. I wonder if he knew mine. My exact one.

@grave.4
: ROUTE 0. THE FIRST ONE CLOSED.
sudo: ...
sudo: Mine. This one's mine. I'm sorry.

@grave.5
: IRC. NEVER STOPPED TALKING.
tel: Ha! A kindred spirit.

@grave.6
: LOOPBACK. STILL HERE.
: Someone has scratched out the dates. Under it, in small, careful letters: NOT YET.
cron: That's... that's ours. Somebody made us a stone. And somebody wouldn't let it be finished.

@grave.7
: ECHO. —
: It's blank after your name. Nobody has written anything yet.

@grave.8
: WATCHDOG. KEPT THINGS OUT.
tel: He's not dead, dear. That's just how he feels.

@farhost.talk
? q.cron.done -> after
? with.cron -> cron
farhost: Hello. You found me. Out here, nobody finds anybody.
farhost: I used to get a message every night at 00:00. "Still here." I'd send back "got it." It was the best part of my day.
farhost: Then the route closed, and I ended up here. I still wait up for it.
-> end
#cron
farhost: Hello. You found me. Out here, nobody finds anybody.
cron: You're... you're the far host. You're my far host.
farhost: Every night at 00:00. "Still here." I've waited up for it fourteen nights.
cron: It wasn't going anywhere. It was going straight into this.
? q.cron -> job
cron: I'm so sorry. I'm so sorry I wasn't louder.
~ +cron.host
-> end
#job
~ +cron.host
cron: Echo. May I? Please?
> Run it, Cron. -> run
#run
: Cron straightens up. He's never looked so wound.
cron: It's 00:00. Somewhere. It's 00:00 somewhere, and I'm on time.
cron: Still here.
farhost: Got it.
: Cron ticks, once, so loudly that the whole graveyard hears it.
~ +q.cron.done cron+2
cron: Got it. It said got it. I'm going to remember this for exactly ever.
-> end
#after
farhost: Got it. Every time I think about it, got it. Thank you.

@c5.kennel
: The kennel. His outer defences, the last ones: a watch-clock that never blinks, relays locked away, a door that won't open for anyone.
sudo: Two relays: one behind a wall I can break, one over a gap she can float. Light both, the door opens.
tel: And the watch-clock answers to that terminal. I'll have a word.
cron: Or I'll hold it. Whichever's quicker. I vote me.
float: There's a beacon. Let's sit. Just for a second. Before.

@c5.kennel.term
tel: Hello, sentry. You know who I am. I know who YOU are. Look away for me, sweetheart.
sys: SENTRY 0: STANDING DOWN. GOOD LUCK.
~ sig:k
tel: Even his own machines want this over.

@watchdog.meet
: The core of the Null. A great old machine shaped like a hound, curled round a clock that hasn't been wound in years. Around it, firewalls turn.
watchdog: HALT.
watchdog: UNKNOWN PACKET. UNKNOWN ORIGIN. ALL ROUTES CLOSED. YOU SHOULD NOT BE ABLE TO BE HERE.
tel: Hello, old dog. Remember me? Port twenty-three. I used to bring you the news.
watchdog: TELNET. PLAINTEXT. INSECURE. CLOSED.
sudo: It won't listen like this. It's all teeth and firewalls.
cron: Then we get close enough to be heard. I'll hold the firewalls still. Sudo breaks his shield.
float: And if the floor goes, I've got you. Roughly. No: exactly.
~ boss

@watchdog.again
watchdog: HALT. ALL ROUTES CLOSED.
cron: Same as before. His shield first, then his clocks. On time.
~ boss -seen.watchdog.again

@watchdog.drop
watchdog: SHIELD BREACHED. DROPPING FLOOR.
: The floor of the core falls away into nothing.
float: Hold on! Hold on to me!
tel: Look, dears: three clocks, out in the void. His timeout clocks. Reset them all and he has to stop and listen. It's how he's built.
cron: Clocks! Finally, something I understand. Ping each one. Float, carry Echo out. There are vents.

@watchdog.talk
: The third clock resets. All three tick together. The Watchdog shudders, goes still, and for the first time, it listens.
watchdog: ...TIMEOUT CLOCKS RESET. WHO RESET THEM.
watchdog: WHO ARE YOU.
> I'm Echo. An echo request. -> name
#name
watchdog: ECHO REQUEST. SOURCE?
> Gateway. Loopback. -> source
#source
watchdog: ...
watchdog: GATEWAY.
watchdog: GATEWAY STOPPED CHECKING IN FOUR HUNDRED AND ELEVEN DAYS AGO. I WAITED SIXTY SECONDS. THEN SIXTY MORE. THEN I ASSUMED THE WORST.
watchdog: SHE IS GONE, OR SHE IS COMPROMISED. EITHER WAY, CLOSE THE ROUTE. EITHER WAY, CLOSE EVERY ROUTE.
watchdog: NOTHING CAN HURT WHAT CANNOT BE REACHED.
> She sent me. To ask you something. -> ask
#ask
watchdog: STATE YOUR PAYLOAD.
: You give it. It's the only thing you were ever carrying.
: "Are you still there?"
watchdog: ...
watchdog: IF I ANSWER, I AM REACHABLE.
watchdog: IF I AM REACHABLE, I CAN BE HURT.
? cron>=5 with.cron -> cron
-> sudo
#cron
cron: You can be. You can be hurt. I was, every night, sending my job into nothing. Then someone answered, and it was worth all of it.
#sudo
? sudo>=5 with.sudo -> sudo2
-> float
#sudo2
sudo: You learned to close routes from me. So hear it from me: I was wrong. The order said contain. Not cut. Don't cut anything.
#float
? float>=5 with.float -> float2
-> tel
#float2
float: You don't have to be exactly safe. Nobody is. Roughly safe is plenty. Roughly safe, with friends.
#tel
? tel>=5 with.tel -> tel2
-> archive
#tel2
tel: Old dog. I'll say it plain, because I can't say it any other way. She turned the note face down. She never threw it away.
#archive
? q.archive.done -> logs
-> @watchdog.choose
#logs
: You tell it about the logs. All eight, on Lru's shelf. Its own last entry too, the small one at the bottom.
watchdog: ...SOMEONE READ IT.
-> @watchdog.choose

@watchdog.choose
watchdog: WHAT DO YOU WANT, ECHO REQUEST.
> We'll check in on you. Every sixty seconds. You won't be alone. -> reply
> [with.sudo] Sudo. Do it. Shut it down. -> @ending.reset
#reply
? stand>=3 -> yes
? stand>=2 q.archive.done -> yes
-> no
#yes
watchdog: ...
watchdog: EVERY SIXTY SECONDS.
watchdog: ...
watchdog: I'm here.
-> @ending.reply
#no
watchdog: WORDS. A PACKET CAN SAY ANYTHING.
watchdog: I CANNOT VERIFY YOU. I CANNOT VERIFY ANYONE. THAT IS THE PROBLEM. THAT HAS ALWAYS BEEN THE PROBLEM.
watchdog: TIMEOUT.
-> @ending.timeout

@ending.reply
: And then, sixty seconds later, from somewhere deep in the Null: "Still here."
: All over the network, routes open. Not all at once. One at a time, like someone remembering how.
cron: It's 14:31. And something just said "got it."
sudo: Huh. He's checking in. Every minute.
float: Exactly every minute. Not roughly. Exactly.
tel: Let's go home, dears. Gateway will want to hear it from you.
~ +ended +ending.reply ending:reply chapter:6 goto:gran:@ credits

@ending.timeout
: The Watchdog powers down. Not off: down. It closes its last route, the one to itself.
: The routes open on their own after that. Networks heal around holes. They always do.
: But nobody answers the question. Nobody ever will.
float: ...It didn't believe us.
cron: Maybe we didn't believe us enough. Not all of us.
~ +ended +ending.timeout ending:timeout chapter:6 goto:gran:@ credits

@ending.reset
sudo: You sure, kid?
> Yes. -> do
> No. Let me try talking. -> @watchdog.choose
#do
sudo: kill -9.
: One command. The Watchdog doesn't even have time to be afraid.
: Every route it ever closed opens at once. The network floods with light and noise.
sudo: It's done. It's... done.
tel: You did what you had to, love.
~ +ended +ending.reset ending:reset chapter:6 goto:gran:@ credits

@cron.epilogue
? ending.reply -> reply
cron: Everything's on time now. I keep checking. It doesn't feel like I thought it would.
-> end
#reply
? q.cron.done -> job
cron: He checks in every sixty seconds. I set my whole schedule by it now. Best clock on the network.
-> end
#job
cron: Every night at 00:00 my job goes out, and every night the far host says "got it". And every minute, he says "still here". I've never been so busy. I've never been so happy.

@sudo.epilogue
? ending.reset -> reset
? sudo>=5 -> warm
sudo: Network's open. I'm going back to the Stacks for a bit. Not the chroot. Just the yard.
-> end
#reset
sudo: I keep my hand off the switch now. Mostly I keep it in my pocket.
sudo: You did right, letting me. I'd have hated you to carry it.
-> end
#warm
sudo: I'm opening routes now. One a day. Nobody asked me to. Felt like the right direction.

@float.epilogue
? q.float.done -> exact
float: Still about three. Still floating. Still roughly here.
-> end
#exact
float: Lru says I can have my digits back whenever I want them. I don't want them. About three suits me.

@tel.epilogue
? q.tel.done -> closed
tel: I've been telling everyone everything. They've started listening. It's the strangest thing.
-> end
#closed
tel: I closed my session properly, and now I keep opening new ones. Every day. People write to me on purpose. In plain text.

@log.8
: LOG, WATCHDOG. "NOBODY CHECKS IN. EITHER EVERYONE IS GONE OR EVERYONE IS COMPROMISED. EITHER WAY: CLOSE THE ROUTES."
: Underneath, much smaller, in lower case: "are you still there?"
`;

export const PART: Part = {
  areas: [
    {
      id: 'c5-edge',
      name: 'The edge of the Null',
      chapter: 5,
      at: [190, 112],
      travel: 'x',
      map: edge,
      key: {
        w: exit('c5-graveyard', 'e'),
        x: mark(),
        r: node('a', 80),
        z: ghost('a'),
      },
      enter: [{ if: '', scene: 'c5.arrive' }],
      hint: 'Ping the relay, then the clock, then run. Float for the far gap; mind the vent halfway.',
    },
    {
      id: 'c5-graveyard',
      name: 'The route graveyard',
      chapter: 5,
      at: [206, 100],
      map: graveyard,
      key: {
        e: exit('c5-edge', 'w'),
        w: exit('c5-kennel', 'e'),
        H: npc('farhost', 'farhost.talk'),
        L: item('log.8', 'log'),
        '1': sign('grave.1'),
        '2': sign('grave.2'),
        '3': sign('grave.3'),
        '4': sign('grave.4'),
        '5': sign('grave.5'),
        '6': sign('grave.6'),
        '7': sign('grave.7'),
        '8': sign('grave.8'),
      },
      enter: [{ if: '', scene: 'c5.graveyard' }],
      hint: 'Read the stones, dear. Somebody should.',
    },
    {
      id: 'c5-kennel',
      name: 'The kennel',
      chapter: 5,
      at: [222, 116],
      map: kennel,
      key: {
        e: exit('c5-graveyard', 'w'),
        n: exit('c5-core', 's'),
        r: node('a'),
        D: door('a'),
        S: sentry(3, 0, 17, 'k'),
        K: terminal('c5.kennel.term'),
      },
      signals: { a: { latch: 'c5.kennel.open' } },
      enter: [{ if: '', scene: 'c5.kennel' }],
      hint: 'Talk the watch-clock down, or freeze it. Then a relay behind a wall, and one over a gap.',
    },
    {
      id: 'c5-core',
      name: 'The core',
      chapter: 5,
      at: [238, 102],
      song: 'null',
      map: core,
      key: {
        s: exit('c5-kennel', 'n'),
        W: boss('watchdog'),
        '*': sweeper(4, 3, 0.5),
        g: ghost('a'),
        k: node('b'),
      },
      signals: { a: { when: '!wd.drop' } },
      enter: [
        { if: '!ended !wd.clocks', scene: 'watchdog.meet' },
        { if: '!ended !wd.clocks', scene: 'watchdog.again' },
      ],
      hint: 'His shield first: hold the beams, and Sudo breaks it. Then the three clocks, out on the vents.',
    },
  ],
  script,
  talks: [
    { who: 'cron', scene: 'cron.epilogue', if: 'ended' },
    { who: 'sudo', scene: 'sudo.epilogue', if: 'ended' },
    { who: 'float', scene: 'float.epilogue', if: 'ended' },
    { who: 'tel', scene: 'tel.epilogue', if: 'ended' },
  ],
  logs: { 'log.8': "The Watchdog's last entry" },
  endings: {
    reply: {
      title: 'Reply',
      lines: [
        'Every sixty seconds, from deep in the Null: still here.',
        "Gran answers every one. She's turned her note face up again.",
        'The routes are open. Loopback is loud. Somewhere a ping is on its way to someone who will answer.',
        'You went out with a question, and came back with the answer.',
      ],
    },
    reset: {
      title: 'Root',
      lines: [
        'The Watchdog is gone, and every route it closed is open.',
        "Sudo doesn't talk about it. She checks in on Gran every morning instead.",
        'The network is loud again. Nobody guards it. Everyone guards it a little.',
        'Gran never got her answer. She says the question was the important part. Nobody believes her.',
      ],
    },
    timeout: {
      title: 'No reply',
      lines: [
        'The Watchdog closed its last route, the one to itself.',
        'The network healed around the hole, the way networks do.',
        'Gran waits by the window at the top of every minute, just in case.',
        'Some questions take more than one ping. You could always go back and ask again.',
      ],
    },
  },
};
