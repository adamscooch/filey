#!/bin/bash
# Build Filey.app in /tmp to avoid macOS iCloud xattr issues with codesign
# iCloud-synced folders add com.apple.fileprovider.fpfs that breaks Electron codesign

set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD_DIR="/tmp/filey-build"

echo "=== Building Filey.app ==="
echo "Project: $PROJECT_DIR"
echo "Build dir: $BUILD_DIR (outside iCloud)"

# Clean previous build
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"

# Copy project files (not node_modules — fresh install is cleaner)
echo "Copying project files..."
cp "$PROJECT_DIR/package.json" "$BUILD_DIR/"
cp "$PROJECT_DIR/package-lock.json" "$BUILD_DIR/" 2>/dev/null || true
cp "$PROJECT_DIR/electron-main.js" "$BUILD_DIR/"
cp "$PROJECT_DIR/preload.js" "$BUILD_DIR/"
cp "$PROJECT_DIR/server.js" "$BUILD_DIR/"
cp "$PROJECT_DIR/afterPack.js" "$BUILD_DIR/"
cp -R "$PROJECT_DIR/public" "$BUILD_DIR/"
cp -R "$PROJECT_DIR/bin" "$BUILD_DIR/"
cp -R "$PROJECT_DIR/build" "$BUILD_DIR/"

# Fresh npm install (outside iCloud = no xattr issues)
echo "Installing dependencies..."
cd "$BUILD_DIR"
npm install --production 2>&1 | tail -3
npm install electron electron-builder --save-dev 2>&1 | tail -3

# Build
echo "Building Electron app..."
npx electron-builder --mac --arm64

# Copy DMG back
echo "Copying artifacts..."
mkdir -p "$PROJECT_DIR/dist"
cp "$BUILD_DIR/dist/"*.dmg "$PROJECT_DIR/dist/" 2>/dev/null || true
# Also copy the .app directly for testing
rm -rf "$PROJECT_DIR/dist/mac-arm64"
cp -R "$BUILD_DIR/dist/mac-arm64" "$PROJECT_DIR/dist/" 2>/dev/null || true

echo ""
echo "=== Build complete ==="
ls -lh "$PROJECT_DIR/dist/"*.dmg 2>/dev/null
du -sh "$PROJECT_DIR/dist/mac-arm64/Filey.app" 2>/dev/null
echo ""
echo "Install: open dist/Filey-*.dmg and drag to Applications"
echo "Deploy:  npm run deploy:macbook"
