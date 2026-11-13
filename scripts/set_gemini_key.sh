#!/bin/sh
# Store a Gemini API key without it appearing on screen, in shell history or in a process list:
# writes GEMINI_API_KEY into .env (git-ignored) and, if this folder is linked to a Vercel
# project, adds it there as a sensitive production variable.
set -eu
cd "$(dirname "$0")/.."

printf 'Paste your Gemini API key and press Enter (input is hidden): '
stty -echo
IFS= read -r KEY
stty echo
printf '\n'

KEY=$(printf '%s' "$KEY" | tr -d '[:space:]')
if [ -z "$KEY" ]; then
  echo "No key entered; nothing changed."
  exit 1
fi
# Hidden input gives no feedback, so pasting twice is easy: keep one copy.
LEN=${#KEY}
if [ $((LEN % 2)) -eq 0 ]; then
  HALF=$((LEN / 2))
  FIRST=$(printf '%s' "$KEY" | cut -c1-"$HALF")
  SECOND=$(printf '%s' "$KEY" | cut -c$((HALF + 1))-)
  if [ "$FIRST" = "$SECOND" ]; then
    KEY=$FIRST
    echo "The key was pasted twice; kept one copy."
  fi
  unset FIRST SECOND
fi
echo "Got a key of ${#KEY} characters."

[ -f .env ] || cp .env.example .env
# Rewrite .env with the key line replaced (or appended), keeping every other line.
TMP=$(mktemp)
KEY="$KEY" awk 'BEGIN { done = 0 }
  /^GEMINI_API_KEY=/ { print "GEMINI_API_KEY=" ENVIRON["KEY"]; done = 1; next }
  { print }
  END { if (!done) print "GEMINI_API_KEY=" ENVIRON["KEY"] }' .env > "$TMP"
mv "$TMP" .env
chmod 600 .env
echo "Saved to .env (git-ignored)."

if [ -f .vercel/project.json ]; then
  printf '%s' "$KEY" | npx --yes vercel@65.15.0 env add GEMINI_API_KEY production --sensitive --force >/dev/null 2>&1 \
    && echo "Added to the Vercel project as a sensitive production variable." \
    || echo "Could not add it to Vercel; .env was still updated."
fi
unset KEY
echo "Done. You can close this tab."
