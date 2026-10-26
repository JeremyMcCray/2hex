# NerdHex

A browser-based, three-player asymmetric RTS: **one Swarm against two Colonies** on a hex battlefield. Inspired by the "one swarm versus many defenders" formula of the StarCraft II arcade map *Zerg Hex*, rebuilt from scratch as a 2v1 with original units, names and art.

No server, no accounts. The host's browser runs the match; friends join with a **4-letter room code**. Everything is static files, so it deploys to GitHub Pages as-is.

## Play

1. Open the site. Enter a name and click **Host a match**. You get a code like `KQ7M`.
2. Two friends open the same site, type the code and click **Join** (sharing the URL with `#CODE` on the end pre-fills it).
3. Everyone picks a side: Swarm, Colony A or Colony B. The host clicks **Start** once all three sides are taken.

Humans only: the match needs exactly three players.

### Swarm (solo)

- You hold the raised central plateau with the **Hive**. Lose it and you lose.
- Build **Extractors** on the six mineral veins around the Hive. Each one pays `15 + (number of Spawners alive)` minerals per minute, so economy and aggression feed each other.
- Hatch **Spawners** on creep (max 8). They are slow, mobile pods that breed units for free. Walk them toward the Colony bases, set a rally point, or flip them to **Aggressive** so every unit they breed attack-moves at the nearest Command Hub.
- A **Nest** unlocks Strikers (heavy melee) and Lancers (ranged); **Evolved Hive** unlocks Behemoths (siege, triple damage to structures) and adds Hive income.
- **Spines** are static defense on creep. Claws and Carapace upgrades buff every unit.
- Win by destroying **both** Command Hubs.

### Colony (two players)

- Each of you has a corner base with a **Command Hub**, Barracks, Generator and Battery, sealed by chasms with one front entrance and a rock-blocked back door that hides a geyser.
- Lasers need **energy**. Generators make it, Batteries store it, and every shot spends it. Run dry and your lasers fire at 30% damage. The top bar turns red when you're low.
- Train **Troopers** (and **Gunners** after a Tech Lab). Build Refineries on geysers for gas, Mining Rigs on your veins, Walls and Laser Turrets at the choke.
- Research **Shattering Laser** (double damage to structures), **Conservation** (cheaper shots) and **Focus Lenses** (+1 range). Anything your ally has already researched costs you half.
- Win by destroying the **Hive**.

### Pressure clock

Every 4 minutes a **Surge** fires: the Hive gains +20 minerals/min permanently and each Colony receives two free Troopers. Nobody can turtle forever.

### Leaving

If a Colony player disconnects, their ally inherits their base, units and research, plus 300 minerals. If the Swarm player leaves, the Colonies win. If the host leaves, the match ends.

### Controls

| Action | Input |
| --- | --- |
| Select | Left click / left drag (Shift to add) |
| Move / attack target | Right click |
| Attack-move | `A` then left click (or the button) |
| Stop | `S` |
| Build | Click a build button (or its hotkey), then click a hex. Shift-click to place several. |
| Pan | Arrow keys, middle-drag, or click the minimap |
| Zoom | Mouse wheel |
| Home | `H` |
| Cancel | `Esc` |

## Deploy to GitHub Pages

1. Create a repository (for example `nerdhex`) and push these files to its `main` branch.
2. In the repository go to **Settings → Pages**. Under *Build and deployment* choose **Deploy from a branch**, pick `main` and `/ (root)`, and save.
3. After a minute the game is live at `https://<your-user>.github.io/<repo>/`.

Nothing to build. The only third-party code is `vendor/peerjs.min.js` (MIT), shipped in the repo so the page has no external dependencies.

### How the networking works

- The host creates a PeerJS peer whose id is derived from the room code (`nerdhex-v1-XXXX`). Guests connect to that id over WebRTC. The free public PeerJS broker (`0.peerjs.com`) only handles the handshake; after that the data channel is peer-to-peer.
- The host is authoritative: it runs the simulation 10 times a second, applies everyone's commands, and streams full snapshots (a few KB) to each guest. Guests render snapshots with interpolation and only send commands.
- Heartbeats drop a player that has been silent for 8 seconds, which triggers the leaver rules.
- If you'd rather use your own [PeerServer](https://github.com/peers/peerjs-server), add `?signal=host:port:path` (and `&insecure=1` for plain `ws://`) to the URL.

Some corporate networks block WebRTC entirely; if a guest can't connect, that's usually why.

## Project layout

```
index.html        lobby + game shell (all CSS inline)
js/hex.js         axial hex math
js/map.js         deterministic map generator (plateau, ramps, two sealed bases, geysers, rocks)
js/data.js        every balance number: units, structures, research, surge timing
js/sim.js         the simulation: economy, energy, pathfinding, combat, win/leaver rules, snapshots
js/render.js      canvas renderer and minimap
js/net.js         PeerJS host/client, room codes, heartbeats
js/main.js        lobby UI, input, HUD, game loop
vendor/peerjs.min.js
test/sim.test.mjs headless 15-minute scripted match: `node test/sim.test.mjs`
```

## Tuning

All numbers live in `js/data.js`. The headless test prints income rates and unit counts minute by minute, which is the quickest way to see what a change does before dragging two friends into a lobby.
