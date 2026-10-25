import type { Part } from '../content';
import { door, exit, item, lamp, mark, npc, sign, T } from '../world';

const square = `
##############N###############
#"",,........:::..........,,"#
#.########...:::....########.#
#.########...:::q...########.#
#"########...:::....########"#
#.########...:::....########.#
#.###G####...:::....###A####.#
#,,..........:::.........,,..#
#".......::::::::::::......."#
#........:a::::::::a:....m&..#
#........::::::::::::.......DE
#........::::r+::::::.....h..#
#........:::::x::::::........#
#........:a::::::::a:........#
#"......,::::::::::::,......"#
W.......p...............b....#
#.#####..........n...........#
#.#####..............o..##%###
#.#####.....u...........#...##
#...f..............t....#.F.##
#"...........:::........######
##############S###############`;

const house = `
############
#&"..::..&"#
#....::....#
#....@..g..#
#....c.....#
#.L........#
#"........"#
#####d######`;

const archive = `
############
#&&&&&&&&&&#
#..........#
#...l...s..#
#,,,,,,,,,,#
#&&&....&&&#
#..........#
#####d######`;

const script = String.raw`
@p.wake
: A hum. A fan spinning up. Then light, all at once.
gran: There you are. Easy, now. You were only made this morning.
gran: Can you hear me? Blink if you can hear me. Oh, you don't blink. Never mind.
> Where am I? -> where
> Who are you? -> who
#who
gran: Gran. Gateway, if you want it proper. I keep the door between this town and everything else.
-> on
#where
gran: Loopback. The last town on the network that still answers.
#on
gran: Say something here and it comes straight back to you. That's what we're good for.
gran: Out there, though... out there nobody has answered anybody in a long time.
gran: Routes going dark. Whole towns gone quiet. "No route to host," they say, and then they say nothing at all.
gran: So I made you. I'll call you Echo. It suits a ping.
> A ping? -> made
> Made me for what? -> made
#made
gran: An echo request, child. You go out, you find someone, you come back with their answer.
gran: That's all a ping is. A question that walks.
gran: Your address got smudged when I wrote it, I'm afraid. My hands aren't what they were.
gran: But you'll know where you're going when you get there. Pings always do.
> What's the question? -> question
> I'll do it. -> brave ~ +p.brave
#question
gran: The oldest one there is. "Are you still there?"
-> knock
#brave
gran: Ha! Not a full minute old and already brave. Good.
#knock
: Someone hammers on the door. It flies open before anyone can answer it.
~ +p.cron.here +p.woke
cron: Gran! Gran, it's 00:00!
gran: It's been 00:00 for a fortnight, Cron.
cron: I know! That's the problem! My midnight job can't reach its host, and the Crontab's jammed solid, and everything is late, and I ran here, and running is not on my schedule!
gran: Breathe, dear. You don't breathe. Tick, then. Tick slowly.
gran: He's the best timekeeper on the network, Echo. And the most frightened. Go on. Say hello to him.
~ face:down

@p.cron
cron: Oh. Hello. You're new. Very new. You're about... forty minutes old?
cron: I'm Cron. Process four hundred and twelve. I run things at the times things should be run.
cron: Or I did. Every night at 00:00 my job goes out to the far host, and the far host says "got it", and I tick. It's my favourite part of the day.
cron: It hasn't said "got it" in fourteen days.
> That sounds lonely. -> lonely ~ cron+1
> Then let's go and find out why. -> go ~ cron+1
> Maybe the host doesn't want your job. -> harsh ~ cron-1
#lonely
cron: It... yes. It is. Nobody's ever said that to me before.
cron: I don't know what time it is now. It feels like a long one.
-> join
#harsh
cron: ...
cron: That's not a nice thing to say at 00:00.
cron: But you might be right. That's worse.
-> join
#go
cron: Out there? Now? Unscheduled?
cron: ...Yes. Yes. All right. If I don't go, nothing will happen at all, and I can't stand nothing happening.
#join
gran: Take him with you, little ping. The Crontab is the first stop east in any case.
gran: Cron, mind the child. Echo, mind Cron.
cron: I always mind. It's my main feature.
~ join:cron
: Cron falls in behind you. He ticks, very quietly, the whole time.
gran: Have a word with me before you go, dear.

@gran.wait
gran: Go on, he won't bite. He'll tick at you, that's all.

@gran.go
gran: Ready, then. Out the door, through the square, and east.
gran: The square's lamps went out when the routes did. Light them for me? The town should see you off properly.
gran: You've a ping in you. Let it out near a lamp and the lamp will catch.
gran: That log on the floor's mine, by the way. Old notes. Take it if you like. I've no use for remembering.
gran: Then the east gate. Come back and tell me everything.
~ +p.told

@gran.notyet
cron: Gran wanted a word. She's usually right. I've timed it.

@gran.c1
gran: East, dear. The Crontab. Cron knows the way, at the right times.
? with.cron cron>=5 -> fond
-> end
#fond
gran: And look after each other. He's ticking happier already. I can hear it.

@gran.c2
gran: North to the Stacks. Root's country. Go gently with Sudo, whatever she says.

@gran.c3
gran: West, over the Buffer. Ask whoever's adrift out there to carry you.

@gran.c4
gran: South, down the old stairs. Tel's waiting. She'll tell you everything. She always did.

@gran.end
? ending.reply -> reply
gran: You did what you could, Echo. You went out and came back. That's all a ping can do.
-> end
#reply
gran: He checks in every sixty seconds now. Every single one. I've started looking forward to it.
gran: Thank you, child. For the question. And for bringing back the answer.

@gran.after1
: You're home. Gran is at the window. She turns before you're through the door.
gran: There you are. All of you. Cron, you're wound! Look at you, ticking.
cron: Gran, the routes out of the Crontab. They don't go anywhere. They stop. There's a hole where they used to be.
cron: And something spoke out of it. "Keepalive missed. Route closed."
gran: ...
gran: Did it now.
> Do you know what it was? -> know
> Gran? -> know
#know
gran: I know a lot of things, dear. Most of them are old and none of them are useful.
gran: The north road goes to the Stacks. Whatever is closing the routes, it closed them there first.
gran: You'll find the way is root-owned. Locked to anyone without permissions.
gran: There's a superuser in the Stacks. Sudo. She had more permissions than anyone, once. Then she locked herself away.
cron: Locked herself in? Why would anyone do that?
gran: Some people think they're dangerous. Some of them are right. Go gently with her.
~ chapter:2

@gran.after2
: Gran looks at Sudo for a long moment.
gran: Hello, Sudo.
sudo: Gateway.
gran: You came out.
sudo: The kid asked.
gran: The kid has a way of asking.
gran: Now. The Buffer, west past the docks. A whole sea of dropped packets, and somewhere across it the old routes come together again.
gran: Nobody's crossed it since the drop. Things go out on it and don't come back.
sudo: Can't swim. Can't float. Too heavy.
cron: Don't look at me. I'm brass.
gran: Then you'll need someone who floats. There's always someone adrift on the Buffer. Ask them nicely.
~ chapter:3

@gran.after3
float: Hello! You must be Gran! You're exactly like they said. Well. Approximately.
gran: And you must be the one keeping them all afloat.
gran: Echo. You heard it too, didn't you? The broadcast.
: You did. Out on the water, an old voice, talking in the clear: "Is anyone still connected? This is port twenty-three."
gran: Telnet. Old Tel. I'd know that voice anywhere. She never could keep a thing to herself.
gran: The south stairs go down to the old Ports. They've been locked from below for years. If she's talking, she'll open them.
gran: She'll know things, Echo. About the beginning. About me.
gran: Whatever she tells you, it's true. She can't lie. It's the one thing about her I could never forgive.
~ chapter:4

@gran.epilogue
gran: Sit down, all of you. Sit. The kettle's on. I don't have a kettle. Pretend.
? ending.reply -> reply
? ending.reset -> reset
gran: He's gone quiet. For good, this time.
gran: The routes came back on their own. They do, eventually. Networks heal around holes.
gran: But I sent you to ask him something, and he never answered. And now he can't.
gran: That's mine to carry, not yours. You did everything right, child.
-> end
#reset
gran: So it's done. The routes are open and the Watchdog is gone.
gran: It needed doing. I know it did. I just wish I'd been the one to do it, instead of leaving it to you.
gran: Or to talk to him, before it came to that. Years before.
-> end
#reply
: Somewhere far off, every sixty seconds, something checks in.
gran: Do you hear that? That's him. "Still here." Every minute, on the minute.
cron: On the minute! I checked!
gran: Forty years, and the old fool finally learns to call.

@loop.first
cron: Loopback! Say something to the square. Anything.
: You ping. The square pings back. It's a nice square.
cron: See? Everything here comes back. That's why it's the last town that answers: it only ever answers itself.
cron: The lamps are out, though. Four of them, round the square. Light them and the east gate opens.
cron: Ping near each one.

@loop.north.no
cron: The Stacks are north. Gran said east first, and Gran is usually right. I've timed it.

@loop.west.no
? beat.spinlock -> later
cron: The docks. Nobody's sailed the Buffer in weeks. Not until we've been east.
-> end
#later
cron: The docks. We'd sink. All of us. I'm brass and you're small.

@loop.south.no
: The old stairs go down into the dark. They're locked from below.

@loop.board
? seen.loop.board.read -> map
: A board of routes, chalked up long ago. Most are crossed out. "UNREACHABLE." "UNREACHABLE." "NO ROUTE."
: At the bottom, in Gran's hand: "Loopback: still here." Under it, someone has started a new map. In your handwriting, somehow.
~ +seen.loop.board.read
#map
~ map

@loop.sign.north
: NORTH: THE STACKS. ROOT-OWNED. KEEP OUT.

@loop.epilogue
? ending.reply -> reply
: Loopback is busier than you remember. Packets you've never seen, passing through.
-> end
#reply
: Loopback is loud. Packets coming, packets going, letters arriving. Somebody has relit every lamp twice.

@mailer.hello
mailer: Post! Post for... oh. No. Sorry. Habit.
mailer: Mailer. Mailer-Daemon, on the forms. I deliver the town's letters, and for a fortnight every single one has come back.
mailer: "Undeliverable." "Undeliverable." "Host unknown." I've started taking it personally.
mailer: Are you going out there? Past the gates?
> I am. I could carry some letters. -> yes ~ +q.letters +carry.alarm +carry.swap +carry.buoy
> Not right now. -> no
#yes
mailer: You'd do that? Oh, you lovely little request.
mailer: Three of them. One for the Alarm in the Crontab, one for Swap in the Stacks, one for Buoy out on the Buffer.
mailer: Hand them over in person. If they bounce off you too, I'll know it's the end of the world.
-> end
#no
mailer: Fair. Fair. I'll be here. Being returned to.

@mailer.progress
mailer: Any luck? Each one you hand over, I feel it. A little "delivered" in my chest.
? letter.alarm letter.swap -> two
? letter.alarm -> one
mailer: The Alarm's is first on your way. The Crontab, east.
-> end
#one
mailer: The Alarm got hers! I felt it. Swap's next, up in the Stacks.
-> end
#two
mailer: Two delivered! Just Buoy now, out on the water.

@mailer.done
mailer: All three! Delivered! Not a single bounce!
mailer: You've no idea. A postman whose letters never arrive is just a fellow with a bag.
mailer: Here. It isn't much. A spare heartbeat somebody posted me once, years ago. I never knew who it was for.
~ heart +q.letters.done
mailer: It was for you, I think. Things usually are, in the end.
> Does anyone ever write to you? -> you
> Thank you, Mailer. -> end
#you
mailer: Me? No. Nobody writes to the post.
: You haven't got a pen, or paper, or hands. But you can ping. You ping him: a small hello, addressed to Mailer.
mailer: Oh. Oh, that came straight to me. Delivered.
mailer: First one in years. I'll keep it.
~ +mailer.letter

@mailer.after
? mailer.letter -> kept
mailer: Business is picking up! A letter got all the way to the Crontab this morning. On its own!
-> end
#kept
mailer: I keep your hello in the front pocket. Delivered, every time I read it.

@mote.hello
mote: Hi. Don't step on me. I'm small. I'm a fragment.
mote: I'm Mote. Three bytes of a packet. The rest of me got knocked loose when the routes went, and blew all over the network.
mote: Gran says I'll be all right. Gran says that about everything.
> I'll look for your pieces. -> look ~ +q.mote
> What do they look like? -> look ~ +q.mote
#look
mote: They look like me. Shiny, and a bit sharp at the edges.
mote: There are four. I can feel them. One's close, one's ticking, one's wet and one's in the dark.
mote: Bring them back and I'll be a whole packet. I've always wanted to be routable.

@mote.progress
? frag.*>=4 -> all
? frag.*>=3 -> three
? frag.*>=2 -> two
? frag.*>=1 -> one
mote: One's close, one's ticking, one's wet, one's in the dark. That's all I know.
-> end
#one
mote: You found one! I can feel it. I'm about a quarter more me.
-> end
#two
mote: Two! I'm half a packet. Half is a lot, when you're me.
-> end
#three
mote: Three. One left. The one in the dark. It's scared, I think.
-> end
#all
mote: You've got them. All of them. Can I...?
: The fragments hum, then click together. Mote stretches. He's taller. He has a header now.
mote: I've got a header! I've got a checksum! It checks out!
mote: I'm a whole packet. I could go anywhere. I could go...
mote: ...I think I'll stay here a bit, actually. Being whole is new. Here.
~ heart +q.mote.done
mote: Gran gave me this when I was in bits. A spare heartbeat. You need it more than me.

@mote.after
mote: I'm a packet! A whole one! I keep checking. Still whole.

@defunct.hello
defunct: Hello. Don't mind me. I'm defunct.
defunct: A zombie, people say. That's unkind. I finished. I finished ages ago. I'm only waiting for someone to notice.
defunct: When a process ends, its parent collects its exit status, and then it can go. Mine never came.
> Where's your parent? -> where ~ +q.reap
> That's awful. -> awful ~ +q.reap
#where
defunct: Gone, I think. Long gone. Off with the old services.
defunct: Orphans get taken in by the oldest process there is, if anyone can find him. Nobody's been down to the old Ports in years.
-> end
#awful
defunct: It's all right. It's quiet. You get used to waiting.
defunct: They say the oldest process of all takes in orphans, down in the old Ports. If he's still running.

@defunct.wait
defunct: Still here. Still finished. Down in the old Ports, they say. The oldest process there is.

@defunct.reaped
defunct: Oh. Do you feel that? Someone's... someone's waiting for my status.
defunct: Init. It's Init, isn't it. He's got me. After all this time.
defunct: Exit status zero. That's good. That means I did all right.
defunct: Thank you, little ping. Tell the others I went quietly. Well. I always was quiet.
: Defunct is very still. Then he isn't there at all.
~ +q.reap.done tel+1
? with.tel -> tel
-> end
#tel
tel: Goodbye, dear. Exit zero. You did all right.

@lru.hello
lru: Oh! A visitor! Wait, don't tell me, I'll remember. No, I won't. I'm a cache.
lru: Lru. Least recently used. When the network gets full, I'm the first thing it forgets.
lru: So I hold on to everything I can. Logs, mostly. The network's diaries.
lru: Lots blew away when the routes went. If you find any out there, bring them home. Read them, and I'll keep them.
~ +q.archive
? log.*>=1 -> some
-> end
#some
lru: Oh, you've got one already. Gran's, is it? I'll put it on the shelf.

@lru.progress
? log.*>=8 -> all
? log.*>=6 -> most
? log.*>=3 -> some
lru: Keep looking. Logs hide in corners. Ping, and they'll show themselves.
-> end
#some
lru: A few on the shelf now. Someone was keeping notes on the Watchdog, I think. Odd thing to keep notes on.
-> end
#most
lru: They're about Gran. And the Watchdog. Did you know they used to be partners? Neither did I. I'd forgotten. I forget everything.
-> end
#all
lru: That's all of them. All eight. Let me read them together, in order...
lru: The first is Gran's: "I let things through. He keeps things out. We are a good pair."
lru: Then the Worm, and the Watchdog cutting routes to keep it out. Then Gran and him arguing. Then they stopped talking.
lru: Then his timer. "Keepalive from Gateway: missed." Over and over. He waited for her to check in. She never did.
lru: And the last one, his own. "Nobody checks in. Either everyone is gone or everyone is compromised."
lru: And under it, very small: "Are you still there?"
lru: He was asking the same thing, Echo. All this time. Nobody answered him either.
~ +q.archive.done
lru: Take that with you. If you ever meet him, he'll want to know someone read it.

@lru.after
lru: Every log on the shelf. The whole story. I've read it eleven times. I keep forgetting the ending.

@lru.float
lru: Oh! A float! I've got you cached, I think. Hang on. Float, Float... here.
lru: Original value: three point one four one five nine two six five three five eight nine seven nine...
float: That's me? That's what I was?
lru: That's what you were stored as. Then you got passed around and rounded, and rounded, and rounded.
float: And now I'm about three.
lru: Well. Yes.
float: ...
float: You know, I think about three is fine. I've been about three across a whole sea. About three got us here.
float: Pi is very nice. But nobody ever floated anywhere being exactly pi.
~ +q.float.done float+2
lru: That's a healthy attitude for a number. I'll keep the original, in case.
float: Keep it. I don't need it. Roughly.

@archive.shelf
: Shelves of logs, most of them blank where the words fell out. A few still say when things happened, and to whom.

@hop.hello
hop: Can't stop! Hop four thousand and... where was I? Start again. Hop one!
hop: Everything's under construction out there. Bugs, bosses, pipes. I keep running right. It keeps going.
hop: You going somewhere? Got a destination?
> Somewhere. My header's smudged. -> smudged
> Where are you going? -> where
#smudged
hop: Ha! Mine too. Never stopped me. Keep hopping. Something always answers in the end.
-> end
#where
hop: Home, I think. It's a long way. Bye!

@hop.again
hop: Still hopping. You?

@pip.talk
? beat.spoofer -> late
? beat.oom -> mid
pip: Are you a ping? I'm a ping! Well. I'm going to be. Gran hasn't sent me yet.
pip: I've never been anywhere. I've been here. Here's all right.
-> end
#mid
pip: Is it scary out there? Gran says you're doing well. She says that about everything, but she says it more about you.
-> end
#late
pip: When it's all fixed I'm going to go somewhere. Anywhere. Then come back and tell everyone about it. Like you.

@nib.talk
nib: I'm Nib. Four bits. Half a byte. People round me up all the time.
? with.float -> float
-> end
#float
float: People round me all the time too!
nib: Isn't it the worst?
float: It's about the worst.

@stub.talk
stub: TODO.
stub: Sorry. I'm a stub. Someone was going to fill me in, then got busy. I'm just this.
? chapter>=3 -> later
-> end
#later
stub: Still TODO. But I've been thinking. Maybe I don't need filling in. Maybe I'm a nice little stub as I am.

@byte.talk
? beat.spinlock -> later
byte: Did you hear? Gran made a ping. With her own hands. She hasn't made anything since the routes went.
byte: She had a partner once, you know. At the very start. Nobody talks about it.
-> end
#later
byte: Gran stands at her window when you're out, looking whichever way you went. She thinks nobody notices.

@ttl.talk
? ttl.thought -> after
ttl: Mind how you go, young one. I've a TTL of one. One more hop and I'm dropped.
ttl: So I stay put. Here, nothing takes a hop off you.
> That sounds safe. -> safe
> That sounds lonely. -> lonely ~ +ttl.thought
#safe
ttl: Safe. Yes. That's the word I use too.
-> end
#lonely
ttl: You've a very direct way of putting things, for something so small.
ttl: Maybe one hop is worth spending. On something good. I'll think on it.
-> end
#after
? ended -> gone
ttl: Still thinking. One hop. It has to be a good one.
-> end
#gone
ttl: I'm going to spend it. My one hop. I'm going to go and see the sea. Wish me luck.

@log.1
: GATEWAY'S NOTES, DAY ONE. "Brought the network up today. I let things through. He keeps things out. We are a good pair, he and I."
`;

export const PART: Part = {
  areas: [
    {
      id: 'gran',
      name: "Gran's house",
      chapter: 0,
      region: 'loopback',
      song: 'calm',
      map: house,
      key: {
        g: npc('gran', [
          ['!with.cron', 'gran.wait'],
          ['!p.told', 'gran.go'],
          ['!beat.spinlock', 'gran.c1'],
          ['!beat.oom', 'gran.c2'],
          ['!beat.jitter', 'gran.c3'],
          ['!ended', 'gran.c4'],
          ['', 'gran.end'],
        ]),
        c: npc('cron', 'p.cron', 'p.cron.here !with.cron'),
        d: exit('loopback', 'G', 'with.cron p.told', 'gran.notyet'),
        L: item('log.1', 'log'),
      },
      enter: [
        { if: '!p.woke', scene: 'p.wake' },
        { if: 'beat.spinlock', scene: 'gran.after1' },
        { if: 'beat.oom', scene: 'gran.after2' },
        { if: 'beat.jitter', scene: 'gran.after3' },
        { if: 'ended', scene: 'gran.epilogue' },
      ],
      hint: "Gran's house. Nothing in here wants pinging but the kettle, and she hasn't got one.",
    },
    {
      id: 'loopback',
      name: 'Loopback',
      chapter: 0,
      at: [128, 72],
      travel: 'x',
      map: square,
      key: {
        G: exit('gran', 'd'),
        A: exit('archive', 'd'),
        E: exit('c1-gate', 'w', 'loop.lit'),
        D: door('a'),
        N: exit('c2-gate', 's', 'beat.spinlock', 'loop.north.no'),
        W: exit('c3-docks', 'e', 'beat.oom', 'loop.west.no'),
        S: exit('c4-steps', 'n', 'beat.jitter', 'loop.south.no'),
        a: lamp('a'),
        x: mark(T.RUG),
        r: sign('loop.board'),
        q: sign('loop.sign.north'),
        m: npc('mailer', [
          ['q.letters.done', 'mailer.after'],
          ['letter.alarm letter.swap letter.buoy', 'mailer.done'],
          ['q.letters', 'mailer.progress'],
          ['', 'mailer.hello'],
        ]),
        o: npc('mote', [
          ['q.mote.done', 'mote.after'],
          ['q.mote', 'mote.progress'],
          ['', 'mote.hello'],
        ]),
        f: npc(
          'defunct',
          [
            ['reap.init', 'defunct.reaped'],
            ['q.reap', 'defunct.wait'],
            ['', 'defunct.hello'],
          ],
          '!q.reap.done',
        ),
        h: npc('hop', [
          ['seen.hop.hello', 'hop.again'],
          ['', 'hop.hello'],
        ]),
        p: npc('pip', 'pip.talk'),
        n: npc('nib', 'nib.talk'),
        u: npc('stub', 'stub.talk'),
        b: npc('byte', 'byte.talk'),
        t: npc('ttl', 'ttl.talk'),
        F: item('frag.1', 'fragment'),
      },
      signals: { a: { latch: 'loop.lit' } },
      enter: [
        { if: 'with.cron', scene: 'loop.first' },
        { if: 'ended', scene: 'loop.epilogue' },
      ],
      hint: 'The lamps want lighting, dear. A ping near each will do it.',
    },
    {
      id: 'archive',
      name: 'The Archive',
      chapter: 0,
      region: 'loopback',
      song: 'calm',
      map: archive,
      key: {
        l: npc('lru', [
          ['q.float with.float !q.float.done', 'lru.float'],
          ['q.archive.done', 'lru.after'],
          ['q.archive', 'lru.progress'],
          ['', 'lru.hello'],
        ]),
        s: sign('archive.shelf'),
        d: exit('loopback', 'A'),
      },
    },
  ],
  script,
  logs: { 'log.1': "Gateway's notes, day one" },
};
