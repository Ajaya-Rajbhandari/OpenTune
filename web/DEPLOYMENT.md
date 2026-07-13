# Deploying OpenTune Web (personal / household)

This is the guide for running OpenTune Web so you — and people in your household — can reach it from
anywhere, not just the machine it runs on. It is **not** a guide for a public service: everyone who
holds the access token browses and plays as the one signed-in YouTube account, so treat the token
like a house key and only share it with people you would hand a key to.

The pieces:

- The **server** (`webapi`) runs on a machine at home. It holds your YouTube session and, since the
  audio proxy landed, streams the audio itself — so playback works off your home network.
- A **Cloudflare Tunnel** gives that server a public HTTPS address without opening any ports on your
  router.
- The **access token** guards the API. It is rate-limited and rotatable.

Everything below has been exercised end to end: the tunnel serves the app over real HTTPS, the token
gate holds over the public internet, and audio is proxied through the server rather than fetched
directly from YouTube (which would 403 off your home IP).

---

## Prerequisites

- **A JDK 21** for the server. Homebrew: `brew install openjdk@21` (then its home is
  `/opt/homebrew/opt/openjdk@21`). The JDK bundled with Android Studio also works, but a standalone
  one is steadier for a long-running service.
- **`yt-dlp` on PATH** (`brew install yt-dlp`) for the stream-resolution fallback.
- **`cloudflared`** (`brew install cloudflared`) for the tunnel.
- You are **signed in** to YouTube in OpenTune Web already (via the browser helper or by pairing with
  Android). Deployment does not change how you log in.

---

## Build once

```sh
webapi/deploy/build.sh
```

This builds the web-app bundle (`web-app/dist`) and the server distribution
(`webapi/build/install/webapi/bin/webapi`). Re-run it after pulling changes. Set `OPENTUNE_JAVA_HOME`
if your JDK 21 is not at the Android Studio default.

## Run the server

By hand, to try it:

```sh
webapi/deploy/run.sh
```

It prints the access URLs and the token. Leave it running. (To keep it up across reboots, see
**Keep it running** below.)

---

## Step 1 — prove it works with a quick tunnel (no domain, nothing to buy)

In a second terminal:

```sh
cloudflared tunnel --url http://127.0.0.1:8080
```

cloudflared prints a URL like `https://<random-words>.trycloudflare.com`. Open it on your phone **over
mobile data** (not home Wi-Fi) as:

```
https://<random-words>.trycloudflare.com/?token=YOUR_TOKEN
```

Your token is in `~/.config/opentune-web/access-token`. The app captures the token, strips it from the
address bar, and plays. Confirm a song plays over cellular — that is the whole point: audio is being
proxied through your server, so it works away from home.

**Catch:** a quick tunnel's URL changes every time you restart it. Fine for testing; for daily use,
do step 2.

---

## Step 2 — make it permanent with your own domain

This needs a domain added to Cloudflare (any cheap one works). One-time setup:

```sh
cloudflared tunnel login                 # opens a browser; authorise your Cloudflare account
cloudflared tunnel create opentune       # note the tunnel UUID it prints
cloudflared tunnel route dns opentune music.yourdomain.com
```

Copy `webapi/deploy/cloudflared-config.example.yml` to `~/.cloudflared/config.yml` and fill in the
UUID, your home directory, and your hostname. Then:

```sh
cloudflared tunnel run opentune
```

Your stable URL is now `https://music.yourdomain.com`. Bookmark it with `?token=YOUR_TOKEN` once; the
app remembers the token afterwards.

---

## Keep it running (survives reboots)

Two launchd jobs, templates in `webapi/deploy/`:

- `com.opentune.web.plist.example` — the server.
- `com.opentune.tunnel.plist.example` — the named tunnel (step 2 only).

For each: replace the `REPLACE_ME` values, copy to `~/Library/LaunchAgents/` without the `.example`
suffix, then `launchctl load -w ~/Library/LaunchAgents/<name>.plist`. Logs land in `~/Library/Logs/`.

---

## Sharing with household members

Send each person the URL with the token, over a private channel (not a public post):

```
https://music.yourdomain.com/?token=YOUR_TOKEN
```

Remember: they will be using **your** YouTube account. Their listening shapes your recommendations,
and there is one shared queue of who-is-signed-in. This is fine for a household; it is why this is not
a public deployment.

---

## If the token leaks

Rotate it. Any request holding the current token can do this:

```sh
curl -X POST -H "X-OpenTune-Token: CURRENT_TOKEN" https://music.yourdomain.com/api/auth/token/rotate
```

It returns a fresh token and **every old link stops working immediately**. Re-share the new one. (If
the token is pinned by the `OPENTUNE_WEB_TOKEN` environment variable, rotation is refused — change the
variable and restart instead.)

---

## Security notes

- The server binds every interface so the tunnel and LAN devices can reach it. The token is the gate;
  wrong-token attempts are rate-limited per caller (Cloudflare passes the real client IP through
  `CF-Connecting-IP`, so one abuser cannot lock everyone out).
- Your YouTube session lives at `~/.config/opentune-web/auth-session.json`, owner-readable only. It
  never leaves your machine except as the audio and browse results the app already shows.
- A datacenter/VPS is a poor host: YouTube bot-checks cloud IPs far more aggressively and you cannot
  mint PO tokens. Home hosting keeps your residential IP, which is the friendliest path.
