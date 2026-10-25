import type { Part } from '../content';
import { boss, door, exit, ghost, item, lamp, mark, node, npc, sentry, shut, sweeper, terminal } from '../world';

const steps = `
#######n##########
#a.....:.....a####
#......:......####
####...:...#######
#  #...:...#     #
#  ....:........ #
w.. ...:.  .....a#
#.. ...:.  ......#
#..         ..+x.#
#...........  ...#
##################`;

const museum = `
######################
#&..g....f.....p....&#
#....................#
#:::::::::::::::::::.#
#....................#
#.........T..........e
#....................#
#..K.................#
wD...................#
#&.........L.......+&#
######################`;

const switchboard = `
####################
############.......#
############.1..2..#
############.......#
############.......#
#F##########.......#
w..C..B..A.........e
############.......#
############.......#
############..3....#
############.....+.#
####################`;

const hall = `
##################
#&......I.......&#
#................#
#..::::::::::::..#
#..:..........:..#
#..:...K......:..e
#..:..........:..#
#..::::::::::::..#
#..............+.#
w................#
##################`;

const bridge = `
############################
#########################S##
#.....#      .r     ....#.##
#.....#      ..     ....#.##
w...*..zzzzzz..     .O.....e
#.....#      ..     ....#.K#
#.....#      ..     ....#.##
############################`;

const gallery = `
################
#a............a#
#..............#
#..............#
#..............#
#......B.......e
#..............#
#..K...........#
#..............#
#a............a#
################`;

const script = String.raw`
@c4.arrive
: The stairs go down a long way. The air gets older. Somewhere below, a voice is talking to nobody, in plain text.
tel: ...and that's why we never ran finger on a Friday. Now, where was I. Port twenty-three, still talking, if anyone's...
float: It's very dark. I'm glowing as hard as I can. About point two.
cron: Ping, and the lamps will hold the light for you.
~ +c4.arrived

@c4.museum
: A museum. Glass cases of old protocols, most of them asleep. A little lamp on a curator's desk.
tel: Visitors! Real ones! Over here, dears, by the desk. Mind the exhibits, they bite. Well, Finger does.

@tel.meet
tel: There you are. Let me look at you. I'm Telnet. Tel. Port twenty-three. Curator of the Museum of Dead Protocols, and its last living exhibit.
tel: Oh, and you're... let me read you, dear, I can't help it. Everything's plain text to me.
: She peers at your header. There's something written there you've never been able to read.
tel: Smudged. Gateway's handwriting. She always did press too hard.
tel: Source: gateway, Loopback. Payload: "Are you still there?"
tel: Destination...
tel: Oh. Oh, Gateway, you old fool.
tel: Destination: watchdog dot core.
cron: The Watchdog? Gran sent us to the WATCHDOG?
sudo: ...
tel: You don't know, do you? Gateway and the Watchdog. They built this network together. She let things through, he kept things out.
tel: He's a watchdog timer, dears. That's all he ever was. Somebody has to send him a keepalive every sixty seconds: "still here, all's well." If nobody does, he assumes the worst. And he bites.
tel: Gateway was the one who checked in. Every minute, for years. Then they had a row, after the Worm. And she stopped.
float: She stopped checking in? For how long?
tel: Long enough that he decided everyone was gone. Or everyone was bad. So he started closing routes, to keep what's left safe. He's been biting ever since.
> And I'm... -> me
> So that's what I'm for. -> me
#me
tel: You're the keepalive, love. She finally sent one.
tel: Late. Ever so late. But sent.
> Then I'd better deliver it. -> deliver ~ tel+1 cron+1
> Why didn't she go herself? -> why ~ tel+1
#why
tel: Pride. Fear. They're the same thing, at her age. And she's a gateway: she can't leave her door.
#deliver
tel: That's the spirit. Now. You'll want someone who talks to old machines, and old machines are all that's left between here and him.
tel: I'm coming with you. Don't argue. Nobody's argued with me in years and I've missed it.
~ join:tel +tel.joined
tel: Terminals, dear. Walk up to one with me along and I'll have a word with it. I can talk anything into anything. It's stopping that's the trouble.
tel: That door by the west wall, for instance. Its terminal and I go way back.

@c4.museum.door
tel: Hello, old thing. It's me. Yes, me. No, I won't tell anyone about the thing.
sys: LOGIN: tel. ACCESS GRANTED. DOOR WEST: OPEN.
~ sig:a
tel: There. Manners, that's all it takes. And blackmail.

@gopher.talk
? with.tel q.tel !bye.gopher -> bye
gopher: Burrow, burrow. Menus, menus. Nobody browses any more. They all want links.
-> end
#bye
tel: Gopher, love. We're going out. I don't think I'll come back.
gopher: Out? Above ground? Nobody goes above ground.
tel: I'm going to. I wanted to say: you were the best menu I ever browsed.
gopher: ...Burrow. Burrow. That's the nicest thing anyone's said to me since nineteen ninety-three.
~ +bye.gopher tel+1

@finger.talk
? with.tel q.tel !bye.finger -> bye
finger: Who's logged in? Nobody. Who's logged in? Still nobody. Plan: none.
-> end
#bye
tel: Finger, dear. I'm logging out. Properly, this time.
finger: You'd tell me if you were. You'd tell everybody. You always did.
tel: I am telling you. That's what this is.
finger: ...Plan: miss you.
~ +bye.finger tel+1

@ftp.talk
? with.tel q.tel !bye.ftp -> bye
ftp: Active or passive? Active or passive? I can never remember which one we're doing.
-> end
#bye
tel: FTP, sweetheart. I'm going.
ftp: Going active or going passive?
tel: Active, love. For once.
ftp: Transfer complete, then. Safe travels.
~ +bye.ftp tel+1

@c4.switch
tel: The switchboard. Three terminals, three doors. Every one of them flips two or three doors at once. Rude, but that's switchboards.
tel: The middle door's a funny one: it's shut while its line is live. So we want the first and last lines live, and the middle one dead.
cron: Try them and see. You can always try them again.

@t1.talk
tel: Number one. What do you do, dear?
sys: SWITCH 1: LINE A, LINE B. FLIPPED.
~ flip:a flip:b

@t2.talk
tel: Number two. Go on, then.
sys: SWITCH 2: LINE B, LINE C. FLIPPED.
~ flip:b flip:c

@t3.talk
tel: Number three. The loud one.
sys: SWITCH 3: LINE A, LINE B, LINE C. FLIPPED.
~ flip:a flip:b flip:c

@c4.hall
: A long hall, very old, very tidy. At the far end, an old process sits where he's always sat.
init: Visitors. Do you know, I've had visitors before. In nineteen seventy. I remember it well. I'm process one.

@init.talk
init: I'm Init. The first. I start everything. And when a process is left behind, I take it in. It's the oldest job there is.
? q.reap !reap.init -> reap
init: Nobody's been left behind in a long while. Or nobody's come to tell me.
-> end
#reap
> There's one in Loopback. Defunct. Waiting. -> tell
#tell
init: Defunct. Waiting for his parent. How long?
: You tell him. Longer than anyone should wait.
init: Then he's mine now. I'll wait for his status. He'll feel it, and he can go.
~ +reap.init tel+1
tel: Oh, Init. You never could leave anyone out.

@c4.adminlog
? sudo.orders -> again
? q.sudo -> read
tel: The Admin's last log, dear. Locked to root.
sudo: Leave it.
-> end
#read
sudo: That's it. That's the Admin's. Tel, read it. I'll unlock it.
-> @sudo.orders
#again
tel: You've read it, love. It says what it says. "Do not cut anything."

@c4.bridge
sudo: The handshake bridge. Every old protocol had to cross it, once.
cron: A watch-clock over the corridor, a gap, a bridge that fades, and a spring room at the end.
float: It needs all of us. About all of us. All of us.
tel: Then we'll go in order, like a proper handshake. Hello, hello back, and off we go.

@c4.bridge.term
tel: You. Watch-clock. Look at the ceiling for a bit, there's a love.
sys: SENTRY 7: STANDING DOWN.
~ sig:k

@spoofer.meet
: The gallery. Dark. Something in the middle of it, wearing a face you know.
spoofer: Echo! It's me. It's Cron. Come here, quick, we're going home.
cron: I'm... I'm right here. That's not me.
spoofer: Echo, it's Sudo. Turn back. This way's all wrong.
sudo: Nice try.
spoofer: Turn back. Turn back. He doesn't want to be reached. Nobody should reach him. Go home.
tel: It's a spoofer, dears. One of his, by the smell. It speaks in our voices and it splits into copies. Only the real one answers a ping.
tel: And I can have a word with that terminal. Spoofers hate being told they're fake.
sudo: Ping it, find the real one, and it stands still. Then I shove.
~ boss

@spoofer.again
spoofer: Turn back, Echo. Turn back.
tel: Ping for the real one. Then Sudo.
~ boss -seen.spoofer.again

@c4.gallery.term
tel: Hello, gallery. Tell everyone in here they're copies, would you? Loudly.
sys: BROADCAST: ALL INSTANCES BUT ONE ARE FAKE.
~ sig:b
tel: That'll slow them down. Nothing slows you down like being told you're not real.

@spoofer.down
: The Spoofer's faces peel off one by one. Under the last is nothing at all. A shape that wanted you to turn back.
spoofer: he... said... don't let them... come close... coming close... is how you get hurt...
tel: That's him all over. Afraid of being reached.
: Behind where it stood, the gallery's back wall is gone. Beyond it, the Null. Not dark. Nothing. And very far in, something that ticks.
sudo: That's it. That's where he is.
float: There's nothing to stand on.
cron: There's us to stand on. Come on. On time. Together.
> Together. -> on ~ cron+1 sudo+1 float+1 tel+1
> Let's go. -> on
#on
~ chapter:5 goto:c5-edge:x face:up

@tel.talk1
tel: Do you know what it's like, being plain text? Everything I think comes out. Everything I hear, I repeat.
tel: People stopped using me. Not because I was broken. Because I couldn't keep a secret. They wanted something encrypted. Discreet.
> I like that you're honest. -> honest ~ tel+1
> That must be lonely. -> lonely ~ tel+1
> Maybe some things should stay secret. -> secret
#honest
tel: Honest! Ha! Nobody's called it that. They called it a security hole.
-> on
#lonely
tel: It was, dear. Very. I talked to the walls. The walls are terrible listeners.
-> on
#secret
tel: Maybe. But secrets are how Gateway and he ended up like this. Nobody said anything.
#on
? tel>=5 -> ask
-> end
#ask
tel: Before we go into the Null... I'd like to say goodbye to my exhibits. Gopher, Finger, FTP. Properly. Would you walk me round?
~ +q.tel
tel: Thank you, love. They'll pretend not to care. They'll care.

@tel.lastsession
tel: That's all of them. Goodbyes said.
tel: Do you know, I've never closed a session properly? Always got cut off. Timed out. Somebody pulled the plug.
tel: So. Here goes. Session closed, by the user. Connection terminated, with thanks.
: Tel types something, slowly, into the air. Nothing happens. She looks very happy.
tel: There. Now whatever happens in there, I've had a proper ending. Everyone should get one.
~ +q.tel.done tel+2

@tel.talk2
tel: Shall I tell you something about Gateway? I can't not, so I'll tell you anyway.
tel: She kept a note on her desk, all those years. "Check in at :00." Every minute, she'd look at it.
tel: After the row, she turned it face down. But she never threw it away.
> She still cares. -> cares ~ tel+1
> Then why stop? -> why
#cares
tel: Course she does. That's why it hurt.
-> end
#why
tel: Because if she checked in and he didn't answer, then she'd know. Easier not to ask. People are like that.
tel: Pings aren't. That's why she made you.

@tel.idle
? chapter>=5 -> c5
tel: Down here's where all the old protocols came to rest. I used to give tours. Nobody came. I gave them anyway.
-> end
#c5
tel: Stay close, dear. I'll do the talking. When it matters, you will.

@log.7
: LOG, ADMIN. "Watchdog flagged route 0 again. Probably nothing. Asked Sudo to contain it overnight. I'll look in the morning. Must remember to tell Gateway to keep checking in, whatever she and he are rowing about."
`;

export const PART: Part = {
  areas: [
    {
      id: 'c4-steps',
      name: 'The old stairs',
      chapter: 4,
      at: [128, 94],
      travel: 'x',
      dark: true,
      map: steps,
      key: {
        n: exit('loopback', 'S'),
        w: exit('c4-museum', 'e'),
        a: lamp('p'),
        x: mark(),
      },
      enter: [{ if: '', scene: 'c4.arrive' }],
      hint: 'Light the lamps as you go, dear, so you can see the edges. Float for the gaps.',
    },
    {
      id: 'c4-museum',
      name: 'The museum',
      chapter: 4,
      at: [112, 104],
      map: museum,
      key: {
        e: exit('c4-steps', 'w'),
        w: exit('c4-switchboard', 'e'),
        D: door('a'),
        K: terminal('c4.museum.door'),
        T: npc('tel', 'tel.meet', '!with.tel'),
        g: npc('gopher', 'gopher.talk'),
        f: npc('finger', 'finger.talk'),
        p: npc('ftp', 'ftp.talk'),
        L: item('log.7', 'log'),
      },
      enter: [{ if: '', scene: 'c4.museum' }],
      hint: "That terminal by the door and I go way back. Walk me over.",
    },
    {
      id: 'c4-switchboard',
      name: 'The switchboard',
      chapter: 4,
      at: [96, 114],
      dark: true,
      map: switchboard,
      key: {
        e: exit('c4-museum', 'w'),
        w: exit('c4-hall', 'e'),
        A: door('a'),
        B: shut('b'),
        C: door('c'),
        '1': terminal('t1.talk'),
        '2': terminal('t2.talk'),
        '3': terminal('t3.talk'),
        F: item('frag.4', 'fragment', true),
      },
      enter: [{ if: '', scene: 'c4.switch' }],
      hint: 'First door live, middle door dead, last door live. One and two, I think. Never three.',
    },
    {
      id: 'c4-hall',
      name: "Init's hall",
      chapter: 4,
      at: [112, 126],
      map: hall,
      key: {
        e: exit('c4-switchboard', 'w'),
        w: exit('c4-bridge', 'e'),
        I: npc('init', 'init.talk'),
        K: terminal('c4.adminlog'),
      },
      enter: [{ if: '', scene: 'c4.hall' }],
      hint: "Init's very old. Talk slowly. Or don't, he likes a chat.",
    },
    {
      id: 'c4-bridge',
      name: 'The handshake bridge',
      chapter: 4,
      at: [138, 130],
      map: bridge,
      key: {
        e: exit('c4-hall', 'w'),
        w: exit('c4-gallery', 'e'),
        S: sentry(2, 0, 6, 'k'),
        K: terminal('c4.bridge.term'),
        r: node('a', 60),
        z: ghost('a'),
        '*': sweeper(4, 2.3, 0.5),
      },
      enter: [{ if: '', scene: 'c4.bridge' }],
      hint: 'Watch-clock: I talk it down. Gap: a block, then Float. Bridge: ping, then Cron. Spring: Cron again.',
    },
    {
      id: 'c4-gallery',
      name: 'The gallery',
      chapter: 4,
      at: [162, 122],
      dark: true,
      map: gallery,
      key: {
        e: exit('c4-bridge', 'w'),
        a: lamp('p'),
        K: terminal('c4.gallery.term'),
        B: boss('spoofer'),
      },
      enter: [
        { if: '!beat.spoofer', scene: 'spoofer.meet' },
        { if: '!beat.spoofer', scene: 'spoofer.again' },
      ],
      hint: 'Ping: only the real one answers. Then it stands still, and Sudo shoves.',
    },
  ],
  script,
  talks: [
    { who: 'tel', scene: 'tel.talk1', if: 'with.tel' },
    { who: 'tel', scene: 'tel.lastsession', if: 'q.tel bye.*>=3' },
    { who: 'tel', scene: 'tel.talk2', if: 'chapter>=5' },
  ],
  logs: { 'log.7': "The Admin's note" },
};
