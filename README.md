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

## Known limits

- Movement waits for the server's reply, so on a slow connection it feels slightly delayed. Client-side prediction would fix that.
- One server instance. Fine for friends and small groups. Thousands of players would need more work.
- No round timer yet, so a player who hides can drag a match out.
