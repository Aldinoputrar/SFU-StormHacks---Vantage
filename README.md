# Vantage

Scrabble, if the board were an impossible object.

## What it is

A single-player word puzzle in two parts. In the **Hyperbolic Chamber** you earn your letters by judging distance in curved space; on the **monument**, an Escher-like structure in the style of Monument Valley, you play them as words along lines that only join up from the right viewpoint.

| Game | What we took from it |
| --- | --- |
| **Scrabble** | Letter tiles, word building, scoring and bonus squares |
| **Monument Valley** | Impossible architecture, four isometric views, paths that connect when they *look* connected |
| **Superliminal** | Forced perspective: what you see from where you stand is what's real |

## The core idea

The board itself hides opportunities. Two strips of tiles might be far apart in 3D space, but from one viewing angle they line up as a continuous word. LOVE on the plaza and ABLE on a floating arm become LOVEABLE, but only if you find the angle.

An orthographic camera lets surfaces at different depths appear to touch without perspective foreshortening. What counts as adjacent depends on your viewpoint, so finding the right place to look is part of solving the puzzle.

Every face of every block can hold letters: tops, sides and undersides. Each face is a small Scrabble board, and a word can run along one strip and carry on along another. Words read left to right (or top to bottom) as they appear from where you stand.

## The monument

One connected monument: a sand plaza (a 5×5 Scrabble board on top), a lavender tower in the middle, a coral Penrose crown resting on the tower, and four mint arms in a pinwheel.

- **Four views, like Monument Valley's rotations.** Vantage points are the four isometric views from above. Each arm's far end is shifted one step along one of those view directions, so each arm only joins the plaza, and its words only connect, from one corner. From anywhere else it is a broken bridge.
- **Hook words.** Lines read from the plaza out along each arm, and the far ends invite words that finish there: LOVE…ABLE, …RISE (SUNRISE), …STAR, …TION.
- **The Penrose crown.** Four strips around a square, each lifted a different amount along the home view (1, 1, 1). From that view the lifts vanish and the strips close into one ring of 12 tiles with no start and no end, so a word can run round a corner and past any point. Orbit away and it opens into a staircase that climbs at three corners yet returns to where it started. One side rests on the tower, so the crown is part of the monument.
- **Reveal the trick** swings the camera away from a vantage point and back, with dashed lines across every hidden gap.

## The Hyperbolic Chamber

Before each turn you earn letters in a short minigame (about 30 seconds) set in the Poincaré disk, a model of the infinite hyperbolic plane drawn inside a circle.

- You stand off-centre with three crystals that look about equally far away (within ±8% on screen). Pick the one that is **truly** closest.
- The floor is a tiling of triangles, eight at each corner. Every triangle is the same size in hyperbolic terms, so they shrink towards the rim, and counting tiles is a fair way to judge distance. The crystal that looks nearest is never the answer: space near the rim is much bigger than it looks.
- After you choose, dashed geodesics (the hyperbolic "straight lines") show each true distance, one dash per half unit, and you walk to the closest crystal while the world flows past and the others sink towards the rim.
- Three rounds per visit. Each correct answer improves your letters: every new tile is the best of (correct answers + 1) draws from the bag, favouring vowels when your rack is short of them, then high-scoring letters.

You visit the chamber at the start, after every word, and after a swap. The rack always holds at most seven tiles.

## How to play

1. **Earn letters** in the Hyperbolic Chamber.
2. **Find a vantage point.** Orbit the monument; release near one of the four isometric views and the camera snaps to it. Lines that join from there glow.
3. **Play a word.** Click a tile to lock the view and choose the line through it, then type or tap letters. A word must use at least one letter already on the board, and every word it makes sideways on the same face must be valid too.
4. **Check and score.** Words are checked with Merriam-Webster's Scrabble dictionary, then scored, and you return to the chamber for new letters.

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

[`src/hyperbolic.js`](src/hyperbolic.js) works in the Poincaré disk with points as complex numbers:

- **Distance:** d(p, q) = arcosh(1 + 2|p − q|² / ((1 − |p|²)(1 − |q|²))). Near the rim the denominator vanishes, which is why the rim is so far away.
- **Isometries** are Möbius transformations z ↦ (az + b)/(cz + d). The camera is one of them, so walking means composing a hyperbolic translation along the geodesic to the crystal, and the shader maps each pixel back through the inverse.
- **The tiling** is drawn per pixel by reflecting the point into one triangle of a {3, 8} tiling (two straight mirrors and one circle orthogonal to the rim, found from cosh(centre to edge) = cos(π/q) / sin(π/p)); the parity of the reflections two-colours the tiles ([`src/chamber.js`](src/chamber.js)).

## Why impossible geometry?

The structure takes inspiration from Penrose stairs, Escher's Waterfall and Monument Valley. Its playable connections don't have to match physical connections in 3D space: two tile strips can count as adjacent from one viewpoint and separate from another, and the Penrose crown is a loop with no start. The chamber adds genuinely curved space, where the shortest way is not the one that looks shortest. Each mode removes one assumption we make about space without noticing.

## Stack

- [Three.js](https://threejs.org/) for 3D graphics and the chamber's shader
- Vite for development, builds and the dictionary proxy
- Node's built-in test runner

## Getting started

```bash
npm install
npm run dev
```

Open the printed local URL. You start in the Hyperbolic Chamber; collect your letters, then press **Isometric view** to see LOVE and ABLE line up as LOVEABLE.

To check words with Merriam-Webster, the server must be able to reach `scrabble.merriam.com`. If it can't (offline, or a network that blocks the site), the game still works with the offline list.

```bash
npm test          # alignment, rules, dictionary and hyperbolic maths
npm run vantages  # list the vantage points in the level
npm run build     # production build in dist/
```

### Controls

- **Chamber:** click a crystal (or press 1, 2, 3 or A, B, C).
- **Drag** to orbit, **scroll** to zoom. The game starts in an overhead view; **Overhead view** returns to it and **Isometric view** jumps to the home vantage point. Let go near a vantage point and the camera snaps to it; joined lines glow.
- **Click a tile** to lock the view and pick the line through it. Click the same tile again, or the switch button, to change to the other line through it.
- **Choose your direction.** The heading shows Across, Down or Diagonal before you type. Across is chosen first where lines cross; the switch button names the other direction.
- **Covered squares stay in the line.** Clicks on the board always pick the surface you can see. Squares underneath another block have a dashed mark in the word strip: click them there to type on them. Letters stay on their own block.
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
| [`src/hyperbolic.js`](src/hyperbolic.js) | Poincaré disk maths and chamber rounds |
| [`src/chamber.js`](src/chamber.js) | The Hyperbolic Chamber screen |
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
- [ ] Title screen, tutorial and end screen
- [ ] Sound
- [ ] Leaderboard
