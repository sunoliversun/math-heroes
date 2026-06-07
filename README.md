# 🦸 Math Heroes: The Five Realms

A 3-D superhero math adventure for kids under 12. Players become superheroes,
explore five magical biomes, solve adaptive math puzzles to collect glowing
crystals, earn points and coins, and graduate from realm to realm until they
claim the **Golden Trophy** — at which point a brand-new, tougher adventure
begins. Play solo or with friends in real time using a shared **room code**.

Built with **Three.js** (browser 3-D, no plugins) and a **Node.js + WebSocket**
multiplayer server. No build step, no game-engine install — just `npm start`.

---

## ✨ Features

- **5 adventure stages, each a different biome**
  1. 🏜️ Sunscorch **Desert**
  2. 🐊 Mistmarsh **Swamp**
  3. ⛰️ Thunder **Rocky Edge**
  4. 🌲 Whisperwood **Forest**
  5. ❄️ Frostfall **Ice Age / Snow** — home of the Golden Trophy
- **Real-time multiplayer** via 4-letter room codes (up to 8 heroes/room). See
  friends move around the world live, share the same puzzle crystals, and race
  up a shared leaderboard.
- **Adaptive math** (ages 5–12): counting, addition, subtraction, multiplication,
  division, patterns and fractions. Difficulty scales by stage **and** by each
  child's recent accuracy — strong solvers get harder questions, strugglers get
  easier ones. Answers are never negative; division is always whole-number.
- **Progression & trophy reset**: hit a stage's point goal to advance. Win the
  final stage to earn a trophy 🏆 — the whole journey restarts with fresh, harder
  puzzles while your coins and cosmetics carry over.
- **Coin shop & character customization**: spend earned coins on colors, capes,
  hats, particle trails, and power-ups (Hint Helper, Coin Booster).
- **Realistic procedural visuals**: noise-displaced rolling terrain (the hero
  actually walks up and down the hills), PBR ground textures with normal maps
  (sand, moss, rock, snow), a physical sky with atmospheric scattering and
  image-based lighting, reflective water in the swamp and ice realms, dense
  instanced vegetation (saguaro cacti, trees, rocks, grass, ice spires), soft
  shadows, ACES filmic tone mapping and bloom — all generated in-browser with
  no external model or texture files.
- **Kid-friendly design**: big buttons, bright colors, gentle sounds, encouraging
  feedback ("Oops! Try the next one"), no scary fail states, no text-heavy menus.
- **Touch controls** (on-screen joystick + jump) for tablets, plus full
  keyboard/mouse on desktop.
- **Procedural audio** — happy sound effects and soft background music are
  synthesized in-browser (no audio files to download).
- **Saved profiles** — kids can optionally add a 4-digit PIN to keep their coins,
  costumes, trophies and progress across sessions (guests can still play instantly).
- **Parent/teacher dashboard** — a passcode-protected page showing each child's
  stage, trophies, math accuracy per skill, puzzles solved and play time, with
  CSV export.

---

## 🚀 Getting started

```bash
npm install      # installs the one dependency (ws)
npm start        # starts the server on http://localhost:3000
```

Then open **http://localhost:3000** in a browser.

- Click **🚀 Start New Game** to create a room — your 4-letter code appears in the
  top bar (📋 copies it).
- Friends open the same URL, type the code, and click **Join Friend**.

> To play across different devices, host the server somewhere reachable (set the
> `PORT` env var as needed) and share its address. WebSockets auto-upgrade to
> `wss://` when served over HTTPS.

---

## 🎮 How to play

- **Move**: `WASD` or arrow keys (on-screen joystick on touch devices)
- **Jump**: `Space` (or the ⤴︎ button)
- **Solve a puzzle**: walk your hero into a glowing crystal orb — a math question
  pops up. Pick the right answer to collect the crystal, earn points + coins, and
  build a **streak** for bonus points.
- **Advance**: fill the stage progress bar to its goal to portal to the next realm.
- **Win**: clear all five realms to grab the Golden Trophy, then enjoy a fresh
  adventure.
- **Shop**: tap **🛍️ Shop** anytime to spend coins on customizations.
- **Chat**: press `Enter` to talk to friends in your room.

---

## 👧 Saved heroes (optional accounts)

On the start screen a child can type their hero name + a **4-digit PIN** and tap
**✨ New Hero** to create a saved profile, or **🔑 Log In** to return to one.
Logged-in heroes keep their coins, costumes, owned shop items, and trophies
forever. No email, no personal data — just a name and a PIN. Skipping this and
playing as a guest works exactly as before.

Profiles are stored server-side in `data/profiles.json` (PINs are salted +
hashed, never stored in plain text).

## 📊 Parent & Teacher dashboard

Visit **`/dashboard`** and enter the teacher passcode (default `teach1234`,
override with the `TEACHER_PASSCODE` env var). You'll see, per child:

- highest stage reached, total score, trophies, coins
- puzzles solved and **overall accuracy**
- **accuracy for each math skill** (counting, +, −, ×, ÷, patterns, fractions) —
  color-coded so you can spot what to practice
- total play time and last-seen date
- sortable columns, name search, and **Export CSV**

The dashboard reads `GET /api/dashboard?pass=<passcode>` (returns JSON), so you
can also pull the data into a spreadsheet or your own tools.

## 🗂️ Project structure

```
Xgame/
├── package.json
├── README.md
├── shared/                 # code shared by server, client, and tests
│   ├── config.js           # stages/biomes, shop catalogue, economy, seeded RNG
│   └── mathEngine.js       # adaptive puzzle generator (pure, deterministic)
├── server/
│   ├── server.js           # HTTP/static + WebSocket multiplayer + dashboard API
│   ├── gameState.js        # authoritative rooms, players, scoring (no I/O)
│   └── store.js            # persistent profile store (accounts, stats)
├── public/                 # browser client
│   ├── index.html
│   ├── dashboard.html      # parent/teacher analytics dashboard
│   ├── css/style.css
│   └── js/
│       ├── main.js         # game loop + glue + renderer/tone-mapping
│       ├── net.js          # WebSocket client
│       ├── world.js        # terrain, sky, water, vegetation, bloom
│       ├── textures.js     # procedural PBR ground/water/bark textures
│       ├── noise.js        # seedable value-noise + fbm (terrain & textures)
│       ├── player.js       # hero meshes, cosmetics, terrain-following physics
│       ├── ui.js           # DOM: start, accounts, HUD, puzzles, shop, chat
│       └── audio.js        # procedural sound effects + music
├── Dockerfile, render.yaml, fly.toml   # deployment
├── test/                   # unit tests (node --test)
│   ├── mathEngine.test.js
│   └── gameState.test.js
└── scripts/
    └── integration.mjs     # live end-to-end WebSocket test
```

---

## 🧪 Testing

```bash
npm test          # 40 unit tests: math engine + game logic + profile store (no server needed)
npm run test:e2e  # 27 live checks against a running server (run `npm start` first)
```

**Unit tests** cover puzzle determinism, the 4-choice/non-negative/whole-number
guarantees, adaptive difficulty, scoring, streaks, stage progression, the full
trophy-and-reset cycle, the shop economy (buy / can't-afford / free re-equip /
coin booster), room management, a **balance guard** that asserts every stage is
completable even with zero streak, and the profile store (register/login,
PIN hashing, persistence round-trip, per-skill stats, dashboard aggregation).

**The end-to-end test** spins up two networked players plus a solo champion to
verify: room creation, joining by code, bad-code rejection, live movement sync,
puzzle delivery (and that the answer is *never* sent to the client), scoring,
cross-client world sync when an orb is collected, the leaderboard broadcast, a
shop purchase, chat, a complete 5-stage run to the trophy, and the full
account flow — register, earn coins, reconnect, confirm coins persisted, wrong-PIN
rejection, and the passcode-protected dashboard API reporting the child's stats.

---

## 🌍 Deploying free (Render + Neon)

Host the whole game on a **100% free** stack — no credit card:

- **Render free web service** runs the Node + WebSocket server (multiplayer works).
- **Neon free Postgres** stores kid profiles so they survive redeploys/restarts.

### Step-by-step (≈5 minutes)

**1. Put the code on GitHub.** From the project folder:
```bash
git init && git add -A && git commit -m "Math Heroes"
gh repo create math-heroes --public --source=. --push   # or push manually
```

**2. Create a free database** at <https://neon.tech> → New Project → copy the
**connection string** (looks like `postgresql://user:pass@ep-xxx.neon.tech/db?sslmode=require`).

**3. Deploy to Render.** Click the button (or New → Blueprint and pick your repo):

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy)

Render reads `render.yaml`. When prompted, set two environment variables:

| Variable | Value |
|----------|-------|
| `DATABASE_URL` | the Neon connection string from step 2 |
| `TEACHER_PASSCODE` | any secret you like (dashboard login) |

**4. Play.** Render gives you a URL like `https://math-heroes.onrender.com`. The
game is there; the dashboard is at `…/dashboard`. WebSockets auto-upgrade to
`wss://` over HTTPS — nothing else to configure.

> Free Render services sleep after ~15 min idle and cold-start in a few seconds;
> profiles are safe in Neon regardless. If `DATABASE_URL` is omitted the server
> falls back to local file storage (fine locally, resets on each redeploy).

### Other hosts

Any Node + WebSocket host works. Environment variables:

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `3000` | HTTP/WebSocket port |
| `DATABASE_URL` | _(unset)_ | Postgres connection string for persistent profiles |
| `DATA_DIR` | `./data` | File-storage location (used only when no `DATABASE_URL`) |
| `TEACHER_PASSCODE` | `teach1234` | Dashboard passcode (set your own!) |

**Docker** (with your own Postgres):
```bash
docker build -t math-heroes .
docker run -p 3000:3000 -e DATABASE_URL=postgres://… \
  -e TEACHER_PASSCODE=your-secret math-heroes
```

**Fly.io**: `fly launch --copy-config && fly secrets set DATABASE_URL=… TEACHER_PASSCODE=… && fly deploy`

## 🔧 Design notes

- **Server-authoritative**: the server generates and validates every puzzle and
  owns all scores, so answers can't be read or spoofed from the client.
- **Deterministic worlds**: orb layouts and scenery come from a seeded RNG keyed
  by room code + stage + adventure number, so every player in a room sees the
  exact same world, and a won-and-reset adventure produces a new layout.
- **Puzzle stability**: the puzzle a child sees is cached and is exactly the one
  validated on submit, so adaptive difficulty can't shift mid-question.
```
