import type { Part } from '../content';
import { boss, door, exit, item, mark, node, npc, plate, sign, trigger } from '../world';

const gateYard = `
########n#########
#L%.....D.....&###
#####.p.:.p.######
#####...:...######
#####..o:o..O.####
#&"""...:...."O..#
#.......:...x..+.#
########s#########`;

const jail = `
######n#########
#&....%.......&#
#.r..........q.#
#..............#
#....######....#
#....#....#....#
#....#.S..#....#
#....#.f..#....#
#....##D###....#
#..............#
#......u.......#
#+.............#
#######s########`;

const yards = `
#################n##
#&..........#....D.#
#...........#..p...#
#...........#......#
#...........%......#
#.....O.....#......#
#           #......#
#           #......#
#.....O..O..#..O...#
#...........#......#
#+..........#....L.#
#...........########
###s################`;

const office = `
##########n###########
#&.......#D#.......&.#
#...............Sw...#
#..O.................#
#.....>>>> >>>p#.....#
#..O.................#
#....................#
#+...................#
#########s############`;

const heap = `
################
#&............&#
#..O.......O...#
#..............#
#......B.......#
#.O..........O.#
#..............#
#...O......O...#
#..............#
#&............&#
#######s########`;

const script = String.raw`
@c2.arrive
: The Stacks. Cabinets as tall as towns, drawers that go back for miles. Everything here belongs to root.
cron: It's very... tidy. Too tidy. Like nobody's opened anything in years.
: A notice on the gate: PERMISSION DENIED.
cron: The door wants weight on both plates. Those crates are ours to push. The big blocks aren't: they're root's.
~ +c2.arrived

@c2.gate.sign
: STACKS, NORTH YARD. ROOT-OWNED. ALL OTHERS: PERMISSION DENIED.

@c2.jail
: In the middle of the yard, a cell. Somebody built it carefully, from the inside.
: In the cell, something big sits with its back to the bars.
sudo: Whoever you are, go away. This is a chroot. I'm in it on purpose.
cron: Sudo? Sudo, it's Cron. From the Crontab. I set your log rotation once!
sudo: Hello, Cron. Go away, Cron.
> Gran sent us. -> gran
> Why lock yourself up? -> why
#gran
sudo: Gateway. Course she did. Tell her I'm fine. Tell her I'm staying.
-> lock
#why
sudo: Because I've got root, and root breaks things. I broke enough.
#lock
sudo: The cell takes three relays lit at once to open. Corners, and the middle. I made sure nobody could do it alone.
sudo: So you can't. Go home.
cron: She said "alone". She keeps saying "alone".
cron: Echo, I can hold time still. Light one, light another, and I'll stop the first one going out while you get to the third.

@sudo.free
: The cell door grinds open. Sudo turns round. She's bigger than the cell looked.
sudo: You did it. Huh. Nobody's done that.
sudo: What do you want with me? Truthfully.
> We need you. -> need ~ sudo+1
> The network needs someone with root. -> root
> Stay, if staying's what you want. -> choice ~ sudo+2
> Cron's scared of the dark. Come for him. -> joke ~ sudo+1 cron+1
#need
sudo: Need. Nobody's needed me since... since.
-> join
#root
sudo: The network's had about enough of what root does, kid.
sudo: ...But fine. Someone's got to do the heavy lifting.
-> join
#choice
sudo: ...
sudo: You're the first one to give me the choice. Everybody else just wanted my permissions.
sudo: I'll come. Because you asked like that.
-> join
#joke
cron: I am NOT. I'm scared of being LATE in the dark. It's different.
sudo: Ha. All right. All right. For the clock.
#join
~ join:sudo +sudo.joined
: Sudo steps out of the chroot. The floor creaks.
sudo: I break things: cracked walls, root's blocks, anything in my way. Walk at something and shove, and it moves. Put me in front and press A, and I'll shove whatever's ahead.
sudo: That wall up north's been cracked since I put my fist through it. Let's go.

@c2.yards
sudo: The inode yards. Root's blocks everywhere. Heavy ones.
sudo: There's a trench across the middle. Blocks fall in, blocks fill it. One block, one hole.
sudo: Plate past the wall on the right opens the way on. It'll want a block on it, and the wall's cracked. Guess whose job that is.

@c2.office
cron: An office! With desks! And a conveyor that goes into... nothing.
sudo: The shredder. Put a block on the belt and it carries it right along to the plate. Except the gap in the middle eats the first one.
sudo: So feed it two.

@c2.signature
: A notice, nailed to the wall. ROUTE TO NODE 0: NULL. BY ORDER.
: Under it, a signature in very heavy strokes.
sudo: ...
cron: Sudo? Do you know whose that is?
sudo: No. Nobody's. Keep moving.
~ +c2.sudo.hint
? sudo>=4 -> soft
-> end
#soft
sudo: ...Later. I'll tell you later. Not here.

@swap.talk
? letter.swap -> after
swap: Oh! Visitors. Sorry, I'm in two minds. Literally. Half of me's paged out to disk.
swap: When things got full, they started putting bits of everybody in me. I've got four towns' worth of memories I don't own.
-> end
#after
swap: I read your letter both ways. Both halves agree: it was lovely.

@swap.letter
swap: A letter? For me? Which half?
: Swap opens it with both hands, one at a time.
swap: It's from the Buffer. From the dropped ones. They say thank you for keeping what they couldn't hold.
swap: Nobody ever thanks swap. They just want their pages back.
~ -carry.swap +letter.swap sudo+1
sudo: Good of you. Delivering things. Not much of that left.

@oom.meet
: The heap. A great empty yard full of root's blocks, and in the middle, a hooded shape the colour of a crash.
oom: Out of memory. Out of memory. Something must go.
oom: The largest process is chosen. Hello, Sudo.
sudo: Stay behind me, both of you.
oom: The Watchdog sends regards. It remembers you.
sudo: Shut up.
> What does it mean? -> what
> Sudo, are you all right? -> worry ~ sudo+1
#worry
sudo: Fine. Later. Now: watch it. It dashes in straight lines.
-> plan
#what
sudo: Nothing. Later. Now: watch it.
#plan
sudo: It runs at you in a straight line and doesn't stop till it hits something. If that something is one of root's blocks, it's stunned. Then I hit it.
sudo: Push blocks into its path. Cron can hold it still if it's coming too fast.
~ boss

@oom.again
oom: Something must go.
sudo: Not today. Blocks in its line, then I shove.
~ boss -seen.oom.again

@oom.down
: The OOM Killer folds in on itself, freeing everything it held. The heap feels lighter.
oom: Memory... freed. It was never about the largest process. It was about him.
oom: He's afraid, Sudo. Since your order. He's never stopped being afraid.
: It's gone.
cron: "Since your order." Sudo, what order?
sudo: ...
sudo: Not now. Get the kid home.
> Sudo, you can tell us. -> tell ~ sudo+1
> All right. Home. -> home
#tell
sudo: I know. I will. Just not in this yard. Please.
#home
~ goto:gran:@ face:down

@sudo.talk1
sudo: Why'd you get me out? Really.
> Because you were alone. -> alone ~ sudo+1
> Because we needed your strength. -> strength
> Because you wanted out. You just didn't know it. -> knew ~ sudo+1
#alone
sudo: Lots of things are alone. You can't open every cell.
sudo: ...But you opened mine. Fine. Thanks.
-> end
#strength
sudo: Course. That's all anyone wants. Fair enough. I'm strong. Point me at things.
-> end
#knew
sudo: Hmph. Cheeky. Maybe.

@sudo.talk2
sudo: About what I told you. On the water.
sudo: I keep waiting for you to stop walking next to me.
> I'm not going anywhere. -> stay ~ sudo+1
> You made a mistake. You're fixing it. -> fix ~ sudo+1
#stay
sudo: Kid, you're a ping. Going places is all you do.
sudo: ...But not away. Got it.
-> ask
#fix
sudo: Fixing. Yeah. Never been good at that. Breaking, I'm good at.
#ask
? sudo>=5 -> quest
-> end
#quest
sudo: There's something I want to know. The Admin's last orders. The whole thing, not the bit I carried out.
sudo: If there's a copy anywhere, it'll be in the old Ports. In Init's hall, with the oldest logs.
sudo: If we go there... will you help me find it?
> Yes. -> yes ~ +q.sudo sudo+1
> If you're sure you want to know. -> sure ~ +q.sudo
#yes
sudo: Good. Thanks.
-> end
#sure
sudo: I'm not. That's why I want to.

@sudo.talk3
sudo: If this goes bad at the end, the Watchdog, I'll do it. I've got root. One command and it stops.
sudo: kill -9. No questions. It can't even catch it.
> Let's try talking first. -> talk ~ sudo+1
> If we have to. -> have
#talk
sudo: Talking. You and your talking.
sudo: ...All right. Talking first. I'll keep my hand on the switch.
-> end
#have
sudo: We might. Better me than you. I've done worse.

@sudo.idle
? chapter>=5 -> c5
? chapter>=4 -> c4
? chapter>=3 -> c3
sudo: Keep walking. I'm right behind you. Usually blocking something.
-> end
#c3
sudo: I don't like water. Water can't be shoved.
-> end
#c4
sudo: Tel keeps reading my face out loud. I don't have a face. She reads it anyway.
-> end
#c5
sudo: I'm here. Whatever it takes.

@sudo.orders
: The Admin's last log, in full, read aloud by Tel because she can't help it.
tel: "To Sudo. Infection suspected on route 0. Contain it. Isolate route 0 until it can be checked. Do not cut it. Do not cut anything. We'll look at it in the morning."
tel: "...Admin." And that's the end, dear. There wasn't a morning.
sudo: Contain. Not cut. "Do not cut anything."
sudo: I did contain it. I put route 0 behind a null route, till morning. Like it said.
sudo: Then the Admin never came back. And the Watchdog saw my null route and thought: that's how you keep things safe.
sudo: It learned it from me. It's been copying me ever since. Every route it's closed.
> It copied you. It's not yours. -> notyours ~ sudo+2
> Then you can show it how to undo it. -> undo ~ sudo+2
#notyours
sudo: ...Maybe. Maybe it isn't.
-> done
#undo
sudo: Show it. Huh. Never shown anybody anything but the door.
#done
~ +sudo.orders

@sudo.ordersdone
sudo: I've been thinking about the orders. "Do not cut anything."
sudo: I'm going to carry that round instead. Instead of the other thing.
~ +q.sudo.done sudo+1

@log.4
: LOG. "After the Worm he asked for more power. To close a route before harm could travel on it. The Admin said yes. I said nothing. I should have said something. — GW"

@log.5
: LOG. "Told him a network nobody can reach can't be hurt, but it isn't a network either. He said I was the one who let the Worm in. I said he was the one who let me down. We stopped talking. — GW"
`;

export const PART: Part = {
  areas: [
    {
      id: 'c2-gate',
      name: 'The north yard',
      chapter: 2,
      at: [128, 50],
      travel: 'x',
      map: gateYard,
      key: {
        s: exit('loopback', 'N'),
        n: exit('c2-jail', 's'),
        D: door('a'),
        p: plate('a'),
        x: mark(),
        L: item('log.4', 'log'),
        '&': sign('c2.gate.sign'),
      },
      signals: { a: { latch: 'c2.gate.open' } },
      enter: [{ if: '', scene: 'c2.arrive' }],
      hint: 'A crate on each plate, dear. Push from behind, and mind the corners: a crate in a corner stays there.',
    },
    {
      id: 'c2-jail',
      name: 'The chroot',
      chapter: 2,
      at: [116, 38],
      map: jail,
      key: {
        s: exit('c2-gate', 'n'),
        n: exit('c2-yards', 's'),
        r: node('b', 180),
        q: node('b', 180),
        u: node('b', 180),
        D: door('b'),
        S: npc('sudo', 'sudo.idle', '!with.sudo'),
        f: trigger('sudo.free', 'c2.cell.open !with.sudo'),
      },
      signals: { b: { latch: 'c2.cell.open' } },
      enter: [{ if: '', scene: 'c2.jail' }],
      hint: 'Three relays, all at once. Light two, then ask Cron to hold them while you reach the third.',
    },
    {
      id: 'c2-yards',
      name: 'The inode yards',
      chapter: 2,
      at: [132, 26],
      map: yards,
      key: {
        s: exit('c2-jail', 'n'),
        n: exit('c2-office', 's'),
        D: door('a'),
        p: plate('a'),
        L: item('log.5', 'log'),
      },
      signals: { a: { latch: 'c2.yards.open' } },
      enter: [{ if: '', scene: 'c2.yards' }],
      hint: 'Two blocks fill the trench in one column. The third goes up, through the cracked wall, and onto the plate.',
    },
    {
      id: 'c2-office',
      name: 'The shredding office',
      chapter: 2,
      at: [114, 14],
      map: office,
      key: {
        s: exit('c2-yards', 'n'),
        n: exit('c2-arena', 's'),
        D: door('a'),
        p: plate('a'),
        S: npc('swap', [
          ['carry.swap', 'swap.letter'],
          ['', 'swap.talk'],
        ]),
        w: sign('c2.signature'),
      },
      signals: { a: { latch: 'c2.office.open' } },
      enter: [{ if: '', scene: 'c2.office' }],
      hint: 'The belt carries a block to the plate. The gap eats the first. Feed it twice.',
    },
    {
      id: 'c2-arena',
      name: 'The heap',
      chapter: 2,
      at: [138, 8],
      map: heap,
      key: {
        s: exit('c2-office', 'n'),
        B: boss('oom'),
      },
      enter: [
        { if: '!beat.oom', scene: 'oom.meet' },
        { if: '!beat.oom', scene: 'oom.again' },
      ],
      hint: 'Stand so a block is between you and it. When it hits the block, Sudo shoves.',
    },
  ],
  script,
  talks: [
    { who: 'sudo', scene: 'sudo.talk1', if: 'with.sudo' },
    { who: 'sudo', scene: 'sudo.talk2', if: 'c3.confess' },
    { who: 'sudo', scene: 'sudo.ordersdone', if: 'sudo.orders' },
    { who: 'sudo', scene: 'sudo.talk3', if: 'chapter>=5' },
  ],
  logs: { 'log.4': 'After the Worm', 'log.5': 'Argument' },
};
