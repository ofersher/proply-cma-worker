#!/usr/bin/env bash
# Start the X virtual framebuffer in the BACKGROUND on display :99, then exec
# node. This replaces `xvfb-run`, whose display-lock / --auto-servernum
# negotiation hangs the container on Railway BEFORE node ever runs (Deploy Logs
# showed only "Starting Container", never "boot: starting"). Headed Chromium
# connects to :99. exec hands PID over to node so SIGTERM reaches it.
Xvfb :99 -screen 0 1280x1024x24 -nolisten tcp &
export DISPLAY=:99
# brief readiness margin so Chromium never races a not-yet-ready display
sleep 1
exec npx tsx src/index.ts
