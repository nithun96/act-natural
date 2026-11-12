# Act Natural

A party game for a TV and everyone's phones. The TV shows a room full of identical blobs; most are bots, a few are players steering from their phones while trying to finish secret tasks without moving like a human. One player is the Hunter. Rules for players: `public/how.html`. Design and decisions: `BRIEF.md`.

Live at **https://play.nithun.no/act-natural/** (once the server set-up below is done). It started in the nithun-website repo (`/lab/act-natural/`) and moved here with its history in November 2026.

## Structure

- **play.nithun.no hosts games, one per path:** this one at `/act-natural/`, the next at `/<game>/`. For now `play.nithun.no/` redirects here; later it can list the games.
- **One repo per game,** each deploying to `/var/www/play/<game>/` on the server, with its own `location ^~ /<game>/` block in `nginx/play.nithun.no`.
- **Shared relays** (coturn, Mosquitto) are set up from this repo for now. If a second game needs them, they can move to a small `play-infra` repo.
- **One Claude session per repo:** start sessions about the game from this repo (it has its own `CLAUDE.md`), and sessions about the website from nithun-website.
- **Plans:** rules and decisions in `BRIEF.md`, what's next in `ROADMAP.md`.

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
| `public/sitemap.xml` | The pages search engines may index (landing and how-to) |
| `scripts/build.js` | Builds `dist/`: copies `public/`, the libraries into `dist/vendor/`, and makes `turn.js` |
| `server/turn/`, `server/mqtt/` | Set-up for the two relays on the server (coturn, Mosquitto) |
| `nginx/play.nithun.no` | The Nginx site, incl. `robots.txt` and which URLs get `X-Robots-Tag: noindex` (game screens, anything with a query string) |
| `tests/` | Headless tests (Playwright) |

**Networking is Hary's area** (`net.js`, `relay.js`, the connection code in `host.js` and `phone.js`, the relays, the Nginx proxy locations). Talk to him before changing it.

## Run it on your computer

```bash
npm install
```

```bash
npm run dev
```

Open `http://localhost:8765/act-natural/?host` for the TV, or `http://localhost:8765/act-natural/?host&demo=6` for a demo with no network. The game is served at `/act-natural/`, as on the server, and `/` redirects there. Phones on the same Wi‑Fi use the computer's IP address instead of `localhost`. The dev server has no `/act-natural/peer/` or `/act-natural/mqtt` proxy, so introductions go straight to PeerJS's public server.

## Tests

Needs Playwright's Chromium once:

```bash
npx playwright install chromium
```

```bash
npm test
```

This builds the game, starts the game and a local PeerJS server, and runs every `tests/*.test.cjs`: joining, rounds, the Hunter, the net, kicking, reloads (phone and TV, with scores kept), maps, the early end. Screenshots go to `tests/out/`.

## Deploy

Every push to `main` (including a merged PR) builds and uploads `dist/` to `/var/www/play/act-natural/` on the server (`.github/workflows/deploy.yml`). Nginx is **not** updated by the deploy: changes to `nginx/play.nithun.no` are applied by hand as root, because the `deploy` user may only reload the website's own config.

Repository secrets (Settings → Secrets and variables → Actions):
- `DEPLOY_SSH_KEY`: a private key for the `deploy` user. Make a new one for this repo (`ssh-keygen -t ed25519 -C github-actions-deploy@act-natural -f act-natural-deploy`) and add its `.pub` to `/home/deploy/.ssh/authorized_keys` on the server.
- `DEPLOY_KNOWN_HOSTS`: the server's host keys (`ssh-keyscan 204.168.209.150`).
- `TURN_SECRET`: the relay's shared secret (`server/turn/README.md`). Without it the game has no relay login.

## Server set-up (once, as root)

1. DNS: an `A` record for `play.nithun.no` pointing to `204.168.209.150` (and `AAAA` if the server has IPv6).
2. Folder for the site, owned by the deploy user:
   ```bash
   mkdir -p /var/www/play/act-natural && chown -R deploy:deploy /var/www/play
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
5. Relays: `server/turn/README.md` (coturn) and `server/mqtt/README.md` (Mosquitto). The PeerJS proxy is at `/act-natural/peer/` and the MQTT relay at `/act-natural/mqtt`. The relay login's host is `play.nithun.no` (set `TURN_HOST` to change it). TLS on 5349 (`turns:`) needs coturn's certificate to cover `play.nithun.no`.
6. When play.nithun.no works, nithun-website's `/lab/act-natural/` can redirect to `https://play.nithun.no/act-natural/`.
