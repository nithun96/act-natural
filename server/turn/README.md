# Relay server (TURN) for Act Natural

Phones in Act Natural normally connect straight to the TV over WebRTC. Some networks (office and guest Wi‑Fi, mobile data behind strict NAT) block that, and the phone gets stuck on "Couldn't link directly to the TV". A relay server fixes it: when a direct link fails, phone and TV both send their traffic to the relay, which passes it on. This sets one up on the Hetzner server with coturn, using `turnserver.conf` in this folder. The game gets short-lived logins made from a shared secret when the site is built.

## Set-up

1. Log in to the server.

```bash
ssh root@204.168.209.150
```

2. Install coturn.

```bash
apt-get update && apt-get install -y coturn
```

3. Make the shared secret. Save the output in your password manager. Never paste it in a chat.

```bash
openssl rand -hex 32
```

4. Put the config in place. From your laptop, in the repo folder:

```bash
scp server/turn/turnserver.conf root@204.168.209.150:/etc/turnserver.conf
```

Then on the server, put the secret in (it asks for it, so it isn't saved in your command history):

```bash
read -rs TURN_SECRET && sed -i "s/^static-auth-secret=CHANGE_ME$/static-auth-secret=${TURN_SECRET}/" /etc/turnserver.conf && unset TURN_SECRET
```

5. Certificates. coturn can't read Let's Encrypt's files directly, so a hook copies them after every renewal. First check the certificate's folder name (it should be `nithun.no`):

```bash
certbot certificates
```

```bash
mkdir -p /etc/coturn/certs
```

```bash
cat > /etc/letsencrypt/renewal-hooks/deploy/coturn.sh <<'HOOK'
#!/bin/sh
# Copy the nithun.no certificate where coturn can read it, then restart coturn.
cp /etc/letsencrypt/live/nithun.no/fullchain.pem /etc/coturn/certs/fullchain.pem
cp /etc/letsencrypt/live/nithun.no/privkey.pem /etc/coturn/certs/privkey.pem
chown turnserver:turnserver /etc/coturn/certs/*.pem
chmod 600 /etc/coturn/certs/privkey.pem
systemctl restart coturn
HOOK
```

```bash
chmod +x /etc/letsencrypt/renewal-hooks/deploy/coturn.sh
```

Run it once now (the restart may complain until step 6; that's fine):

```bash
/etc/letsencrypt/renewal-hooks/deploy/coturn.sh
```

6. Switch coturn on. On some Ubuntu versions it's off until this line is set:

```bash
[ -f /etc/default/coturn ] && sed -i 's/^#\?TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn
```

```bash
systemctl enable --now coturn
```

```bash
systemctl status coturn
```

It should say `active (running)`.

7. Open the ports. If the server's own firewall (ufw) is on:

```bash
ufw status
```

```bash
ufw allow 3478/udp
```

```bash
ufw allow 3478/tcp
```

```bash
ufw allow 5349/tcp
```

```bash
ufw allow 49160:49200/udp
```

If the server has a firewall in the Hetzner Cloud Console (Firewalls, in the left menu of the project), add the same four rules there as inbound rules.

8. Give GitHub the secret, so each deploy can make fresh logins. On GitHub: the repository's **Settings → Secrets and variables → Actions → New repository secret**. Name: `TURN_SECRET`, value: the secret from step 3. Then **Actions → Deploy → Run workflow** to rebuild the site.

9. Test it. The logins change with every deploy, so read the current ones from the site:

```bash
curl -s https://nithun.no/lab/act-natural/turn.js
```

Open https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/, add the server `turn:nithun.no:3478` with that username and credential, and press **Gather candidates**. A line of type `relay` means it works.

10. To switch it off:

```bash
systemctl disable --now coturn
```

Close the ports from step 7 (`ufw delete allow 3478/udp` and so on, and in the Hetzner Console), and delete the `TURN_SECRET` secret on GitHub.

## Notes

- The logins last 60 days and are renewed on every deploy. If the game sits unchanged for two months, re-run the deploy (step 8).
- Anyone who reads the game page can use the relay until the login expires. That's why the config limits how many sessions it allows and refuses to relay to private networks or the server itself.
- Some company networks block ports 3478 and 5349 too. Relaying over port 443 would need Nginx's stream module in front of coturn; that isn't set up here.
