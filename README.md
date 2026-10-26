# Bloomfall: Siege of Hive Tertius

A grimdark, Warhammer 40k–inspired tower defense. A Tyranid hive fleet pours out of a spawning pool and across the sky toward the hive gate, and you deploy Space Marine units to hold it.

## Play

Open `index.html` in a browser. There's no build step or install; it's plain HTML, CSS and JavaScript.

| Key | Action |
| --- | --- |
| `1`–`9` | Pick a unit to deploy (hold Shift to deploy several) |
| `Space` | Send the next wave |
| `U` | Buy the selected unit's shared upgrade |
| `Z` / `X` | Buy the next rank in the left / right doctrine |
| `S` / `T` | Sell / change targeting of the selected unit |
| `F` | Cycle game speed (1×, 2×, 3×) |
| `P` | Pause |
| `Esc` / right-click | Cancel |

Pick your chapter colours (Ultramarines, Blood Angels, Dark Angels, Imperial Fists, Space Wolves, Black Templars) from the menu under the board.

## Space Marines

Every unit has a skill tree: one shared upgrade, then two doctrines of three ranks. Choosing a doctrine locks the other.

| Unit | Role | Doctrines |
| --- | --- | --- |
| Scout Squad | Cheap skirmishers | Sniper / Close Quarters |
| Tactical Squad | Bolter line troops | Bolter Drill / Heavy Weapons (flamer, missile launcher) |
| Devastator Squad | Heavy bolters | Heavy Bolters / Missile Launchers (flakk anti-air) |
| Assault Squad | Jump-pack melee that leaps onto the swarm | Vanguard Veterans (claws, thunder hammers) / Death from Above |
| Hellblaster Squad | Plasma, high AP | Supercharge / Assault Plasma |
| Librarian | Chain lightning; ignores armour, sees camouflage | Smite / Telepathy (slow, Null Zone, Vortex of Doom) |
| Whirlwind | Long-range missile artillery, ground only | Vengeance / Castellan (burning ground) |
| Redemptor Dreadnought | Fist smashes monsters, gatling for the rest | Firepower (Icarus pod, macro plasma) / Close Assault (heavy flamer) |
| Chaplain | Litany aura that buffs nearby marines | Litanies / Spiritual Leader |

## The swarm

- **Swarm:** Ripper Swarms, Termagants, Hormagaunts
- **Fliers:** Gargoyles and Harpies take a shorter lane across the sky. Whirlwinds and Dreadnought fists can't hit them.
- **Elites:** Genestealers (very fast), Tyranid Warriors (synapse), Lictors (camouflaged), Zoanthropes (warp field halves non-psychic damage)
- **Monsters:** Carnifex (armour 3), Tervigon (spawns Termagants)
- **Bosses:** Hive Tyrant on waves 20, 30 and 35; the Hierophant Bio-Titan on wave 40

Rules:

- **Armour vs AP:** each point of armour above a weapon's AP removes one damage, down to a 20% minimum. Psychic attacks ignore armour.
- **Synapse:** swarm creatures near a synapse creature move 25% faster. Kill the Warriors first, or use a Librarian's Null Zone.
- **Camouflage:** only Librarians and units with auspex upgrades (or a Chaplain's Holy Auspex) can target Lictors.

Survive 40 waves to win, then keep going in freeplay.

## Code layout

- `index.html`: page structure
- `style.css`: styling
- `game.js`: everything else. Tune the game through the tables near the top:
  - `UNITS`: Tyranid stats
  - `TOWERS`: Space Marine stats and skill trees
  - `EARLY_WAVES` and `waveGroups`: wave composition
  - the `DRAW` functions and `drawMarine`: the art

In the browser console, `window.bloomfall` exposes the game state for debugging.
