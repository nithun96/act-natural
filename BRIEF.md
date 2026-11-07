# Act Natural: brief for Claude Code

Status: draft brief, 07.11.2026. Nothing below has been built yet.

## What and why

A party game for an AI workshop where 6–20 people play together (12 right now). The TV shows the shared screen, driven by a Mac over HDMI (AirPlay adds too much delay). Everyone's phone is their controller and holds their secrets. It's inspired by how the team's Mafia game works ([haryp2309/mafia-online](https://github.com/haryp2309/mafia-online)), but this game is played in real time.

**The pitch:** the TV shows a room full of identical blobs, and most of them are bots wandering around at random. Each human controls one blob from their phone and has to finish secret tasks without moving like a human. One player is the Hunter, who has 3 shots to pick out the humans.

It will live at `nithun.no/lab/act-natural/`. It won't be linked from the site and will be marked noindex.

## Rules (v1)

- **Lobby:** the TV shows a QR code and a 5-letter room code. Phones join and enter a name.
- **Round (90 s):** one player is the Hunter. Hunters rotate in join order, so with N players a full game is N rounds, or the host stops it early.
- **The room:** about 1600×900 world units containing 5 named landmarks (e.g. Fountain, Lamp, Bench, Tree, Rug). There are `max(16, humans × 2)` bots.
- **Bots:** each bot picks a target (a landmark 40% of the time, otherwise a random point), walks to it at constant speed, pauses for 0.5–3 s, and repeats.
- **Humans:** the joystick only sets direction. Above a 30% deflection the blob moves at exactly bot speed, otherwise it stands still. This stops humans being caught out by their speed.
- **Tasks:** each human gets 3 landmarks in order on their phone. Standing within range of a landmark for 1.5 s ticks it off. Each landmark is worth +1, and finishing all 3 is worth +2 more.
- **Hunter:** has no blob. Their phone shows the map, and a tap shoots the nearest blob within the hit radius. Hitting a human gives the Hunter +3 and takes that human out of the round (their blob is greyed out). Hitting a bot wastes the shot, and that bot is revealed and removed.
- **End of round:** the timer runs out or every human is out. The TV shows who was who and the scores. Then the host presses "Next round".

## Added after the build order (Nov 2026)

- **Maps:** the park, Vietnam (Hoan Kiem Lake, phở stall, Hội An lanterns, rice paddy, motorbike), Jaffna (Nallur Kandaswamy, Casuarina Beach, Jaffna Public Library, palmyra palm, Jaffna Fort) and East Oslo (Stovner senter, Haugenstua T, Stovnertårnet, football pitch, the blocks). The host picks one between rounds (M). Landmark choices were Claude's proposal, not yet confirmed by Nithun.
- **Early end:** a round also ends when the Hunter has no shots left and every hider still in has finished all three landmarks.

## Architecture

- **No build step.** Plain HTML, JS and canvas in `public/lab/act-natural/`, the same pattern as the existing `public/lab/noise.html`. The site's Vite build copies `public/` as is.
- **Dependencies:** PeerJS (UMD `peerjs.min.js` from the npm package) and a small QR library (`qrcode-generator`). Both are npm dependencies with exact versions in `package.json` (changed from copied files on 07.11.2026); `vite.config.js` copies them into `dist/lab/act-natural/vendor/`, so the CSP stays `script-src 'self'`.
- **The host page is the server:** `?host` runs the simulation at 60 fps, draws the TV and holds all state. Phones open `?room=CODE`.
- **Networking:** PeerJS with host id `act-natural-nithun-<CODE>`. The public PeerJS server only introduces devices; data then flows directly over WebRTC.
- **Messages:**
  - Phone → host: `join {name, token}` once, and `in {dx, dy}` 15 times a second while the stick is moved, plus one zero when it's released. The host stops a blob if it hears nothing for 500 ms.
  - Hunter → host: `shoot {x, y}` in world coordinates.
  - Host → each phone: `you {role, task, progress, score, phase, timeLeft}` when something changes, plus your own position (or every blob, for the Hunter) 10 times a second.
- **Reconnect:** a token in localStorage, so a phone that reloads gets the same player back. Persisting the host's own state between reloads isn't needed in v1.
- **Hit test:** done on the host using the position the Hunter's phone saw. A generous radius covers latency; no rewinding.
- **Phone UI:** a map at the top showing only your own dot and your next landmark (always visible: decided 07.11.2026 after testing, replacing hold-to-show), the task list, a joystick area below, plus the Wake Lock API to keep the screen on.
- **Tasks (as built, step 3):** "within range" means within 100 world units of the landmark's centre; the 1.5 s count starts again if you leave the range. Moving inside the range is allowed.

**From mafia-online, borrow ideas, not code.** The repo has no licence, so copying from it needs permission from haryp2309. These parts are worth reading: `client/src/net/hostRuntime.ts` (PeerJS host, reconnect), `shared/views.ts` (what each device is allowed to see) and `client/src/routes.ts` (QR code with the secret in the #fragment). Its MQTT fallback is about 1,400 lines; skip it in v1.

## Deployment on nithun.no (the trap)

The Nginx CSP has `connect-src 'self'`, which **blocks PeerJS**. That needs its own location block in `nginx/nithun-website`:

```nginx
location = /lab/act-natural { return 301 /lab/act-natural/; }
location ^~ /lab/act-natural/ {
    expires -1;
    # An add_header in a location drops ALL of the server-level headers, so repeat them all here.
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://0.peerjs.com wss://0.peerjs.com; frame-ancestors 'none'" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(), usb=()" always;
    add_header Cross-Origin-Opener-Policy "same-origin" always;
    add_header X-Robots-Tag "noindex, nofollow" always;
    try_files $uri $uri/index.html =404;
}
```

- Without the `=` block, `/lab/act-natural` with no trailing slash falls through to `location /` and returns a 404.
- Check that the PeerJS server's address is still `0.peerjs.com`: open DevTools → Network on a test.
- **Built (07.11.2026):** Nithun's work laptop blocks PeerJS, so introductions go through a proxy on nithun.no first (`location ^~ /lab/act-natural/peer/` → `https://0.peerjs.com/`, looked up per request so a DNS failure can't stop Nginx starting) and directly to `0.peerjs.com` second. Game data stays direct WebRTC either way. This only helps if the network allows WebRTC itself.
- Follow the site's `CLAUDE.md`: work on a branch, open a PR and merge it, and the deploy runs itself. Run `npm run build` first, because `scripts/check-site.js` may complain about new files.
- When the game is retired, list its files in `.github/retired-files.txt`.

## Build order

Each step should be playable before the next one starts.

1. **Demo without a network.** `?host&demo=6` shows the room, the bots and 6 fake humans moving like bots, with the canvas scaled to the TV.
   *Done when:* it runs at 60 fps on the Mac, and nobody can tell humans from bots by watching.
2. **Phones join and move.** QR join, lobby, joystick, your own blob moves on the TV.
   *Done when:* 3 phones on the same Wi‑Fi feel responsive (under about 150 ms from thumb to TV).
3. **Tasks and scores.**
   *Done when:* landmarks tick off on the phone and the score updates on the TV.
4. **Hunter round.** Map on the Hunter's phone, shooting, reveals, end of round, rotation.
   *Done when:* a full round with 12 people works from start to finish.
5. **Deploy** using the Nginx block above, then test on 4G as well as Wi‑Fi.

**Non-functional requirements:**
- Colour-blind friendly: colour is never the only cue. Anything that tells players apart or marks a state (revealed, eliminated, next task, your own dot) also differs in shape, outline, text or position (decided 07.11.2026).
- Works on iOS Safari 15+ and Chrome on Android.
- No accounts, analytics or server-side code.
- The phone screen must never reveal who you are to someone looking over your shoulder.

## Testing locally

- Run `npm run dev -- --host`, then open `http://<Mac's IP>:5173/lab/act-natural/index.html?host` on the Mac and the QR link on phones on the same Wi‑Fi. (Serving the folder on its own no longer works: the libraries come from `node_modules`.)
- PeerJS needs internet access for the introductions.
- The local server sends no CSP, so the CSP will only be tested after deploying.

## Open questions

- ~~Should the Hunter also see the TV?~~ **Decided 07.11.2026:** everyone watches the TV, including the Hunter. The Hunter's phone map is only for aiming.
- Should eliminated humans get something to do, such as becoming a ghost that can mark a blob for the Hunter?
- Name: "Act Natural" or something in Norwegian?
- Is haryp2309 OK with you borrowing ideas from the repo, and should he be credited on the page?

## Prompt to paste into Claude Code

> Read `ACT-NATURAL-BRIEF.md` and `CLAUDE.md`. Create a branch and build step 1 under "Build order": the network-free demo mode in `public/lab/act-natural/`. Stop when it runs, show me how to open it, and wait before going on to step 2.
