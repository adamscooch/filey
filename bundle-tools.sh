#!/bin/bash
# Bundle all CLI tools and their dylib dependencies for Electron packaging
# Run this before electron-builder to populate the bin/ directory

set -e

DEST="$(dirname "$0")/bin"
rm -rf "$DEST"
mkdir -p "$DEST" "$DEST/mozjpeg" "$DEST/lib"

echo "=== Bundling Filey CLI tools ==="

# List of binaries to bundle
BINARIES=(
  /opt/homebrew/bin/ffmpeg
  /opt/homebrew/bin/ffprobe
  /opt/homebrew/opt/mozjpeg/bin/jpegtran
  /opt/homebrew/opt/mozjpeg/bin/cjpeg
  /opt/homebrew/bin/jpegoptim
  /opt/homebrew/bin/oxipng
  /opt/homebrew/bin/pngquant
  /opt/homebrew/bin/advpng
  /opt/homebrew/bin/zopflipng
  /opt/homebrew/bin/gifsicle
  /opt/homebrew/bin/gifski
  /opt/homebrew/bin/gs
)

# Resolve @rpath references to actual file paths
resolve_rpath() {
  local lib="$1"
  local binary="$2"
  local libname=$(basename "$lib")
  local bindir=$(dirname "$binary")
  # Try common rpath locations
  for candidate in "$bindir/$libname" "$bindir/lib/$libname" "/opt/homebrew/lib/$libname" "/usr/local/lib/$libname"; do
    if [ -f "$candidate" ]; then
      echo "$candidate"
      return
    fi
  done
}

# Recursively find all non-system dylibs a binary depends on
find_dylibs() {
  local binary="$1"
  local seen="$2"

  otool -L "$binary" 2>/dev/null | tail -n +2 | awk '{print $1}' | while read -r lib; do
    # Skip system libraries (they exist on all macOS)
    case "$lib" in
      /usr/lib/*|/System/*|@loader_path/*|@executable_path/*) continue ;;
    esac

    # Resolve @rpath references to real paths
    local resolved="$lib"
    if [[ "$lib" == @rpath/* ]]; then
      resolved=$(resolve_rpath "$lib" "$binary")
      if [ -z "$resolved" ]; then continue; fi
    fi

    # Skip if already seen
    if echo "$seen" | grep -qF "$resolved"; then
      continue
    fi

    if [ -f "$resolved" ]; then
      echo "$resolved"
      # Recurse into this dylib's dependencies
      find_dylibs "$resolved" "$seen
$resolved"
    fi
  done
}

# Copy a binary and fix its dylib references
copy_and_fix() {
  local src="$1"
  local dest_dir="$2"
  local name=$(basename "$src")
  local dest="$dest_dir/$name"

  cp "$src" "$dest"
  chmod 755 "$dest"

  # Fix dylib references to point to ../lib/ (relative to binary)
  otool -L "$dest" 2>/dev/null | tail -n +2 | awk '{print $1}' | while read -r lib; do
    case "$lib" in
      /usr/lib/*|/System/*|@loader_path/*|@executable_path/*) continue ;;
    esac
    local libname=$(basename "$lib")
    if [[ "$lib" == @rpath/* ]]; then
      install_name_tool -change "$lib" "@loader_path/lib/$libname" "$dest" 2>/dev/null || true
    else
      install_name_tool -change "$lib" "@loader_path/lib/$libname" "$dest" 2>/dev/null || true
    fi
  done
}

# Copy a dylib and fix its references
copy_and_fix_dylib() {
  local src="$1"
  local name=$(basename "$src")
  local dest="$DEST/lib/$name"

  if [ -f "$dest" ]; then return; fi

  cp "$src" "$dest"
  chmod 644 "$dest"

  # Fix the dylib's own id
  install_name_tool -id "@loader_path/$name" "$dest" 2>/dev/null || true

  # Fix references to other dylibs
  otool -L "$dest" 2>/dev/null | tail -n +2 | awk '{print $1}' | while read -r lib; do
    case "$lib" in
      /usr/lib/*|/System/*|@loader_path/*|@executable_path/*) continue ;;
    esac
    local libname=$(basename "$lib")
    install_name_tool -change "$lib" "@loader_path/$libname" "$dest" 2>/dev/null || true
  done
}

# Process each binary
for bin in "${BINARIES[@]}"; do
  if [ ! -f "$bin" ]; then
    echo "  SKIP: $bin (not found)"
    continue
  fi

  name=$(basename "$bin")

  # mozjpeg tools go in mozjpeg/ subdir
  if [[ "$bin" == *"/mozjpeg/"* ]]; then
    dest_dir="$DEST/mozjpeg"
  else
    dest_dir="$DEST"
  fi

  echo "  COPY: $name"
  copy_and_fix "$bin" "$dest_dir"

  # Find and copy all dylib dependencies
  dylibs=$(find_dylibs "$bin" "")
  for dylib in $dylibs; do
    libname=$(basename "$dylib")
    if [ ! -f "$DEST/lib/$libname" ]; then
      echo "    LIB: $libname"
      copy_and_fix_dylib "$dylib"
    fi
  done
done

# Fix mozjpeg binaries to look in ../lib/ instead of lib/
for f in "$DEST/mozjpeg/"*; do
  [ -f "$f" ] || continue
  otool -L "$f" 2>/dev/null | tail -n +2 | awk '{print $1}' | while read -r lib; do
    case "$lib" in
      @loader_path/lib/*)
        libname=$(basename "$lib")
        install_name_tool -change "$lib" "@loader_path/../lib/$libname" "$f" 2>/dev/null || true
        ;;
    esac
  done
done

# Bundle svgo (Node.js tool - just need the binary wrapper)
if command -v svgo &>/dev/null; then
  SVGO_PATH=$(which svgo)
  SVGO_REAL=$(readlink -f "$SVGO_PATH" 2>/dev/null || realpath "$SVGO_PATH" 2>/dev/null || echo "$SVGO_PATH")

  # svgo is an npm global - bundle it as a standalone via node_modules
  echo "  COPY: svgo (npm package)"
  mkdir -p "$DEST/node_modules"
  # Find the svgo package directory
  SVGO_PKG_DIR=$(node -e "console.log(require.resolve('svgo/package.json').replace('/package.json',''))" 2>/dev/null || true)
  if [ -n "$SVGO_PKG_DIR" ] && [ -d "$SVGO_PKG_DIR" ]; then
    cp -R "$SVGO_PKG_DIR" "$DEST/node_modules/svgo"
    # Create a simple wrapper script
    cat > "$DEST/svgo" << 'SVGOSCRIPT'
#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
node "$SCRIPT_DIR/node_modules/svgo/bin/svgo" "$@"
SVGOSCRIPT
    chmod +x "$DEST/svgo"
  else
    echo "    WARN: svgo package not found, skipping"
  fi
fi

# Recursively resolve any dylibs that depend on OTHER dylibs we missed
echo "=== Resolving transitive dylib dependencies ==="
MAX_PASSES=5
for pass in $(seq 1 $MAX_PASSES); do
  found_new=false
  for dylib in "$DEST/lib/"*.dylib; do
    [ -f "$dylib" ] || continue
    otool -L "$dylib" 2>/dev/null | tail -n +2 | awk '{print $1}' | while read -r lib; do
      case "$lib" in
        /usr/lib/*|/System/*|@loader_path/*|@executable_path/*) continue ;;
      esac
      # Resolve @rpath to actual path
      local_lib="$lib"
      if [[ "$lib" == @rpath/* ]]; then
        libname=$(basename "$lib")
        local_lib=$(resolve_rpath "$lib" "$dylib")
        if [ -z "$local_lib" ]; then continue; fi
      else
        libname=$(basename "$lib")
        local_lib="$lib"
      fi
      if [ ! -f "$DEST/lib/$libname" ] && [ -f "$local_lib" ]; then
        echo "  TRANSITIVE: $libname (pass $pass)"
        copy_and_fix_dylib "$local_lib"
        # Also rewrite the @rpath reference in the referring dylib
        install_name_tool -change "$lib" "@loader_path/$libname" "$dylib" 2>/dev/null || true
        found_new=true
      fi
    done
  done
  if [ "$found_new" = false ]; then break; fi
done

# Ad-hoc re-sign everything (required for macOS arm64)
echo "=== Code signing ==="
find "$DEST" -type f \( -perm +111 -o -name "*.dylib" \) | while read -r f; do
  codesign --force --sign - "$f" 2>/dev/null && echo "  SIGN: $(basename "$f")" || true
done

# Print summary
echo ""
echo "=== Bundle Summary ==="
echo "Binaries:"
ls "$DEST/" | grep -v lib | grep -v node_modules | grep -v mozjpeg | sed 's/^/  /'
echo "MozJPEG:"
ls "$DEST/mozjpeg/" 2>/dev/null | sed 's/^/  /'
echo "Libraries: $(ls "$DEST/lib/" | wc -l | tr -d ' ') dylibs"
echo "Total size: $(du -sh "$DEST" | awk '{print $1}')"
echo ""
echo "Done! Run 'npm run build' to create the Electron app."
