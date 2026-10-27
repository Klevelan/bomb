# Bomb Room

Bomberman-style arena game. Play online with friends (room codes or quick match), solo against bots, or two players on one keyboard. Installs on phones as an app.

## Run it on your computer

Needs [Node.js](https://nodejs.org) 18 or newer.

```bash
npm install
npm start
```

Open http://localhost:3000. To test multiplayer, open a second browser window (or an incognito window) and join the room code.

**Phone on the same Wi-Fi:** find your PC's local IP (`ipconfig` on Windows, look for IPv4, e.g. `192.168.1.23`) and open `http://192.168.1.23:3000` on the phone. Windows may ask to allow Node through the firewall. Installing as an app only works once it's on HTTPS (see below).

## Put it online (Render)

1. Push this folder to a GitHub repository.
2. On [render.com](https://render.com), choose **New → Blueprint** and pick the repo. It reads `render.yaml` and sets everything up. (Or **New → Web Service** with build command `npm install` and start command `npm start`.)
3. You get an address like `https://bomb-room-xxxx.onrender.com`. Share it with friends.

Free plan notes:
- The server goes to sleep after 15 minutes with no visitors. The next visitor wakes it, which takes about a minute. The app shows "Connecting…" meanwhile.
- A match in progress keeps it awake.
- Rooms live in memory, so a restart or redeploy ends running matches.
- 750 free hours per month, which covers one service running all month.

A paid instance removes the sleep.

## Install on a phone

- **Android (Chrome):** open the site and tap **Install app** on the menu, or use the ⋮ menu → *Add to Home screen*.
- **iPhone (Safari):** tap **Share** → **Add to Home Screen**.

It then opens full screen with its own icon. Solo play works offline once installed.

## Later: App Store / Google Play

The project is set up for [Capacitor](https://capacitorjs.com), which wraps the `public/` folder as a native app.

1. In `public/config.js`, set your server address:
   `window.BOMBROOM_SERVER = 'wss://bomb-room-xxxx.onrender.com';`
2. Add Capacitor:
   ```bash
   npm install @capacitor/core @capacitor/cli @capacitor/android @capacitor/ios
   npx cap init "Bomb Room" no.yourname.bombroom --web-dir public
   npx cap add android
   npx cap add ios        # needs a Mac with Xcode
   npx cap open android   # opens Android Studio to build and run
   ```
3. Publishing needs a Google Play developer account and, for iOS, an Apple Developer Program membership and a Mac.

## How it works

| File | What it does |
|---|---|
| `public/game.js` | All game rules and the bots. Used by both the browser (solo/local) and the server (online). |
| `public/render.js` | Draws the board on a canvas (your original renderer). |
| `public/app.js` | Menus, lobby, controls, connection to the server. |
| `public/index.html` | Layout and styles. |
| `public/sw.js`, `manifest.webmanifest`, `icons/` | Makes it installable and lets offline modes work without internet. |
| `server/index.js` | Serves the app and runs online rooms. The server is the referee: phones send button presses, the server runs the match ~30 times a second and sends everyone the result. |

Online features: quick match (starts 10 s after a second player joins, instantly at 4), private rooms with 4-letter codes and invite links (`/?room=CODE`), host settings (bot difficulty, fill empty seats with bots), spectators join the next round, and automatic reconnect if a phone sleeps or loses signal for a moment.

## Coins and shop

Players earn coins after every match and spend them in the **Shop** on characters, bomb effects and map themes. Prices live in `public/cosmetics.js` and rewards in `public/profile.js` (`REWARD` at the top), so balancing is a one-line change.

| Reward | Coins |
|---|---|
| Finishing a match | 5 |
| Each crate you blow up (max 20) | 1 |
| Each knockout | 5 |
| Solo win (easy / medium / hard) | 15 / 30 / 60 |
| Online win | 40 + 20 per human opponent |
| Local duel finished with a winner | 10 |
| First win of the day (solo or online) | +50 |

Coins and unlocks are saved on the device (browser storage), so they don't follow a player to a new phone, and clearing site data resets them.

## Arenas and sudden death

Five arena layouts: **Classic**, **Open Field**, **Fortress**, **Crossroads** and **Labyrinth** (`LAYOUTS` in `public/game.js`). Solo players pick one on the menu, online hosts pick one in the lobby, or leave it on Random. Every layout is mirror-symmetric so no spawn corner has an advantage.

After 2 minutes, sudden death starts: the walls close in from all four sides at once, with red warnings on the next tiles. Every match ends.

## Ranks and leaderboard

Online matches with **at least 2 real players** are ranked. Each pair of players counts as a duel decided by who lasted longer (Elo rating, everyone starts at 1000), so finishing 2nd of 4 still earns points. Leaving mid-match counts as being knocked out at that moment.

| Rank | Points |
|---|---|
| Bronze | under 1000 |
| Silver | 1000+ |
| Gold | 1150+ |
| Platinum | 1300+ |
| Diamond | 1450+ |
| Master | 1600+ |

A player's ranking is tied to their device (the same id used for reconnecting), so it doesn't follow them to a new phone.

### Setting up the free database (Neon)

Without a database the leaderboard works but **resets every time the server sleeps or restarts**. To keep it permanently:

1. Sign up at [neon.com](https://neon.com) (free plan) and create a project. Pick a region close to your Render service (e.g. Frankfurt).
2. On the project dashboard, click **Connect** and copy the connection string. It looks like
   `postgresql://user:password@ep-something.eu-central-1.aws.neon.tech/neondb?sslmode=require`
3. On Render, open your service → **Environment** → **Add Environment Variable**:
   - Key: `DATABASE_URL`
   - Value: the connection string
4. Save. Render redeploys. In the service's **Logs** you should see `Leaderboard storage: postgres`.

The server creates its table automatically. Keep the connection string secret: it's the password to your database, so never put it in a GitHub file.

Neon's free plan pauses the database after 5 minutes without use and wakes it on the next request, so the first leaderboard load after a quiet period can take a moment.

## Known limits

- Movement waits for the server's reply, so on a slow connection it feels slightly delayed. Client-side prediction would fix that.
- One server instance. Fine for friends and small groups. Thousands of players would need more work.
- Player names on the leaderboard aren't filtered, so someone could pick an offensive name.
