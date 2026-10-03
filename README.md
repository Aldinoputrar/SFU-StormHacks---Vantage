# Vantage

Scrabble, if the board were an impossible object.

## What it is

A single-player word puzzle played on a floating, Escher-like 3D structure. Explore different viewpoints, connect seemingly separate tile strips, and uncover hidden multipliers to build the highest score you can. Every player plays their own run and competes on a shared global leaderboard.

| Game | What we took from it |
| --- | --- |
| **Scrabble** | Letter tiles, word building, scoring and bonus squares |
| **Monument Valley** | Impossible geometry: paths connect when they *look* connected |
| **Superliminal** | Forced perspective: what you see from where you stand is what's real |

## The core idea

The board itself hides opportunities. Two strips of tiles on separate surfaces might be far apart in 3D space, but from one viewing angle they line up as a continuous word. LOVE on one platform and ABLE on another become LOVEABLE, but only if you find the angle.

An orthographic camera lets surfaces at different depths appear to touch without perspective foreshortening. What counts as adjacent depends on your viewpoint, so finding the right place to look is part of solving the puzzle.

Every face of every block can hold letters: tops, sides and undersides. Each face is a small Scrabble board, and a word can run along the top of one ledge and carry on along the side of another. Words read left to right (or top to bottom) as they appear from where you stand.

## Impossible loops

The Penrose stairs are four strips set around a square, each lifted a different amount along the isometric direction (1, 1, 1). From the isometric viewpoint those lifts vanish and the strips close into one ring of 16 tiles with no start and no end, so a word can run around a corner and past any point. Orbit away and the ring opens into a staircase: walk it one way and you climb a floor at three corners, yet still arrive back where you started.

**Reveal the trick** swings the camera away from a vantage point and back, with dashed lines across every hidden gap, so you can see how far apart the joined strips really are.

## How to play

Start a solo run with a rack of seven letters and a fixed turn budget. Aim for the highest total score before your turns run out.

Orbit the structure freely. Moving the camera costs nothing, and the game highlights tile strips that line up from your current viewpoint. On each turn, take **one** action:

1. **Play a word.**
   - Find an aligned line and lock your view.
   - Place letters from your rack to form a valid word along that line.
   - Score the play and refill your rack from the remaining tile supply.
2. **Reshape the structure.**
   - Rotate one movable part, such as a ring or platform.
   - This changes the geometry and creates new lines to play on.
   - It spends a turn without scoring: invest in a bigger word later, or use a line you can already see.

Your run ends when you use your last turn or choose to finish early. Your final score can then be submitted to the global leaderboard. Replay to discover better angles and improve your personal best.

## Hidden bonus squares

Some double and triple bonus markers are painted across several surfaces, like anamorphic street art.

- From most angles, a marker looks like scattered coloured shapes.
- From the right spot, the fragments resolve into a readable bonus, such as **3x WORD**.
- You earn the bonus only when your word uses that square from the viewpoint that reveals it.

Exploration is free, so take time to look for opportunities before spending a turn.

## Scoring

- Standard Scrabble letter values and letter/word multipliers.
- **Merge bonus:** a word's letter total is multiplied by the number of surfaces it spans, so a word joined across two strips scores double.
- Words are checked against the [word-list](https://github.com/sindresorhus/word-list) English dictionary (about 274,000 words).
- **Hidden bonuses** only count when played from the angle that reveals them.
- Using all seven of your tiles in one turn earns **+50**, like in Scrabble.
- Your final run score is the sum of your scoring plays.

## Global leaderboard

Everyone competes asynchronously: play on your own, then see how your score ranks against everyone else who has played the same challenge.

- **Shared ranked challenge:** all players start with the same structure, tile sequence, turn limit and scoring rules, so scores are comparable. A different challenge or ruleset has its own leaderboard.
- **One best score per player:** a higher completed score replaces your previous best for that challenge.
- **Worldwide standings:** show each player's rank, display name and best score. Equal scores share a rank.
- **Personal progress:** show your latest run score alongside your personal best and global rank.
- **Validated submissions:** the server checks a completed run's moves and calculates its score before accepting it into shared, persistent storage.

## Why impossible geometry?

The structure takes inspiration from Penrose stairs and Escher's Waterfall. Its playable connections don't have to match physical connections in 3D space: two tile strips can count as adjacent from one viewpoint and separate from another.

The challenge is to discover those connections and use a limited number of turns well. Your camera is a puzzle-solving tool, and your competition is the best scores other players have found.

## How it will work

- **Finding lines:** check where the ends of nearby tile strips appear on screen. If two strips meet on screen and point the same way within a tolerance, they count as one line from that viewpoint. See [the alignment maths](#the-alignment-maths) below.
- **Locking your view:** save the camera position for each play and validate the word against that exact view.
- **Hidden bonuses:** give each bonus a designed viewing spot; reveal it when the camera is close enough to that spot and angle.
- **Word checking:** validate words against a standard English word list.
- **Ranked runs:** record the challenge, camera views, tile placements and structure rotations so the server can validate the run using the same rules.
- **Leaderboard storage:** store player identities and verified best scores in a shared database so rankings include players across browsers and devices.

## The alignment maths

An orthographic camera looking along a direction **d** drops the part of every point that lies along **d**. So two points land on the same spot on screen exactly when their difference is parallel to **d**.

Take a strip A whose next tile would sit at **N** (one step past its end, stepping by **a**), and a strip B that starts at **P** and steps by **b**. B continues A on screen when:

- **P − N** is parallel to **d**, so B's first tile appears where A's next tile would be, and
- **a − b** is parallel to **d**, so both strips step the same way and the same distance on screen.

Both differences must point along **d**, which fixes the viewpoint up to sign; the sign is chosen so both faces point at the camera. The game solves this for every pair of strip ends when a level loads ([`src/board.js`](src/board.js)), then:

- keeps only the cube's 26 symmetry directions (towards its faces, edges and corners), like Monument Valley's fixed views; any two parallel strips line up from *some* angle, so this keeps vantage points special,
- drops joins where another block hides a tile, by stepping a ray through the voxel grid from each tile towards the camera ([`src/geometry.js`](src/geometry.js)),
- snaps the camera to a vantage point when you let go within 10° of it.

Run `npm run vantages` to list every vantage point in a level and the strips that join there.

## Planned stack

- [Three.js](https://threejs.org/) for 3D graphics in the browser
- Node.js for the challenge, run-validation and leaderboard API
- A shared database for persistent leaderboard scores
- Vite for development and builds

## Getting started

```bash
npm install
npm run dev
```

Open the printed local URL, orbit around the structure, then press **Isometric view** to see LOVE and ABLE line up as LOVEABLE.

```bash
npm test          # alignment maths and placement rules
npm run vantages  # list the vantage points in the level
```

### Controls

- **Drag** to orbit, **scroll** to zoom. Let go near a vantage point and the camera snaps to it; joined lines glow.
- **Click a tile** to lock the view and pick the line through it. Click the same tile again to switch to the other line through it.
- **Type** letters (or tap your rack) to place them along the line, **Backspace** to undo, **Enter** to play, **Esc** to cancel.
- **Reveal the trick** shows the real 3D gaps behind the lines joined at the current vantage point.

## Roadmap

- [x] A starting structure: a "broken cube" of floating blocks
- [ ] Walking and looking around in first person
- [x] Highlighting lines that are lined up on screen
- [x] Letters on every face of every block
- [x] Locking the view and placing tiles
- [x] Penrose-stairs loop that words can wrap around
- [x] Reveal mode that shows the real gaps behind joined lines
- [x] Checking words and scoring
- [ ] Rotating parts of the structure
- [ ] Hidden bonus squares
- [ ] More structures: an Escher-style tower, and a small planet with words that curve over the horizon
