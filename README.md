# Nova Proxy

The server behind Nova: the Wisp proxy (`/wisp/`), the Nova Shell page (`/`),
and the multiplayer relay for the games (`/mp/`). The proxy is password
protected: people log in once and their browser remembers them.

## Run it on your computer

You need [Node.js](https://nodejs.org) (the LTS version) installed. That's it.

| Computer | How to start |
|----------|--------------|
| Windows  | Double-click `start.bat` |
| Mac      | Double-click `start.command` (the first time, right-click it and choose **Open**) |
| Linux    | Run `./start.sh` in a terminal |

Or from any terminal in this folder: `npm install` once, then `npm start`.

**The first time**, it installs its packages and asks you to pick a password.
The password is saved in `nova-config.json`, which is never uploaded to GitHub.
After that, starting it just starts it.

When it's running you'll see:

```
Nova Shell is running.
  On this computer:   http://localhost:8080
  On your Wi-Fi:      http://192.168.x.x:8080
  Wisp address:       ws://localhost:8080/wisp/
```

Keep that window open. Close it, or press Ctrl+C, to stop the server.

## Change the password

```
npm run set-password
```

Everyone who was logged in will need the new password.

## Use it from anywhere (not just your Wi-Fi)

Your computer isn't reachable from the internet by default. A tunnel gives it a
public address without changing your router. With
[cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
installed, in a second terminal:

```
cloudflared tunnel --url http://localhost:8080
```

It prints an `https://something.trycloudflare.com` address. In the Nova site,
open **Settings → Proxy**, enter `wss://something.trycloudflare.com/wisp/`, and
press **Save & Reconnect**. That free address changes every time you restart
the tunnel.

## Settings

All optional. Set them as environment variables.

| Variable | What it does | Default |
|----------|--------------|---------|
| `PROXY_PASSWORD` | The password. Wins over `nova-config.json`. Use this on hosts like Fly.io (`fly secrets set PROXY_PASSWORD=...`). | asks on first run |
| `PORT` | Port to listen on | `8080` |
| `TOKEN_DAYS` | How long a login is remembered | `180` |
