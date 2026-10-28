# Raid Boss Guide

A Pokémon GO raid companion app. It covers every raid boss (1★ to 5★, Elite, Shadow, Mega, Mega Legendary, Primal and Super Mega) and every Max Battle boss (Dynamax 1★ to 5★ and Gigantamax).

The home screen is the **raid rotation**, day by day from today. On the first day a boss appears it shows the full start and end date and time. Raid Hours, Raid Days and Max Mondays are listed on their days, and today also shows the undated 1★/3★ lineup. The rotation is loaded live from LeekDuck each time you open the app, with a saved copy for offline use.

For each boss the app gives:

- **Weaknesses and resistances**, including double weaknesses (2.56×)
- **Boss CP, catch CP** (normal and weather boosted) and boosting weather
- **Top counters**, ranked by simulated damage (DPS, TDO and a 0–100 rating)
- **Suggested raid parties**: a best team and a budget team (no Megas, Shadows or Legendaries), plus a rough count of trainers needed
- **Best moves** for the boss once you catch it, and the moves the boss can use against you
- **Super Mega raids**: shield count, how the shields work, and the best Megas to bring (every trainer needs one)
- **Max Battles**: the best Dynamax/Gigantamax attackers (ranked by Max Attack damage), the best tanks, and a suggested team of three

**My Pokémon:** add the Pokémon you own (species, CP, moves, and optionally Shadow, can Mega Evolve, Dynamax/Gigantamax and IVs). The app works out each one's level from its CP. Every boss page then shows **your best team** next to the best possible team, plus TM tips ("TM your Tyranitar to Brutal Swing for about 19% more damage"). Your list is saved on your device only, and you can download it as a backup file and load it again on another device. Pokémon GO has no official way for apps to read your account, so the list is entered by hand.

**Add from screenshots:** on My Pokémon, pick screenshots of your Pokémon's pages from Pokémon GO (several at once). The app reads the species (even with a nickname, from its candy and moves), CP, HP, current moves, Shadow and Dynamax/Gigantamax. From the CP, HP and power-up stardust cost it works out the exact level and often the exact IVs. Misread or partly hidden CP digits are corrected by picking the CP that best fits the HP and power-up cost; the cost is recognised from its numbers even when the button label isn't read. It also handles a Mega Evolution that's active now (pink CP and Mega stats), Shadow Pokémon (with the Purify cost ruled out), nicknames with no candy shown (identified from their moves), and Mega moves like Future Sight+. Tested on real iPhone screenshots (`tests/real-pages.test.mjs`). Text recognition ([Tesseract.js](https://github.com/naptha/tesseract.js)) runs on the device, so screenshots are never uploaded. You check each Pokémon before it's added.

**Import from your storage list:** screenshots of the storage grid (sorted by CP) add lots of Pokémon at once. The app reads each tile's name and CP, ignoring the stars and sparkles. It picks the form that fits the CP (e.g. Crowned Zacian), spots Mega Evolutions active now (red CP) and flags nicknames for you to pick. Storage doesn't show moves, so each one gets its usual raid moveset and is marked "moves not checked". Scanning that Pokémon's own page later fills in its real moves.

**Power up?** gives a verdict for each of your Pokémon (power up, raid-ready, only with spare stardust, or don't power up). It's based on how it ranks among the best attackers of its type and how it would do at level 40 against the raid bosses running now or in the next two weeks. It shows the stardust and candy cost to level 40, and tips like "TM it first" or "low Attack IV".

**Look up** shows any Pokémon's raid value: type rankings, best movesets, which current bosses it's good against, its weaknesses, and advice for your copies. You can also look one up from a screenshot.

**Scan these next:** after a storage import, My Pokémon lists the unchecked Pokémon that appear in your best team for the most current raids, so you know whose pages to screenshot first.

**Types:** the full Pokémon GO type chart, and a page per type with what it beats and what beats it, its best raid attackers, and your own best ones.

**Favourites:** tap ☆ Favourite on any boss. Favourites get their own tab in All bosses, are highlighted in the rotation, and are listed at the top with when they're next in raids.

**Reminders:** the rotation's 🔔 buttons add a Raid Hour, Raid Day, Max Monday or boss rotation to your phone's calendar with an alert. You can also subscribe to `data/raid-calendar.ics`, which the daily build regenerates, so new events appear in your calendar by themselves.

Counters change with your settings: Pokémon level (40/50), weather, the boss's moveset, and whether to include Megas, Shadows, Legendaries and Elite TM moves.

It runs in any browser, works on phones, and can be added to the home screen like an app (it also works offline).

## Live app

**https://rxqp5.github.io/Project/**: open it on your phone and use "Add to Home Screen" to install it like an app.

It's published by GitHub Pages (`.github/workflows/pages.yml`) on every change to `main`, and rebuilt every day with fresh game data. You can also trigger a rebuild by hand from the repository's **Actions** tab ("Deploy to GitHub Pages", then "Run workflow").

## Running it

Needs [Node.js](https://nodejs.org) 18 or newer. There are no packages to install.

```sh
npm start          # open http://localhost:8080
npm test           # run the calculation tests
npm run build:data # re-download game data and rebuild data/game.json
```

## How it works

| Path | What it is |
| --- | --- |
| `index.html`, `src/app.js`, `src/styles.css` | The app's screens |
| `src/calc.js` | Battle maths: type chart, damage formula, counter ranking, parties, Max Battles |
| `src/schedule.js` | Turns the LeekDuck event calendar into the day-by-day rotation |
| `src/collection.js` | Your own Pokémon: level from CP, ranking them against a boss, TM tips, saving |
| `src/mine.js` | The My Pokémon page, including adding from screenshots |
| `src/scan.js` | Reads Pokémon GO screenshots: text recognition, species, CP, moves, level and IVs |
| `src/advice.js` | Power-up advice: type rankings, boss placements, costs, verdicts |
| `src/pokemon-pages.js` | The Power up? and Look up pages |
| `src/types-page.js` | The type chart and per-type pages |
| `src/calendar.js` | Calendar (.ics) files for reminders, shared by the app and the build |
| `data/raid-calendar.ics` | Generated: subscribable calendar of raid events |
| `scripts/build-data.mjs` | Builds `data/game.json` from public data sources |
| `data/game.json` | Generated data: every Pokémon, move and raid boss |
| `data/raids-extra.json` | Raid bosses added by hand (see below) |

**Data sources**
- [PokeMiners game master](https://github.com/PokeMiners/game_masters): official stats, moves, Megas/Primals, weather and the type chart
- [PvPoke](https://github.com/pvpoke/pvpoke): which Pokémon and Shadows are released, and display names
- [Pokebattler](https://www.pokebattler.com): current, upcoming and past raid bosses for every tier, plus stats and moves for Megas and moves newer than the game master
- [pogoapi.net](https://pogoapi.net): older raid history (last updated November 2025)
- [LeekDuck](https://leekduck.com/events/) via [ScrapedDuck](https://github.com/bigfoott/ScrapedDuck): raid rotation dates and the current lineup

**Super Mega raids** (since February 2026) come in a 4★ and a 5★ tier with 25,000 HP. The boss starts with shields (usually 7 to 10). While they're up it deals 2× damage and takes 4× less. Only a Mega-Evolved Pokémon can break a shield, one per trainer, so you need at least as many trainers with Megas as there are shields.

**Max Battles** only allow Dynamax Pokémon, three per trainer. Attackers are ranked by the damage of one level-3 Max Attack (350 power, or 450 for a matching G-Max move), whose type is the fast move's type. Tanks are ranked by how long they survive the boss's attacks.

**Counter rankings** use the community-standard method (the GamePress formula): for every attacker, each fast and charged move pair is simulated against the boss, taking into account type effectiveness, same-type attack bonus (STAB), weather boost, energy gained and the damage the boss deals back. Attackers are ranked by DPS³ × TDO. These are estimates, like any raid calculator's.

## Adding a raid boss by hand

If a boss is missing, add it to `data/raids-extra.json` (past Super Mega bosses are listed there already):

```json
{ "bosses": [{ "key": "VICTREEBEL_MEGA", "tier": "super_mega_4", "shields": 8 }] }
```

`key` is the Pokémon's id in `data/game.json`. `tier` is one of `1`, `3`, `5`, `elite`, `mega`, `mega_legendary`, `primal`, `super_mega_4`, `super_mega_5`, `shadow_1`, `shadow_3`, `shadow_5`, `max_1` to `max_5` (Dynamax) or `max_6` (Gigantamax). Optional: `status` (`past`, `current` or `upcoming`) and `shields`. Then run `npm run build:data`.

---
Fan-made tool. Not affiliated with Niantic, Nintendo or The Pokémon Company.
