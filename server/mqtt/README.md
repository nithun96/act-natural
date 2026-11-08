# Message relay (MQTT broker) for Act Natural

Phones in Act Natural connect straight to the TV over WebRTC when they can. When a network blocks that (office and guest Wi‑Fi, strict mobile networks), phones that scanned the QR code fall back to an encrypted relay: phone and TV both connect to a message broker and pass their messages through it. This sets that broker up on the Hetzner server with Mosquitto, using the two files in this folder.

- Mosquitto listens on the server itself only (`127.0.0.1:9001`). Phones reach it through Nginx at `wss://play.nithun.no/act-natural/mqtt`, on port 443 like any web page. So there is no port to open, no certificate to copy, and it works on networks that block everything but normal web traffic.
- The broker can't read anything: the game encrypts every message before sending it, with a key that only travels inside the QR code. The topic rules only allow the game's own topics.
- Nginx has the `/act-natural/mqtt` block in `nginx/play.nithun.no` (installed by hand, see the main README). Until Mosquitto runs, it answers 502 and only direct links work.

## Set-up

1. Log in to the server.

```bash
ssh root@204.168.209.150
```

2. Install Mosquitto.

```bash
apt-get update && apt-get install -y mosquitto
```

3. Put the config in place. From your laptop, in the repo folder:

```bash
scp server/mqtt/act-natural.conf root@204.168.209.150:/etc/mosquitto/conf.d/act-natural.conf
```

```bash
scp server/mqtt/act-natural.acl root@204.168.209.150:/etc/mosquitto/act-natural.acl
```

4. Back on the server, start it and switch it on at boot:

```bash
systemctl enable mosquitto && systemctl restart mosquitto
```

```bash
systemctl status mosquitto
```

It should say `active (running)`. If not, `journalctl -u mosquitto -n 30` shows why.

5. Check that it listens on the server only (the line should say `127.0.0.1:9001`, never `0.0.0.0` or `*`):

```bash
ss -ltnp | grep 9001
```

6. Test it from your laptop. The answer `HTTP/1.1 101 Switching Protocols` means Nginx reached Mosquitto (`502 Bad Gateway` means Mosquitto isn't running):

```bash
curl -si --http1.1 -H "Connection: Upgrade" -H "Upgrade: websocket" -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" -H "Sec-WebSocket-Protocol: mqtt" --max-time 3 https://play.nithun.no/act-natural/mqtt | head -1
```

Then in the game: open `https://play.nithun.no/act-natural/?host` (the join panel should end with "relay ready"), and on a phone scan the QR code and add `&relay` to the address before the `#`. The phone shows "relay" next to its delay.

7. To switch it off:

```bash
systemctl disable --now mosquitto
```

## Testing on the laptop

`npm run dev` has no proxy for `/act-natural/mqtt`. To test the relay on the laptop (`brew install mosquitto`), run a broker with this config, changing only the topic rules' path:

```bash
sed "s#/etc/mosquitto/act-natural.acl#$PWD/server/mqtt/act-natural.acl#" server/mqtt/act-natural.conf > /tmp/act-natural-mosquitto.conf && /opt/homebrew/sbin/mosquitto -c /tmp/act-natural-mosquitto.conf -v
```

then start `npm run dev` and add `&broker=ws://localhost:9001` to the game's address.

## Notes

- Anyone can connect without a login, but only to Act Natural's topics, and the limits in `act-natural.conf` (200 connections, 64 kB messages) stop it being used to wear the server down.
- Memory and CPU use are tiny: a full game is about 21 connections and a few hundred small messages a second.
- The design comes from mafia-online (`docs/p2p-networking.md`), which uses three free public brokers. Those throttled this game's 15 messages a second down to a few, with seconds of delay, which is why it has its own.
