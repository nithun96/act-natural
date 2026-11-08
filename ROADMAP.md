# Act Natural: roadmap

Last updated 08.11.2026, after the game moved to this repo. Based on a review of the game on 08.11.2026 (nithun-website `main` at `e40fbf2`), updated with what has shipped since. The first workshop has happened; this is about improving the game for future sessions.

Designs for maps, characters and map effects: the Claude Design canvas [Act Natural – maps & characters](https://claude.ai/artifact/DxquFTWxsfTpHyaEiqpPz1) (private to Nithun).

Owner hints:
- **Nithun/Claude:** the game, UI and maps.
- **Hary:** networking (`net.js`, `relay.js`, the connection code in `host.js` and `phone.js`, the Nginx proxy locations, TURN and MQTT).
- **Nithun (root):** anything done by hand on the server.

## Done since the review

- **Hunter:** shots recharge (1 to start, +1 every 20 s, up to 3; a miss locks shooting for 5 s), and up to 3 suspects can be marked, shown as "Suspect 1–3" on the TV.
- **The net:** once per round, holds every blob in a circle for 8 s. It catches nobody, and bots and humans set off again with the same spread of delays.
- **Kicking:** the host can remove a player between rounds.
- **Mid-round joins** no longer reshuffle the Hunter's blob numbers (review problem 2).
- **Early end:** a round ends when every hider still in has finished all three landmarks.
- **Maps:** Ålesund now has Aspøy skole and Jugendstilsenteret (instead of Aspøya and Aksla), checked against written sources; East Oslo has Grorud T, Haugenstua Lampa and Rommen Hindu Temple. A bug that removed Ålesund's drawings is fixed.
- **TV reload keeps the game** (review problem 4): scores, round, who has hunted, kicks and the map survive a reload of the TV; a round running at the reload ends there with its points kept. Phones rejoin on their own (no connection code changed).
- **Players who have left don't hold a round up** (review problem 3): "everyone caught" and "all done" count only hiders who are connected or dropped out less than 10 s ago.
- **Collision, part 1:** overlapping blobs are pushed apart, half each, the same for bots and humans; caught humans stay solid, blobs under the net are pinned. A headless test compares fake humans with bots over 10 simulated minutes. Still needs a real playtest: about 0.4 walks per blob per minute get stuck in crowds, where a person would steer round.
- **Moved to its own repo**, served at `play.nithun.no/act-natural/` (once the server is set up).

## Open problems from the review

| # | Severity | What |
|---|---|---|
| 1 | **High** | **Neither fallback relay is switched on.** Players whose network blocks direct links (the Safari group at the workshop) can't join until coturn and/or Mosquitto run on the server and `TURN_SECRET` is set. |
| 5 | Medium | **Aiming is fiddly on small phones:** small dots, nearest-within-36-px selection, no zoom. |
| 6 | Medium | **Canopies hide blobs** (park tree, Jaffna palm). Could be a feature, but isn't designed as one. |
| 7 | Medium | **No solid landmarks:** blobs bump into each other now, but still walk through buildings and water. |
| 8 | Low | Shot rings animate even with reduced motion on. |
| 9 | Low | End-of-round name tags overlap when humans stand close together. |
| 10 | Low | The brief says "no server-side code", but the game now relies on coturn and Mosquitto. Record it as a decision. |
| 11 | Low | Several landmarks are Claude's picks that Nithun hasn't confirmed (Vietnam, Jaffna, how Haugenstua Lampa looks, Jugendstilsenteret's colours). |

## Collision: recommended approach

- **First, soft blob–blob separation (S):** after each move, push overlapping blobs apart by half the overlap each, identically for bots and humans. Caught humans stay solid, so no gap in the crowd marks them. Cheap: about 17 ms per minute of play at 60 blobs.
- **Then solid landmarks (M):** convex shapes only (circle or rounded rectangle) per landmark in `maps.js`, with sliding along edges, bot stuck detection, targets never inside solids, and task zones measured from the shape's edge.
- **Hard blocking is rejected:** bots would stall face to face where humans steer round, which gives humans away.
- **Test for tells** headlessly: compare fake humans with bots over 10 simulated minutes (contact time, time against solids, stuck count, straightness, share of time moving, walks per minute), then a real playtest.

## Next

| Item | Why | Effort | Owner | Depends on |
|---|---|---|---|---|
| Set up play.nithun.no (DNS, folder, Nginx, certificate, repo secrets) | The game's new home | S | Nithun (root) | none |
| Switch on the relays (Mosquitto and/or coturn), add `TURN_SECRET`, redeploy | Players behind strict networks still can't join | S–M | Nithun (root) with Hary | play.nithun.no |
| Playtest collision for tells (do people steer round crowds where bots get stuck?) | Part 1 is only proven identical in simulation | S | Nithun + players | none |
| Retest on real networks: Safari iPhone, Android, the work laptop as TV, office Wi‑Fi and 4G | Proves the relays fix what failed | S | Nithun + Hary | relays on |
| Redirect nithun.no/lab/act-natural/ here and remove the game from nithun-website | One home for the game | S | Claude | play.nithun.no works |

## Soon

| Item | Why | Effort | Owner | Depends on |
|---|---|---|---|---|
| Map effects and character variety from the design canvas | More depth and variety per map | M–L | Claude | Nithun's picks on the canvas |
| Collision, part 2: solid landmarks | Makes maps feel physical | M | Claude | part 1 |
| Easier aiming (hold to zoom, or step through nearby blobs) | Mis-taps waste shots | S–M | Claude | none |
| Full-screen join view (big QR code) | Easier for big groups | S | Claude | none |
| Confirm landmarks and drawings with Nithun | Real places with personal meaning | S | Nithun + Claude | Nithun's input |

## Later

| Item | Why | Effort | Owner | Depends on |
|---|---|---|---|---|
| Norwegian UI | Players are mostly Norwegian | M | Claude | name decision |
| A role for caught players (e.g. a ghost who can mark one blob) | Keeps caught players engaged | M | Claude | decision below |
| Per-player connection status on the TV (direct or relayed) | Faster troubleshooting | S | Hary | relays on |
| Relay over port 443 (TURN-TLS behind Nginx's stream module) | Some networks block 3478 and 5349 | M | Hary + Nithun (root) | relays on |
| Post-round replay of each human's path | Fun reveal | M | Claude | none |
| More maps, or a data-only map template | Variety for repeat sessions | S each | Claude | none |

## Decisions for Nithun

- **Caught players:** give them something to do, or not?
- **Name:** keep "Act Natural", or a Norwegian name?
- **Crediting Hary** on the game's pages.
- **Canopies:** hiding spots by design, or should blobs show through?
- **Design canvas picks:** which characters, map redesigns and effects to build; the nón lá and jasmine garland; snow footprints; Ålesund's single bridge.
