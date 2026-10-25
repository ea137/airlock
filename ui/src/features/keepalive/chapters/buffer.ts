import type { Part } from '../content';
import { boss, door, exit, ghost, item, lamp, mark, mover, node, npc, T } from '../world';

const docks = `
####################
#            ......#
#            ..B..&#
#   k        ......#
#...         ....+.#
#... ...     ......#
w... ...    m.a....e
#... ...     ......#
#...         ..x...#
#            ......#
#            ..&...#
####################`;

const drift = `
######################
#                 ...#
#                 .&.#
#                 ...#
#...              .r.#
#...     ....     ...#
w...  ~  .F..zzzzz...e
#...     ....     ...#
#...              ...#
#...              .+.#
#                 ...#
######################`;

const reefs = `
########################
#            .F.       #
#                      #
#                      #
#      ....            #
#      ....   ...   ...#
#      ....!!!...   ...e
w.     .O..   ...   ...#
#      ....   ...   .+.#
#      ....            #
########################`;

const overflow = `
######################
#      ...       ....#
#      ...  ~    ....#
#      ...       ..+.#
#                ....#
#                ....#
#                ....e
#      ...       ....#
w.zzzzz...       ....#
#      ...       ....#
#      .r.      m....#
#                ....#
######################`;

const lighthouse = `
####################
#a......  ......a..#
#.                .#
#.                .#
#.      ...       .#
#.      .L.       .e
#.      ...       .#
#                 .#
#                 .#
#.                .#
wD................a#
####################`;

const maw = `
####################
#                  #
#  ....      ....  #
#  ....  ~   ....  #
#  ....  1   ......e
#  ....      ....  #
#                  #
#   2    ~    3    #
#                  #
#       ....       #
#  4    ....    5  #
#       ..B.       #
#       ....       #
####################`;

const script = String.raw`
@c3.arrive
: The Buffer. A grey sea of dropped packets, lapping at nothing. Things float past: half a header, a checksum, a hello that never got its reply.
cron: Everything that didn't arrive ends up here. Everything that was ever late.
sudo: Ferries. Dead in the water. There'll be a regulator on the dock.
: Far out, on an island, something pale is drifting in slow circles.
cron: Is that... someone?
~ +c3.arrived

@buoy.talk
? letter.buoy -> after
buoy: Ahoy. Or whatever's left of ahoy. Not many boats any more.
buoy: I mark the channel. Nobody comes down the channel. I mark it anyway.
? carry.buoy -> ask
-> end
#ask
buoy: That's a letter, isn't it? Is it... is it for me?
-> end
#after
buoy: I've moored your letter to me. It goes up and down with the tide. It's the best thing that's happened to the channel in years.

@buoy.letter
buoy: For me. Nobody sends letters to a buoy.
: It reads it, bobbing.
buoy: It's from Loopback. From Mailer. "Thank you for keeping the way marked, even when no one came."
buoy: Even when no one came. He noticed.
~ -carry.buoy +letter.buoy float+1
? with.float -> float
-> end
#float
float: Oh, that's lovely. That's about the loveliest thing.

@c3.drift
: The island in the middle of the drift. A pale shape, turning slowly, talking to itself.
float: ...three point one four... three point one... three... about three... roughly...
cron: Hello? Hello!
float: Oh! Hello! Are you real? You look about real.
float: I'd come over, but I can't. I don't know where I'd stop. I'm stuck on this island going round and round, being rounded.
sudo: There's a relay on the shore. Lights a bridge out to her.
cron: It won't stay lit long. Be quick. Or be with me.

@float.meet
float: You came all the way over! On purpose! Nobody does anything on purpose round here.
float: I'm Float. A floating-point number. Well. I was a particular one, once. I've been passed round so much I've forgotten my digits.
float: Every time something passes me on, it rounds me a bit. One day I'll round to nothing and float right off.
> You're not nothing. -> not ~ float+1
> We could use someone who floats. -> use
> Come with us and we'll find your digits. -> digits ~ float+1
#not
float: That's... not a precise thing to say. I like it a lot.
-> join
#use
float: Use? Oh. I suppose I do float. I could float you, maybe. If you don't weigh much.
-> join
#digits
float: You think they're somewhere? My digits?
cron: Everything's written down somewhere. That's what logs are for.
#join
float: All right. Approximately yes. Definitely approximately.
~ join:float +float.joined
: Float bobs up and settles in behind Cron, humming.
float: Put me in front and press A, and up we go. I can carry you over the void for a little while. About four tiles. About.
float: If there's a vent, a warm updraft, I can catch it and go further.
float: And I won't drop you. I'll round you up. Promise.

@c3.reefs
float: The reefs! I used to drift past here. The static's horrible underfoot. Floating over it doesn't hurt at all.
sudo: The last gap's too far for her alone. Push a block in the first bit, and she does the rest.
float: Teamwork! Roughly.

@c3.confess
: A campfire on a scrap of shore. The first warm thing in the Buffer. Everyone sits.
sudo: I need to say something. Before the kid hears it from someone else.
sudo: That null route on the wall in the Stacks. The first one, on route 0. That's mine. I wrote it.
cron: Sudo...
sudo: The Admin said contain the infection on route 0. So I closed it. Null route. Nothing in, nothing out. Till morning.
sudo: The Admin never came back. Morning never came. And the Watchdog saw what I did and decided that's how you keep things safe.
sudo: It's been closing routes ever since. All of them. It learned it from me.
float: Oh, Sudo.
> It wasn't your fault. -> fault ~ sudo+1
> You should have told us sooner. -> sooner
> Then we'll undo it. Together. -> together ~ sudo+2 cron+1 float+1
#fault
sudo: It was my hand on it. Don't give me that.
sudo: ...But thanks for trying to.
-> after
#sooner
sudo: Yeah. I should've. I'm telling you now.
-> after
#together
sudo: ...
sudo: Together. Right. All right.
cron: I'll hold the time.
float: I'll hold the... I'll hold whatever's left. Roughly everything.
#after
~ +c3.confess
sudo: That's it. That's the thing. Now you know what you're walking with.
-> @c3.overflow

@c3.overflow
~ +seen.c3.overflow
float: The overflow. Things pour over the edge here and never come back. I lost a lot of decimals here.
cron: The ferry runs north. From the top, with my four seconds, Float could carry you over.
sudo: And the bridge to the west only lights from the south island. Not long enough to cross, unless the clock helps.

@c3.light
: The lighthouse. Pitch dark. You can feel the void all round you.
cron: Light the lamps. Ping near them. They stay lit.
float: Carefully, there are gaps. I'll carry you, if you can see where you're going.
~ +c3.light.seen

@jitter.meet
: The maw. Islands in the void, and something under them, moving.
: It surfaces where you aren't. Then where you were. Then nowhere.
jitter: you're... late... you're... early... you're... where... are... you...
float: It's Jitter. It never arrives when it means to. Always a little behind itself.
sudo: It's coming up out in the deep, away from the islands. Nowhere we can stand.
float: Nowhere you can stand. I can float you out to it. Then you ping it right on the nose.
cron: And if it's up and you're not ready, I'll keep it up. Four seconds.
~ boss

@jitter.again
jitter: ...where... are... you...
float: Out we go. Ping it while it's up.
~ boss -seen.jitter.again

@jitter.down
: Jitter sinks, and the sea goes flat. Truly flat, for the first time. You can see all the way across.
jitter: ...arrived. finally... arrived.
float: We did it! We did it about perfectly!
: Then, out of the flat water, a voice. Old, crackly, talking in the clear for anyone who'll listen.
tel: Hello? Hello. Is anyone still connected? This is port twenty-three, talking in plain text, as ever.
tel: If you can hear me, the stairs south of Loopback are open. I've opened them. Come down. I've got something to tell you, and I can't keep it in much longer. I never could.
cron: Port twenty-three. That's Telnet. That's ancient.
sudo: Gateway will know.
~ goto:gran:@ face:down

@float.talk1
float: Can I ask you something? Is it bad, being approximate?
> No. It's how you hold things gently. -> gentle ~ float+1
> It's fine. Most things are. -> fine
> It's a bit sad. -> sad
#gentle
float: Hold things gently. I'll keep that. Exactly. Well. Almost exactly.
-> on
#fine
float: Mm. Most things are. That's nice to hear.
-> on
#sad
float: It is a bit. Thank you for saying. Nobody says.
#on
? float>=5 -> ask
-> end
#ask
float: Do you think... somewhere, somebody wrote down what I was, before? My first value?
float: Lru, maybe. In Loopback. She keeps everything. If we go back, could we ask her?
~ +q.float
float: Thank you. Even if it's nothing. Especially if it's nothing.

@float.talk2
float: Sudo's carrying something heavy. Even for Sudo.
float: And Cron's frightened all the time and pretends he's only on time.
float: And Tel tells everyone everything because she can't not.
float: And you're a question that walks. Do you think I'm enough? For a group like this?
> You're the one who carries us. -> carry ~ float+1
> Nobody's exactly enough. That's why we're together. -> together ~ float+1
#carry
float: I do, don't I. Over the gaps. That's... a lot, actually.
-> end
#together
float: Oh. Oh, that's a nice sum.

@float.idle
? chapter>=5 -> c5
? chapter>=4 -> c4
float: The Buffer's quieter since Jitter. I miss the waves a bit. Roughly a bit.
-> end
#c4
float: It's so dark down here. I glow a little. Did you know? About point two of a glow.
-> end
#c5
float: There's nothing out there to float over. It's all over. Hold on to me.

@log.6
: LOG, SYSTEM. "KEEPALIVE FROM GATEWAY: MISSED. KEEPALIVE FROM GATEWAY: MISSED. KEEPALIVE FROM GATEWAY: MISSED." It goes on for pages.
`;

const hole = mark(T.PIT);

export const PART: Part = {
  areas: [
    {
      id: 'c3-docks',
      name: 'The docks',
      chapter: 3,
      at: [102, 76],
      travel: 'x',
      map: docks,
      key: {
        e: exit('loopback', 'W'),
        w: exit('c3-drift', 'e'),
        a: node('a'),
        m: mover('l4', 0.45, 'a'),
        k: mover('d5', 0.5, 'a'),
        x: mark(),
        B: npc('buoy', [
          ['carry.buoy', 'buoy.letter'],
          ['', 'buoy.talk'],
        ]),
      },
      enter: [{ if: '', scene: 'c3.arrive' }],
      hint: 'Ping the regulator on the dock. The ferries will run, and you hop from one to the next.',
    },
    {
      id: 'c3-drift',
      name: 'The drift',
      chapter: 3,
      at: [86, 68],
      map: drift,
      key: {
        e: exit('c3-docks', 'w'),
        w: exit('c3-reefs', 'e', 'with.float'),
        r: node('a', 90),
        z: ghost('a'),
        F: npc('float', 'float.meet', '!with.float'),
      },
      enter: [{ if: '', scene: 'c3.drift' }],
      hint: 'Ping the shore relay and run the bridge before it fades. Later, a vent halfway across will hold you up.',
    },
    {
      id: 'c3-reefs',
      name: 'The reefs',
      chapter: 3,
      at: [70, 76],
      map: reefs,
      key: {
        e: exit('c3-drift', 'w'),
        w: exit('c3-overflow', 'e'),
        F: item('frag.3', 'fragment'),
      },
      enter: [{ if: '', scene: 'c3.reefs' }],
      hint: "Float carries you about four tiles. The last gap is five. Sudo's block makes it four.",
    },
    {
      id: 'c3-overflow',
      name: 'The campfire',
      chapter: 3,
      at: [56, 64],
      map: overflow,
      key: {
        e: exit('c3-reefs', 'w'),
        w: exit('c3-lighthouse', 'e'),
        m: mover('u8', 0.4),
        r: node('a', 60),
        z: ghost('a'),
      },
      enter: [
        { if: 'with.sudo', scene: 'c3.confess' },
        { if: '', scene: 'c3.overflow' },
      ],
      hint: 'Ride the ferry up. Float from the top, over the vent, to the north island. Then down, and ask Cron to hold the bridge.',
    },
    {
      id: 'c3-lighthouse',
      name: 'The lighthouse',
      chapter: 3,
      at: [40, 74],
      dark: true,
      map: lighthouse,
      key: {
        e: exit('c3-overflow', 'w'),
        w: exit('c3-maw', 'e'),
        a: lamp('a'),
        D: door('a'),
        L: item('log.6', 'log'),
      },
      signals: { a: { latch: 'c3.light.lit' } },
      enter: [{ if: '', scene: 'c3.light' }],
      hint: 'Three lamps. The ring has gaps; Float will take you over them.',
    },
    {
      id: 'c3-maw',
      name: 'The maw',
      chapter: 3,
      at: [24, 64],
      map: maw,
      key: {
        e: exit('c3-lighthouse', 'w'),
        B: boss('jitter'),
        '1': hole,
        '2': hole,
        '3': hole,
        '4': hole,
        '5': hole,
      },
      enter: [
        { if: '!beat.jitter', scene: 'jitter.meet' },
        { if: '!beat.jitter', scene: 'jitter.again' },
      ],
      hint: "When it surfaces out in the deep, float out towards it and ping. Cron can keep it up.",
    },
  ],
  script,
  talks: [
    { who: 'float', scene: 'float.talk1', if: 'with.float' },
    { who: 'float', scene: 'float.talk2', if: 'chapter>=4' },
  ],
  logs: { 'log.6': 'Keepalive missed' },
};
