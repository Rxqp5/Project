# Bloomfall: Siege of Hive Tertius

A grimdark, Warhammer 40k–inspired balloon tower defense. Warp-tainted "blooms" pour out of a rift and you deploy Imperial defenders to stop them reaching the hive gate. Pop a bloom and the weaker one inside comes out.

## Play

Open `index.html` in a browser. There's no build step or install; it's plain HTML, CSS and JavaScript.

| Key | Action |
| --- | --- |
| `1`–`7` | Pick a defender to deploy (hold Shift to deploy several) |
| `Space` | Send the next wave |
| `U` / `S` / `T` | Upgrade / sell / change targeting of the selected defender |
| `F` | Cycle game speed (1×, 2×, 3×) |
| `P` | Pause |
| `Esc` / right-click | Cancel |

## Defenders

| Defender | Role |
| --- | --- |
| Guardsman Squad | Cheap lasgun fire |
| Heavy Bolter Team | Fast single-target stream |
| Flamer Sentinel | Short-range cone that hits crowds |
| Mortar Battery | Long-range splash, cracks armour |
| Lascannon Nest | Slow, heavy beam, cracks armour |
| Sanctioned Psyker | Chain lightning, sees veiled blooms |
| Commissar | Doesn't shoot; buffs nearby defenders |

Each defender has four upgrades bought in order.

## Blooms

Cultist → Heretek → Plague → Warpfire → Excess, then the special ones:

- **Void**: immune to explosions
- **Changeling**: immune to fire
- **Ork Iron**: armoured; needs armour-piercing weapons
- **Daemon Engine**: takes 10 hits
- **Warp Titan**: boss on waves 25, 30, 35 and 40
- **Veiled** blooms of any type can only be targeted by Psykers or defenders with an auspex upgrade.

Survive 40 waves to win, then keep going in freeplay.

## Code layout

- `index.html`: page structure
- `style.css`: styling
- `game.js`: everything else. Tune the game through the `TIERS` (blooms), `TOWERS` (defenders and upgrades) and `EARLY_WAVES` / `waveGroups` (wave composition) tables near the top.

In the browser console, `window.bloomfall` exposes the game state for debugging.
