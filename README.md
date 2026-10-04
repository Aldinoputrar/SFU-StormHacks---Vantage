# Vantage

Scrabble, if the board were an impossible object.

## What it is

A single-player word puzzle in two parts. In the **Hyperbolic Chamber** you earn your letters by judging distance in curved space; on the **monument**, an Escher-like structure in the style of Monument Valley, you play them as words along lines that only join up from the right viewpoint. Between turns, the **Hyperbolic Lab** lets you walk the hyperbolic plane freely, compare it with flat space and the sphere, and find out for yourself what curvature does.

| Game | What we took from it |
| --- | --- |
| **Scrabble** | Letter tiles, word building, scoring and bonus squares |
| **Monument Valley** | Impossible architecture, four isometric views, paths that connect when they *look* connected |
| **Superliminal** | Forced perspective: what you see from where you stand is what's real |

## The core idea

The board itself hides opportunities. Two strips of tiles might be far apart in 3D space, but from one viewing angle they line up as a continuous word. ABLE sits on a floating arm, blocks away from the central structure; with LOVE on the base arm, from the right angle it runs on into ABLE as LOVEABLE (or T into TABLE, UN into UNABLE).

An orthographic camera lets surfaces at different depths appear to touch without perspective foreshortening. What counts as adjacent depends on your viewpoint, so finding the right place to look is part of solving the puzzle.

Every face of every block can hold letters: tops, sides and undersides. Each face is a small Scrabble board, and a word can run along one strip and carry on along another. Words read left to right (or top to bottom) as they appear from where you stand.

## Four maps

Choose a map on the title screen. Each has the same rules and its own tricks:

- **The Monument:** a tower, four arms reaching out from its base and the endless crown. LOVE lies on one arm and, from the home view, runs straight into ABLE as LOVEABLE. Hooks …RISE, …STAR, …TION.
- **The Plaza:** the same tower and crown on a 5 × 5 sand plaza, with four floating arms and the swing bridge. Every hook is left open for the player to start: …ABLE (TABLE, UNABLE), …RISE, …STAR, …TION.
- **The Spire:** a thin tower with ledges at four heights and the crown on top. Hooks …IGHT, …OUND, …LESS, …NESS.
- **The Courtyard:** a wide 7 × 7 plaza, the most room for ordinary Scrabble, with eight floating arms, two from each corner. From one corner an arm reads outward and ends a word (…ATE, …ING, …LESS, …OUND); from the other it reads inward and starts one (OVER…, FORE…, BACK…, DOWN…).

The tests check that every map joins lines from all four corners and that every hook reads the right way round.

## The monument

One connected monument: a lavender tower in the middle, a coral Penrose crown resting on the tower, and four mint arms in a pinwheel.

- **Four views, like Monument Valley's rotations.** Vantage points are the four isometric views from above. Each arm's far end is shifted one step along one of those view directions, so each arm only joins the structure, and its words only connect, from one corner. From anywhere else it is a broken bridge.
- **Hook words.** Lines read out along each arm, with starting and ending words: LOVEABLE, SUNRISE, LODESTAR, MOTION.
- **The Penrose crown.** Four strips around a square, each lifted a different amount along the home view (1, 1, 1). From that view the lifts vanish and the strips close into one ring of 12 tiles with no start and no end, so a word can run round a corner and past any point. Orbit away and it opens into a staircase that climbs at three corners yet returns to where it started. One side rests on the tower, so the crown is part of the monument.
- **The swing bridge** (on the Plaza). A blue bridge floats beside the tower. **Swing the bridge** turns it a quarter turn about its first block, for free, carrying any letters on it. In one position, seen from the home view, it runs straight into the crown and its O (TRI-O, ECH-O); in the other, seen from the opposite corner, it runs into TION from a new side (MO-TION). The board is rebuilt after each swing, so its joins and vantage points follow. The spot was found by searching every floating position for one whose two positions each join a different line.
- **Reveal the trick** swings the camera away from a vantage point and back, with dashed bars across every hidden gap.
- **The compass** (bottom right) maps every view direction from above: the centre is straight down, the ring is the horizon, the four dots are the vantage points and the orange dot is you. Click a dot to fly there.

## The Hyperbolic Chamber

Before each turn you earn letters in a short minigame (about 30 seconds) set in the Poincaré disk, a model of the infinite hyperbolic plane drawn inside a circle.

Each visit has two rounds: an **action game** worth up to two stars, then a **quiz** worth one, so a perfect visit earns three. The first visit is always the crystal dash and then the closest-crystal quiz; later visits pick a different action game each time and any quiz.

### Action games

All four run on the same hyperbolic floor ([`src/arcade.js`](src/arcade.js)), and the tests play each one to check it can be won and lost ([`test/arcade.test.js`](test/arcade.test.js)).

- **Crystal dash.** Twenty seconds to walk about (W A S D, or hold the floor) and grab as many crystals as you can. Those near the rim look close and aren't. 8 crystals for two stars, 4 for one.
- **Escape the swarm.** Shadows close in, a little slower than you, for twenty seconds; three hearts. Hyperbolic space opens up so fast that a few steps sideways leave a chaser far behind.
- **Geodesic golf.** Drag back from the ball and let go to putt. The ball rolls along a true straight line, which bows towards the centre on screen; an orange guide shows how its roll begins. In one for two stars, in three for one. In the tests, aiming straight at the hole on screen misses every time; aiming along the geodesic sinks it.
- **Bounce shot.** A barrier blocks the way to the target. The shot follows geodesics and bounces off the round arena wall and the barrier, angle in equalling angle out; a guide line shows the true path, bounces and all.

Moving things step along geodesics: slide the point to the centre, step along the diameter, slide back, and turn the heading by the argument of that map's derivative (`geodesicStep`). A bounce mirrors the heading in the wall's tangent where it hits (`bounce`).

### Quizzes

**Closest crystal:**

- You stand off-centre with three crystals that look about equally far away (within ±8% on screen) and about equally big. Pick the one that is **truly** closest.
- The crystals differ in true size so that they *look* the same size. With equal true sizes the biggest-looking crystal would always be the answer (it sits where space is least stretched), and a round could be won without reading the floor; now it is the answer only about a third of the time.
- The floor is a tiling of triangles, eight at each corner. Every triangle is the same size in hyperbolic terms, so they shrink towards the rim, and counting tiles is a fair way to judge distance. The crystal that looks nearest is never the answer: space near the rim is much bigger than it looks.
- After you choose, dashed geodesics (the hyperbolic "straight lines") show each true distance, one dash per half unit, and you walk to the closest crystal while the world flows past and the others sink towards the rim.

**Find the straight line:**

- Three paths lead to a gold crystal: the true geodesic, the Euclidean straight segment, and an arc bent the wrong way or too far. Pick the one that is truly straight, the shortest way there.
- The segment looks straightest but is longer. In the Poincaré disk geodesics are arcs that would meet the rim at right angles, so they bow towards the centre, where space is least stretched. After you choose, each path is labelled with its true length and you walk the geodesic to the crystal.
- The round starts with the world sliding you out towards the rim, where geodesics bow enough to see.

**Biggest triangle:** three geodesic triangles look about the same size; the one nearest the rim truly holds far more. After you choose, each is labelled with its area, and the answer's angle sum shows where the area went.

**Where will you end up?** You will walk a square: equal sides, right-angle turns. Pick where you land. One choice is back where you started, the flat-world answer, which is never right; then you walk it for real, leaving a trail.

**Scoring and the lesson:**

- Each correct answer improves your letters: every new tile is the best of (correct answers + 1) draws from the bag, favouring vowels when your rack is short of them, then high-scoring letters.
- After the last round the three crystals slide to the middle and become a **geodesic triangle**, labelled with its angles. They always add up to less than 180°, and the shortfall is exactly the triangle's area (Gauss–Bonnet). The floor tiles are triangles too, each with three 45° corners.
- From the second visit on you can skip the chamber for a plain draw.

You visit the chamber at the start, after every word, and after a swap. The rack always holds at most seven tiles.

## The Hyperbolic Lab

A sandbox open from the title screen or between turns, with a switch between three geometries: the **hyperbolic** plane (the default), the **flat** plane and the **sphere**, all drawn the same way and run by the same code with a different curvature. You are always at the centre of the disk and the world slides past you, one pure translation at a time, so you never turn. Try each experiment in each geometry:

| | Flat | Hyperbolic | Spherical |
| --- | --- | --- | --- |
| Floor tiles | triangles with 60° corners, 6 at a point | 45° corners, 8 at a point | 90° corners, 4 at a point: eight tiles cover the world |
| *Walk a square* (1.2 up, right, down, left) | back home | 1.57 from home | 0.87 from home |
| A triangle's angles | always 180° | less: π − sum is its area | more: sum − π is its area |
| A loop back home turns the north arrow | never | by the area enclosed | by the area enclosed, the other way |
| How the map looks | the same everywhere | squeezed towards the rim, infinitely far away | stretched towards the rim, which is your horizon |

- **A square does not close.** *Walk a square for me* walks four equal legs with right-angle turns. Only on the flat plane do you get home. On the hyperbolic plane a closed four-sided figure with equal sides needs corners sharper than 90°; on the sphere, wider.
- **Triangles.** Click three points to drop a triangle; its angles are labelled live, with the sum and the area. Small triangles are almost flat everywhere.
- **Walking a loop turns the world.** A red arrow is painted at home pointing north. Walk any big loop back to the star and the arrow points somewhere else, turned by exactly the area your loop enclosed (holonomy). The lab reads off the angle and the area.
- **The rim never gets closer** on the hyperbolic plane; walk towards it as long as you like.

Controls: <kbd>W A S D</kbd> or arrow keys to walk, hold the floor to walk towards the pointer, click to drop a triangle corner, <kbd>Esc</kbd> to leave.

## How to play

1. **Earn letters** in the Hyperbolic Chamber.
2. **Find a vantage point.** Orbit the monument; release near one of the four isometric views and the camera snaps to it. Lines that join from there glow.
3. **Play a word.** Click a tile to lock the view and choose the line through it, then type or tap letters. A word must use at least one letter already on the board, and every word it makes sideways on the same face must be valid too.
4. **Check and score.** Words are checked with Merriam-Webster's Scrabble dictionary, then scored, and you return to the chamber for new letters.

**Missions.** Each run deals three goals, always including *cross the gap* and two more, such as writing on the endless loop, playing on the swung bridge, landing a word bonus, or winning every chamber round. Each one finished is worth 15 points ([`src/missions.js`](src/missions.js)).

Every word gets a moment: its tiles bounce in turn, flashing gold when it crossed the illusion, the score rises over the monument and counts up in the corner, and big words and missions throw confetti.

**The traveller.** A little figure waits on the plaza. Whenever a word is played, they walk along it tile by tile, on walls and undersides too, always upright to the face beneath them. Crossing the gap between two joined strips they move in a straight line through 3D space; the gap is parallel to the view, so on screen it looks like an ordinary step ([`src/traveller.js`](src/traveller.js)).

**Pass-and-play.** Up to four players share one board on one screen, six turns each. Each keeps their own letters, score and missions; between turns a card asks the next player to take the screen, so letters stay hidden ([`src/players.js`](src/players.js)).

**Online rooms.** *Create a room* on the title screen gives a four-letter code (and an invite link); up to three friends join it from their own devices. There is no game server: the browsers connect to each other directly over WebRTC, through PeerJS, whose public broker only introduces them. Each player takes their turn on their own screen, chamber and all, while the others watch the board and can look around; when a turn ends, the whole game is sent as a snapshot and every other device restores it, so nothing is ever simulated in two places ([`src/online.js`](src/online.js)). The room logic is tested with fake connections, and the snapshot by replaying a turn onto a second game.

**Leaderboard.** The best scores on each map are kept in this browser and shown on the title screen and at the end of every run ([`src/leaderboard.js`](src/leaderboard.js)).

**Hints.** The **Hint** button, three per player per run, finds the best word you can make from the current view with the letters you hold. It tries candidates against the real rules, cross-words included, picks the line for you and puts the cursor where the word starts, so you only have to type it ([`src/hint.js`](src/hint.js)).

Instead of a word you can **Swap** (send your rack back and earn new letters; uses a turn). The run ends when you use your last turn, click **Finish**, or run out of tiles.

## Bonus squares

Bonus squares are coloured as on a Scrabble board: **DL** (light blue, double letter), **TL** (dark blue, triple letter), **DW** (pink, double word) and **TW** (red, triple word). DL is the most common and TW the rarest, in Scrabble's proportions scaled down because every face of every block holds tiles. They count only under newly placed tiles.

Triple words sit only on lines that join others from a vantage point, so finding hidden lines is the way to the biggest scores, and word bonuses avoid tiles that another tile overlaps from a vantage point, so a bonus never looks as if it belongs to the wrong line. The layout comes from the challenge's seed, so every player gets the same board ([`src/bonuses.js`](src/bonuses.js)).

## Scoring

- Standard Scrabble letter values, with letter and word bonuses under new tiles.
- **Merge bonus:** the main word's total is multiplied by the number of surfaces it spans, so a word joined across two strips scores double.
- Words made sideways on the same face score too.
- Using all seven of your tiles in one turn earns **+50**, like in Scrabble.

## Word checking

Words are looked up on [scrabble.merriam.com](https://scrabble.merriam.com/) ([`src/dictionary.js`](src/dictionary.js)). Browsers can't read another site directly, so requests go to `/mw/...` on our own server and are relayed:

- `npm run dev` and `npm run preview`: by Vite's proxy ([`vite.config.js`](vite.config.js)).
- Deployed on Vercel: by [`vercel.json`](vercel.json); on Netlify: by [`public/_redirects`](public/_redirects).

Answers are cached in the browser. If Merriam-Webster can't be reached, or its page doesn't say whether a word is playable, the offline [word-list](https://github.com/sindresorhus/word-list) dictionary (about 274,000 words) decides, and the game says which one it used.

## The alignment maths

An orthographic camera looking along a direction **d** drops the part of every point that lies along **d**. So two points land on the same spot on screen exactly when their difference is parallel to **d**.

Take a strip A whose next tile would sit at **N** (one step past its end, stepping by **a**), and a strip B that starts at **P** and steps by **b**. B continues A on screen when:

- **P − N** is parallel to **d**, so B's first tile appears where A's next tile would be, and
- **a − b** is parallel to **d**, so both strips step the same way and the same distance on screen.

Both differences must point along **d**, which fixes the viewpoint up to sign; the sign is chosen so both faces point at the camera. The game solves this for every pair of strip ends when a level loads ([`src/board.js`](src/board.js)), then:

- keeps only the four isometric views from above, the four rotations of a Monument Valley level; any two parallel strips line up from *some* angle, so this keeps vantage points special,
- ignores strips that touch round a block's edge (no real gap, no illusion) and single tiles (a lone tile lines up with something from almost anywhere),
- drops joins where another block hides either joining end, by stepping rays through the voxel grid from the centre and corners of each tile towards the camera ([`src/geometry.js`](src/geometry.js)); tiles covered further along a line stay part of it,
- snaps the camera to a vantage point when you let go within 10° of it.

Run `npm run vantages` to list every vantage point in a level and the strips that join there.

## The hyperbolic maths

[`src/hyperbolic.js`](src/hyperbolic.js) works in the Poincaré disk with points as complex numbers. Every formula carries a curvature K (−1 hyperbolic by default, 0 flat, +1 spherical), and only its sign changes:

- **Lengths** are ds = 2|dz| / (1 + K|z|²). For K = −1 that is the Poincaré disk; for K = +1 it is a unit sphere seen by stereographic projection, the unit circle being the equator around you; for K = 0 it is the flat plane, scaled by 2.
- **Sliding a point p to the centre** is z ↦ (z − p) / (1 + K p̄ z), an isometry in every geometry. Everything else is built from it.
- **Distance from the centre** to a point drawn at radius r is 2 artanh r, 2r or 2 arctan r. To measure any distance d(p, q), slide p to the centre and measure there. Near the hyperbolic rim artanh blows up, which is why the rim is so far away.
- **Isometries** are Möbius transformations z ↦ (az + b)/(cz + d). The camera is one of them, so walking means composing a hyperbolic translation along the geodesic to the crystal, and the shader maps each pixel back through the inverse.
- **The tiling** is drawn per pixel by reflecting the point into one triangle of a {3, q} tiling, q = 8, 6 or 4, and counting the reflections to two-colour the tiles ([`src/disk.js`](src/disk.js)). Two of the mirrors are straight lines through the centre. The third carries the tile's edge at distance h, where cosh h (hyperbolic) or cos h (spherical) is cos(π/q) / sin(π/p): a circle through the edge's midpoint s and its inverse 1/s on the hyperbolic plane, through s and its antipode −1/s on the sphere, and a straight line on the flat plane.
- **Geodesics** are drawn per pixel too: each segment's start is slid to the centre by a Möbius map, where the geodesic is a straight diameter, so a pixel is on the segment when it lies close to that diameter.
- **Crystal sizes.** A hyperbolic disk of radius ρ centred at Euclidean distance a from the centre is drawn with Euclidean radius b(1 − a²) / (1 − a²b²), where b = tanh(ρ/2). Solving the quadratic e·a²·b² + (1 − a²)·b − e = 0 for b gives the true radius that looks like any chosen size e (`radiusDrawnAs`).
- **Angles** at a corner p are measured by sliding p to the centre: Möbius maps keep angles, and the two geodesics become diameters, so the angle is the ordinary angle between two vectors (`angleAt`). By Gauss–Bonnet a triangle's angles add up to π + K × area, so its area is (sum − π) / K (`triangle`).
- **The straight-line round** draws each path as a circular arc through its ends and a middle point: the geodesic's true midpoint, the Euclidean midpoint, or a decoy. Lengths are summed along 48 short pieces (`arcThrough`, `pathLength`); the tests check the geodesic's points satisfy d(p, z) + d(z, q) = d(p, q).
- **Long walks.** Far from the centre a point's coordinates crowd against the rim (1 − |z| falls like e^−distance), and after a dozen units a graphics card's 32-bit floats cannot tell them apart: the floor turns to noise. So the walker never gets far: whenever they leave the central tile, the whole world is shifted by a symmetry of the tiling (turns about the centre and half turns about an edge's midpoint) that brings them back into it (`recentre`). The floor is unchanged, being symmetric, and everything else is carried along.
- **Walking** in the lab is a pure translation along a diameter, z ↦ (z − s) / (1 + K s̄z) with s a step's length away (`stride`), so the player never rotates. After a closed loop the accumulated map fixes the centre and is a rotation; its angle, the argument of the derivative (ad − bc)/d² at the centre (`turnAtCentre`), equals the enclosed area, with opposite signs on the sphere and the hyperbolic plane, and is zero on the flat plane. The tests check this to within 10⁻⁶ in all three geometries by walking a triangle and comparing with Gauss–Bonnet ([`test/hyperbolic.test.js`](test/hyperbolic.test.js)).

## Why impossible geometry?

The structure takes inspiration from Penrose stairs, Escher's Waterfall and Monument Valley. Its playable connections don't have to match physical connections in 3D space: two tile strips can count as adjacent from one viewpoint and separate from another, and the Penrose crown is a loop with no start. The chamber adds genuinely curved space, where the shortest way is not the one that looks shortest. Each mode removes one assumption we make about space without noticing.

## Stack

- [Three.js](https://threejs.org/) for 3D graphics and the chamber's shader
- [PeerJS](https://peerjs.com/) for online rooms, peer to peer over WebRTC
- The Web Audio API for every sound: soft bells on a pentatonic scale, synthesised in [`src/audio.js`](src/audio.js), so there are no audio files
- Vite for development, builds and the dictionary proxy
- Node's built-in test runner

## Getting started

```bash
npm install
npm run dev
```

Open the printed local URL and press **Play**. You start in the Hyperbolic Chamber; collect your letters, then press **Isometric view** to see LOVE on the base arm run straight into ABLE on its floating arm as LOVEABLE. Or open **Explore the Hyperbolic Lab** and press **Walk a square for me**.

To check words with Merriam-Webster, the server must be able to reach `scrabble.merriam.com`. If it can't (offline, or a network that blocks the site), the game still works with the offline list.

To put it online, deploy to Vercel (`npx vercel`, then `npx vercel --prod`): [`vercel.json`](vercel.json) already relays the dictionary checks, and online rooms need nothing more, since they are peer to peer.

For demos, the address can choose what to show: `?map=plaza`, `?map=spire` or `?map=courtyard` for another map, `?game=golf` (or `dash`, `swarm`, `bounce`) and `?quiz=square` (or `closest`, `straight`, `triangle`) for the chamber's rounds, and `?skip` to offer skipping the chamber from the first visit.

```bash
npm test          # alignment, rules, dictionary, hyperbolic maths and the action games
npm run vantages  # list the vantage points in the level
npm run build     # production build in dist/
```

### Controls

- **Chamber:** click a crystal (or press 1, 2, 3 or A, B, C).
- **Lab:** W A S D or arrow keys to walk, hold the floor to walk towards it, click to drop triangle corners, and switch between hyperbolic, flat and spherical.
- **Drag** to orbit, **scroll** to zoom. Hovering a tile lights the line a click would choose. The game starts in an overhead view; **Overhead view** returns to it and **Isometric view** jumps to the home vantage point. Let go near a vantage point and the camera snaps to it; joined lines glow.
- **Click a tile** to lock the view and pick the line through it. Click the same tile again, or the switch button, to change to the other line through it.
- **Choose your direction.** The heading shows Across, Down or Diagonal before you type. Across is chosen first where lines cross; the switch button names the other direction.
- **Covered squares stay in the line.** Clicks on the board always pick the surface you can see. Squares underneath another block have a dashed mark in the word strip: click them there to type on them. Letters stay on their own block.
- **Typing up to a letter slides back.** Click the tile just before ABLE and type L, O, V, E: each new letter pushes the others back a square, so the word ends at the hook.
- **Type** letters (or tap your rack) to place them along the line, **Backspace** to undo, **Enter** to play, **Esc** to cancel.
- **Reveal the trick** shows the real 3D gaps behind the lines joined at the current vantage point.
- **Swap** sends your letters back for new ones (uses a turn); **Finish** ends the run.

## Where things live

| File | What it does |
| --- | --- |
| [`src/level.js`](src/level.js) | The monument: blocks, colours, hook words, the Penrose crown, letter values |
| [`src/board.js`](src/board.js) | Tiles on every face, lines, joins, vantage points, visibility |
| [`src/game.js`](src/game.js) | Rules: rack, placing, connecting, cross-words, scoring, swap, end of run |
| [`src/bonuses.js`](src/bonuses.js) | Where the DL / TL / DW / TW squares go |
| [`src/dictionary.js`](src/dictionary.js) | Merriam-Webster lookups with the offline fallback |
| [`src/hyperbolic.js`](src/hyperbolic.js) | Disk maths for curvature −1, 0 and +1: distance, Möbius maps, triangles, walking, chamber rounds |
| [`src/disk.js`](src/disk.js) | The shared disk renderer: tiling, geodesics and markers in one shader, for all three geometries |
| [`src/chamber.js`](src/chamber.js) | The Hyperbolic Chamber screen |
| [`src/lab.js`](src/lab.js) | The Hyperbolic Lab: free walking, triangles, the square walk and holonomy, in three geometries |
| [`src/audio.js`](src/audio.js) | Synthesised sound |
| [`src/arcade.js`](src/arcade.js) | The chamber's action games: dash, swarm, golf and bounce |
| [`src/hint.js`](src/hint.js) | Finding a word the player can make on a line |
| [`src/missions.js`](src/missions.js) | The three goals of each run |
| [`src/traveller.js`](src/traveller.js) | The little figure who walks every word |
| [`src/players.js`](src/players.js) | Pass-and-play: seats, turns and standings |
| [`src/online.js`](src/online.js) | Online rooms: peer-to-peer hosting, joining and relaying turns |
| [`src/leaderboard.js`](src/leaderboard.js) | Best scores, kept in the browser |
| [`src/confetti.js`](src/confetti.js) | Confetti for big moments |
| [`src/scene.js`](src/scene.js) | Drawing the monument and its tiles |
| [`src/placement.js`](src/placement.js) | Which line a click picks first, and its direction on screen (Across, Down, Diagonal) |
| [`src/hud.js`](src/hud.js), [`src/style.css`](src/style.css), [`index.html`](index.html) | The interface |
| [`src/main.js`](src/main.js) | Ties it together: camera, modes, input |

## Roadmap

- [x] One connected monument with four vantage points
- [x] Highlighting lines that line up on screen
- [x] Letters on every face of every block
- [x] Locking the view and placing tiles
- [x] Penrose crown that words can wrap around
- [x] Reveal mode that shows the real gaps behind joined lines
- [x] Checking words with Merriam-Webster and scoring
- [x] Bonus squares (DL, TL, DW, TW)
- [x] Hyperbolic Chamber minigame that earns letters
- [x] Title screen, first-turn guidance and end screen
- [x] Sound
- [x] Hyperbolic Lab: free walking, triangles and holonomy
- [x] Flat and spherical geometry in the lab, for comparison
- [x] A straight-line round in the chamber
- [x] A swing bridge that changes which lines join
- [x] Missions, and celebrations for every word
- [x] Compass of vantage points
- [x] Four maps
- [x] Hints, and typing that slides back to end at a hook
- [x] Four action games and four quizzes in the chamber
- [x] A traveller who walks every word
- [x] Pass-and-play for up to four
- [x] A local leaderboard
- [x] Online rooms for up to four, peer to peer
- [ ] An online leaderboard
