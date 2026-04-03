#!/bin/bash
# Deploy Filey to MacBook Pro: SCP DMG, install with ditto, re-sign
set -e

DMG=$(ls -t dist/Filey-*.dmg 2>/dev/null | head -1)
if [ -z "$DMG" ]; then echo "No DMG found in dist/. Run npm run build first."; exit 1; fi

echo "Deploying $(basename "$DMG") to MacBook Pro..."

scp "$DMG" adamanderson@adams-macbook-pro:~/Desktop/

ssh adamanderson@adams-macbook-pro "
  osascript -e 'quit app \"Filey\"' 2>/dev/null
  sleep 1
  rm -rf /Applications/Filey.app
  DMG=\$(ls ~/Desktop/Filey-*.dmg | head -1)
  hdiutil attach \"\$DMG\" -nobrowse -quiet
  ditto /Volumes/Filey/Filey.app /Applications/Filey.app
  xattr -cr /Applications/Filey.app
  codesign --force --deep --sign - /Applications/Filey.app
  hdiutil detach /Volumes/Filey -quiet
  rm \"\$DMG\"
  echo 'Filey installed and signed.'
"

echo "Done."
