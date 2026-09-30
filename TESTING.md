# Trying the `comment-on-output` branch

This branch lets you comment on an agent's output, dictate into those comments, and turn on a
keyboard caret for moving through agent output. These steps run it as a separate dev app next to
your normal Paseo, without changing your normal install.

## Setup

```bash
git clone https://github.com/leonardourci/paseo
cd paseo
git checkout comment-on-output
```

Use Node 22 (`.tool-versions` pins 22.20.0, and CI runs Node 22). Then install dependencies and
build the packages the app and its daemon load from their build output:

```bash
npm install
npm run build:app-deps
npm run build:server
```

## Keep it apart from your normal Paseo

The dev app keeps everything inside the clone's `.dev/` folder. Its daemon uses `.dev/paseo-home`
as its home and listens on port 6768, and Electron keeps its profile in `.dev/user-data`. Your
normal Paseo uses `~/.paseo` and port 6767, so it isn't touched.

Before the first start, create the dev home's config with relay off and skill syncing off:

```bash
mkdir -p .dev/paseo-home
cat > .dev/paseo-home/config.json <<'EOF'
{"version":1,"daemon":{"relay":{"enabled":false}},"agents":{"skills":{"selection":{"mode":"custom","skills":[]}}}}
EOF
```

Without the skills setting, the dev daemon installs and updates Paseo's skills in your agents' own
folders, such as `~/.claude/skills`, which your normal Paseo also manages. The start script keeps
this file and only adds its listen address and CORS setting to it.

## Start

```bash
env -u PASEO_HOME -u PASEO_CLI -u PASEO_AGENT_ID -u PASEO_AGENT_CWD npm run dev:desktop
```

A terminal opened inside Paseo exports these variables, and `PASEO_HOME` would make the dev app use
your real `~/.paseo` instead of `.dev/paseo-home`. `env -u` removes them for this one command; in
any other terminal it changes nothing.

In the dev app, don't press **Install** under **Settings → Integrations → Command line**. It would
point your `paseo` command at this checkout.

## Use your real sessions (optional)

The dev daemon starts empty. To see your real agents in the dev app, connect it to your normal
daemon with a pairing link:

1. In your normal Paseo, open **Settings → your host → Pair device**. If relay is off, it asks to
   enable it; pairing links go through the relay. Copy the link under the QR code. Running
   `paseo daemon pair` in a terminal prints the same link.
2. In the dev app, open **Settings → Add host → Paste pairing link** and paste it.

## What to try

**Comments.** Select text in an agent's reply, then:

- Start typing, or press **Comment** in the toolbar under the selection, to add a pending comment.
- Press **Quote** to add the passage to the composer as a blockquote.
- Paste over a selection, or start dictation with the mic while text is selected: the text lands
  in a comment on the selection.
- In a note, type `@` to mention a file or `/` for a skill.
- Paste or drop images into a note.
- Send a message: the comments show as a card on your message, and stay highlighted on the reply.
- Remove all pending comments with the ✕ on the composer's comments pill (it asks first).

**Keyboard caret.** Turn on **Settings → General → Keyboard caret → Keyboard caret in output**,
then:

- In a reply, move with the arrow keys, jump by word with Option+arrows (Ctrl+arrows on Windows
  and Linux), and select with Shift.
- Press Up at the very start of the composer to move into the output, and Down past the end of
  the output to go back.
- Press ⌘L (Ctrl+L on Windows and Linux) in the composer to jump to the latest reply, and again to
  come back.
- With text selected, Enter starts a comment and Shift+Enter quotes it.
- Change how many lines the chat keeps above and below the caret in the same settings section.

The caret only works in Chromium-based browsers and the desktop app: not in Firefox or Safari
before 17.4, on touch screens, or in narrow layouts.

## Feedback

Share what you find in the discussion: https://github.com/getpaseo/paseo/discussions/5228
