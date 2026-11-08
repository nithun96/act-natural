# CLAUDE.md – Act Natural

Read `README.md` (how it's built and deployed) and `BRIEF.md` (rules, decisions, open questions) first.

- **British English** everywhere: UI text, docs, commits, PRs.
- **Colour is never the only cue.** Anything that marks a state (revealed, caught, netted, next task, your own dot, suspects) also differs in shape, outline, text or position.
- **Bots and humans must behave and look identically.** Movement, collision, effects, looks and timings must give nothing away; check new features for tells (e.g. compare release or reaction timings).
- **Networking is Hary's area** (`net.js`, `relay.js`, connection/join code in `host.js`/`phone.js`, `server/`, the proxy locations in `nginx/`). Don't change it without asking Nithun.
- **Work on a branch and open a PR**; merging to `main` deploys. Don't push straight to `main`.
- **Keep `npm run build` passing**, and run `npm test` for changes to rules, rounds or the phone/TV screens.
- **When editing `public/art.js`, screenshot every map**, not just the one you changed (`?host&demo=6&map=park|vietnam|jaffna|stovner|alesund`): an earlier change deleted another map's drawings unnoticed.
- No hardcoded secrets; the relay login is made at build time from `TURN_SECRET`.
