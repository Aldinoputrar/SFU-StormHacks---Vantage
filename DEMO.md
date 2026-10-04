# Vantage: demo script

A three-minute walkthrough for judges, written for the Beyond Euclid challenge. Each beat names the criterion it serves. Before you start, open the game with sound on and the window at least 1280 px wide (the compass hides on narrow screens).

## 0:00 – The hook (title screen)

> "Vantage is Scrabble played on two kinds of impossible space. The board is an Escher-style monument where words only join up from the right viewpoint, and you earn your letters in the hyperbolic plane."

Let the title screen sit for a moment: the monument turns behind it and flashes each time it passes a vantage point.

## 0:20 – Hyperbolic Chamber (*Geometric creativity, Educational value*)

Press **Play**.

> "Three crystals look equally far away and equally big. Only one is truly closest. The floor tiles are all the same size in hyperbolic terms, so the honest way to judge is to count tiles, not pixels."

Pick one. When the dashed geodesics appear:

> "Each dash is half a unit of true distance. The straight lines are arcs, because geodesics in the Poincaré disk meet the rim at right angles."

Round two asks a different question: three paths to a gold crystal.

> "Which one is truly straight? Most people pick the one that looks straight. It's longer: the real straight line bows towards the centre, where space is cheapest."

After the third round the crystals slide to the middle and become a triangle:

> "Its angles add up to less than 180°, and by Gauss–Bonnet the missing angle is exactly its area. We compute that live. Crystal sizes are normalised so the biggest-looking one isn't a giveaway; before that fix it was the answer 100% of the time."

## 1:00 – The monument (*Impossible spaces, UX*)

Collect the letters. Point out the **compass** (bottom right): the orange dot is the camera, the four dots are vantage points.

Drag to orbit and let go near a corner: the camera snaps and the line glows.

> "ABLE is four blocks away on a floating arm, but from this corner the plaza row runs straight into it."

Click the tile just before A and type **T** (or **LOVE** from four tiles back). Press Enter.

> "TABLE spans two surfaces, so it scores twice. Words are checked live against Merriam-Webster's Scrabble dictionary."

Press **Reveal the trick**: the camera swings away and dashed bars show the real gaps.

> "The maths is one fact: an orthographic camera looking along d can't see anything parallel to d, so two strips join exactly when the gap between them is parallel to the view. We solve that for every pair of strip ends at load time, keep the four Monument Valley corners, and ray-march the voxel grid so a hidden end never counts."

If there's time, click a crown tile from the home view: the Penrose crown is an endless 12-tile loop that words can wrap around.

## 2:00 – Hyperbolic Lab (*Interaction & navigation, Educational value, Beyond gaming*)

Open **Hyperbolic Lab**. Press **Walk a square for me**.

> "Four equal sides, four right turns. Here you end up a long way from home: a square can't close in hyperbolic space."

Switch to **Flat** and press it again: the square closes. Switch to **Spherical** and press it again: it misses the other way.

> "Same code, same walk; one number, the curvature, changes. Every formula is written as z ↦ (z − p)/(1 + K p̄ z), so flat, hyperbolic and spherical are just K = 0, −1 and +1."

Click three points far apart:

> "A triangle near the rim has angles adding to almost nothing. It's huge."

Walk a loop with W A S D and come back to the star:

> "I never turned, because every step is a pure translation, yet the north arrow painted at home now points elsewhere. That's holonomy, and the angle equals the area my loop enclosed. Our tests check it against Gauss–Bonnet to six decimal places."

## 2:45 – Close (*Technical execution, Documentation*)

> "Everything's drawn per pixel in a single shader: the {3, 8} tiling by reflection, geodesics by sliding each segment to the centre with a Möbius map. Sound is synthesised, so there are no assets. Seventy-six Node tests cover alignment, rules, the dictionary and the maths in all three geometries. The README explains every formula."

## Questions you might get

- **Is the hyperbolic part only cosmetic?** No. The chamber is won by reasoning about the metric (tile counting, spotting the true geodesic); the lab's square, triangle and holonomy experiments are all computed exactly, not animated, in all three geometries.
- **How is the sphere drawn?** By stereographic projection from the point opposite you: the disk is the hemisphere around you and its rim is your horizon. It's conformal like the Poincaré disk, which is why the same Möbius maps work with one sign flipped.
- **Why orthographic?** Perspective shrinks distant things, which would give the depth away. Orthographic projection drops depth entirely, so adjacency on screen depends only on direction, which is what makes vantage points discrete and findable.
- **Performance?** The monument is about 320 box meshes with shared materials and cached letter textures; the disk is one full-screen shader whose fold loop usually exits within a few steps. Check the frame rate on the demo machine beforehand (Chrome DevTools → Rendering → Frame rendering stats).
- **Why can't you see LOVE on the board at the start?** A hook already complete across the gap (LOVEABLE) can't be extended, since no letter makes ?LOVEABLE a word. Leaving the start empty lets every player build their own bridge.
