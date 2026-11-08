# Act Natural

A party game for a TV and everyone's phones. The TV shows a room full of identical blobs; most are bots, a few are players steering from their phones while trying to finish secret tasks without moving like a human. One player is the Hunter. Rules for players: `public/how.html`. Design and decisions: `BRIEF.md`.

Live at **https://play.nithun.no** (once the server set-up below is done). It started in the nithun-website repo (`/lab/act-natural/`) and moved here with its history in November 2026.

## How it works

Plain HTML, JavaScript and canvas, no framework. The TV page is the game's server: it runs the simulation at 60 fps and talks to each phone directly over WebRTC.

| File | What |
|---|---|
| `public/index.html` | The one page: TV (`?host`), phone (`?room=CODE`), landing page (no parameters) |
| `public/sim.js` | The room, bots, movement, tasks |
| `public/round.js` | Rounds, the Hunter, shots, marks, the net, scores |
| `public/maps.js`, `public/art.js` | The maps and how their landmarks are drawn |
| `public/host.js` | The TV: drawing, join panel, talking to phones |
| `public/phone.js` | The phone screens: controller, Hunter, results |
| `public/net.js`, `public/relay.js` | Networking: PeerJS set-up, routes, the encrypted MQTT relay |
| `public/how.html` | How to play |
| `scripts/build.js` | Builds `dist/`: copies `public/`, the libraries into `dist/vendor/`, and makes `turn.js` |
| `server/turn/`, `server/mqtt/` | Set-up for the two relays on the server (coturn, Mosquitto) |
| `nginx/play.nithun.no` | The Nginx site |
| `tests/` | Headless tests (Playwright) |

**Networking is Hary's area** (`net.js`, `relay.js`, the connection code in `host.js` and `phone.js`, the relays, the Nginx proxy locations). Talk to him before changing it.

## Run it on your computer

```bash
npm install
```

```bash
npm run dev
```

Open `http://localhost:8765/?host` for the TV, or `http://localhost:8765/?host&demo=6` for a demo with no network. Phones on the same Wi‑Fi use the computer's IP address instead of `localhost`. The dev server has no `/peer/` or `/mqtt` proxy, so introductions go straight to PeerJS's public server.

## Tests

Needs Playwright's Chromium once:

```bash
npx playwright install chromium
```

```bash
npm test
```

This builds the game, starts the game and a local PeerJS server, and runs every `tests/*.test.cjs`: joining, rounds, the Hunter, the net, kicking, reloads, maps, the early end. Screenshots go to `tests/out/`.

## Deploy

Every push to `main` (including a merged PR) builds and uploads `dist/` to the server (`.github/workflows/deploy.yml`). Nginx is **not** updated by the deploy: changes to `nginx/play.nithun.no` are applied by hand as root, because the `deploy` user may only reload the website's own config.

Repository secrets (Settings → Secrets and variables → Actions):
- `DEPLOY_SSH_KEY`: a private key for the `deploy` user. Make a new one for this repo (`ssh-keygen -t ed25519 -C github-actions-deploy@act-natural -f act-natural-deploy`) and add its `.pub` to `/home/deploy/.ssh/authorized_keys` on the server.
- `DEPLOY_KNOWN_HOSTS`: the server's host keys (`ssh-keyscan 204.168.209.150`).
- `TURN_SECRET`: the relay's shared secret (`server/turn/README.md`). Without it the game has no relay login.

## Server set-up (once, as root)

1. DNS: an `A` record for `play.nithun.no` pointing to `204.168.209.150` (and `AAAA` if the server has IPv6).
2. Folder for the site, owned by the deploy user:
   ```bash
   mkdir -p /var/www/act-natural/dist && chown -R deploy:deploy /var/www/act-natural
   ```
3. Nginx site and certificate:
   ```bash
   scp nginx/play.nithun.no root@204.168.209.150:/etc/nginx/sites-available/play.nithun.no
   ```
   ```bash
   ln -s /etc/nginx/sites-available/play.nithun.no /etc/nginx/sites-enabled/ && nginx -t && systemctl reload nginx
   ```
   ```bash
   certbot --nginx -d play.nithun.no
   ```
4. Add the repo secrets above, then run the deploy (Actions → Deploy → Run workflow).
5. Relays: `server/turn/README.md` (coturn) and `server/mqtt/README.md` (Mosquitto). Their docs still say `nithun.no/lab/act-natural/…`; at play.nithun.no the paths are `/peer/` and `/mqtt`, and the relay login's host is `play.nithun.no` (set `TURN_HOST` to change it). TLS on 5349 (`turns:`) needs coturn's certificate to cover `play.nithun.no`.
6. When play.nithun.no works, nithun-website's `/lab/act-natural/` can redirect here.
