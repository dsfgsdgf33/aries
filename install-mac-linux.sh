#!/bin/bash
# ARIES One-Click Installer for macOS/Linux
# Run: curl -fsSL https://raw.githubusercontent.com/dsfgsdgf33/aries/main/install-mac-linux.sh | bash

set -e

echo ""
echo "  ▲ ARIES — AI Command Center Installer"
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "  Installing Node.js..."
    if command -v brew &> /dev/null; then
        brew install node
    elif command -v apt-get &> /dev/null; then
        curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
        sudo apt-get install -y nodejs
    elif command -v dnf &> /dev/null; then
        sudo dnf install -y nodejs
    else
        echo "  Please install Node.js 18+ from https://nodejs.org"
        exit 1
    fi
fi
echo "  ✓ Node.js $(node --version)"

# Clone or update
INSTALL_DIR="$HOME/.aries"
if [ -f "$INSTALL_DIR/launcher.js" ]; then
    echo "  Updating existing installation..."
    cd "$INSTALL_DIR" && git pull origin main 2>/dev/null || true
else
    echo "  Downloading Aries..."
    git clone https://github.com/dsfgsdgf33/aries.git "$INSTALL_DIR" 2>/dev/null || {
        mkdir -p "$INSTALL_DIR"
        curl -fsSL "https://github.com/dsfgsdgf33/aries/archive/refs/heads/main.tar.gz" | tar xz -C "$INSTALL_DIR" --strip-components=1
    }
fi

# Create launcher script
cat > "$HOME/.local/bin/aries" 2>/dev/null << 'EOF' || true
#!/bin/bash
cd "$HOME/.aries" && node launcher.js "$@"
EOF
chmod +x "$HOME/.local/bin/aries" 2>/dev/null || true

# macOS: Create app bundle
if [ "$(uname)" = "Darwin" ]; then
    APP_DIR="$HOME/Applications/ARIES.app/Contents/MacOS"
    mkdir -p "$APP_DIR"
    cat > "$APP_DIR/aries" << EOF
#!/bin/bash
cd "$INSTALL_DIR" && node launcher.js
open "http://localhost:3333"
EOF
    chmod +x "$APP_DIR/aries"
    echo "  ✓ macOS app created in ~/Applications"
fi

echo ""
echo "  ✓ ARIES installed to $INSTALL_DIR"
echo "  ✓ Run with: cd $INSTALL_DIR && node launcher.js"
echo ""
echo "  Starting ARIES..."
cd "$INSTALL_DIR" && node launcher.js
