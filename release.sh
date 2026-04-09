#!/bin/bash
# Build Filey and publish as a GitHub Release
# Usage: npm run release              (uses current version)
#        bash release.sh 260403.1     (bumps to YYMMDD.N, converts to semver)

set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD_DIR="/tmp/filey-build"
cd "$PROJECT_DIR"

# Convert YYMMDD.N display version to semver YY.MDD.N
to_semver() {
  local v="$1"
  local yy="${v:0:2}"
  local mmdd="${v:2:4}"
  local n="${v##*.}"
  # Remove leading zeros from mmdd for semver
  mmdd=$((10#$mmdd))
  echo "${yy}.${mmdd}.${n}"
}

# Get or set version
if [ -n "$1" ]; then
  DISPLAY_VERSION="$1"
  SEMVER=$(to_semver "$DISPLAY_VERSION")
  node -e "
    const pkg = require('./package.json');
    pkg.version = '$SEMVER';
    require('fs').writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
  "
  echo "Version: $DISPLAY_VERSION (semver: $SEMVER)"
else
  SEMVER=$(node -p "require('./package.json').version")
  # Convert semver back to display: 26.402.1 -> 260402.1
  DISPLAY_VERSION=$(node -p "
    const [yy, mdd, n] = '$SEMVER'.split('.');
    yy + String(mdd).padStart(4, '0') + '.' + n;
  ")
  echo "Version: $DISPLAY_VERSION (semver: $SEMVER)"
fi

echo "=== Releasing Filey v${DISPLAY_VERSION} ==="

# Step 1: Bundle CLI tools
echo ""
echo "=== Step 1: Bundle CLI tools ==="
bash bundle-tools.sh

# Step 2: Build in /tmp (avoids iCloud xattr issues with codesign)
echo ""
echo "=== Step 2: Build Electron app ==="
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"

cp package.json package-lock.json electron-main.js server.js afterPack.js "$BUILD_DIR/" 2>/dev/null
cp -R public bin build "$BUILD_DIR/"

cd "$BUILD_DIR"
npm install 2>&1 | tail -3
npm install electron electron-builder --save-dev 2>&1 | tail -3
xattr -cr . 2>/dev/null
npx electron-builder --mac --arm64 --publish never

# Copy artifacts back
mkdir -p "$PROJECT_DIR/dist"
rm -f "$PROJECT_DIR/dist/"*.dmg "$PROJECT_DIR/dist/"*.zip "$PROJECT_DIR/dist/"*.yml "$PROJECT_DIR/dist/"*.blockmap
cp "$BUILD_DIR/dist/"*.dmg "$PROJECT_DIR/dist/" 2>/dev/null || true
cp "$BUILD_DIR/dist/"*.zip "$PROJECT_DIR/dist/" 2>/dev/null || true
cp "$BUILD_DIR/dist/"*.yml "$PROJECT_DIR/dist/" 2>/dev/null || true
cp "$BUILD_DIR/dist/"*.blockmap "$PROJECT_DIR/dist/" 2>/dev/null || true

# Step 3: Git commit and tag
echo ""
echo "=== Step 3: Git commit and tag ==="
cd "$PROJECT_DIR"
git add -A
git commit -m "Release v${DISPLAY_VERSION}" 2>/dev/null || echo "Nothing to commit"
git tag -f "v${DISPLAY_VERSION}"
git push origin main --tags --force

# Step 4: Create GitHub Release
echo ""
echo "=== Step 4: Create GitHub Release ==="
gh release delete "v${DISPLAY_VERSION}" --yes 2>/dev/null || true

# Find the actual filenames (they use semver)
# Only upload DMG (for users) and ZIP (for auto-updater). Skip yml and blockmaps.
DMG=$(ls "$PROJECT_DIR/dist/"*.dmg 2>/dev/null | grep -v blockmap | head -1)
ZIP=$(ls "$PROJECT_DIR/dist/"*-mac.zip 2>/dev/null | grep -v blockmap | head -1)

ASSETS=()
[ -f "$DMG" ] && ASSETS+=("$DMG")
[ -f "$ZIP" ] && ASSETS+=("$ZIP")

# Generate changelog from commits since last tag
PREV_TAG=$(git describe --tags --abbrev=0 HEAD^ 2>/dev/null || echo "")
if [ -n "$PREV_TAG" ]; then
  CHANGELOG=$(git log "${PREV_TAG}..HEAD" --pretty=format:"- %s" --no-merges | grep -v "Co-Authored-By" | head -20)
else
  CHANGELOG="Initial release"
fi

RELEASE_NOTES="## What's New

${CHANGELOG}
"

gh release create "v${DISPLAY_VERSION}" \
  --title "Filey v${DISPLAY_VERSION}" \
  --notes "$RELEASE_NOTES" \
  "${ASSETS[@]}"

echo ""
echo "=== Done! ==="
echo "Release: https://github.com/adamscooch/filey/releases/tag/v${DISPLAY_VERSION}"
echo ""
echo "MacBook Pro will auto-update next time you open Filey."
