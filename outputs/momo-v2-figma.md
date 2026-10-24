# Momo v2 — Figma animation library

Created 2026-10-23. Application source unchanged.

Review board: https://www.figma.com/design/vUeenpSEOc5vVat1vqDwYl/moss-island?node-id=64-2208

64 editable component frames; 8 variants per action. Original mascot preserved.

| Action | Component set ID | Timing |
| --- | --- | --- |
| Idle | 64:2488 | Frame 01 holds 1800 ms, other frames 160 ms |
| Walk | 64:3072 | 125 ms/frame |
| Wave | 64:3660 | 125 ms/frame |
| Dance | 64:4280 | 125 ms/frame |
| Plant | 64:4922 | 125 ms/frame |
| Drink | 64:5566 | 125 ms/frame |
| Sleep | 64:6196 | 250 ms/frame |
| Celebrate | 64:6824 | 125 ms/frame |

Logical canvas: 64×64 transparent. Ground baseline: y=64. Export main components at 1×; use integer display scale and nearest-neighbor filtering. Preserve integer sprite coordinates. Figma variants use after-timeout CHANGE_TO with instant transitions; all eight actions loop for design inspection. Production Plant, Drink, and Celebrate should play once and return to Idle. Production Walk additionally moves the world position.

Validation: 8 sets × 8 frames, 64 timeout reactions, no sprite child outside 64×64 bounds. Atlas screenshot inspected. Prototype playback was wired but not interactively tested. No production code integration performed.

Keep tree rewards tied to completed focus sessions. Record water only after user confirmation. Sleep/Idle artwork supports reduced-motion static states.

## Original identity correction
All 64 frame artworks were replaced with clones of the original Momo poses in component set 6:39. Original palette, facial pixels, sprout, and body proportions retained; only pose selection and small integer pixel movements vary. The original set remains untouched. Atlas screenshot reviewed after correction. Earlier added cheeks, shaded body, headphones and confetti were removed to retain the original character.

