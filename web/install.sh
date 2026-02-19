#!/usr/bin/env bash
# ARIES v5.3 — Linux/macOS One-Liner Installer
# Usage: curl -sL https://raw.githubusercontent.com/dsfgsdgf33/aries/main/web/install.sh | bash
set -e

RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; YELLOW='\033[1;33m'; NC='\033[0m'
INSTALL_DIR="$HOME/aries"

echo ""
echo -e "${CYAN}  ╔═══════════════════════════════════════╗${NC}"
echo -e "${CYAN}  ║     ARIES v5.3 — Quick Install        ║${NC}"
echo -e "${CYAN}  ╚═══════════════════════════════════════╝${NC}"
echo ""

# ── Detect OS ──
detect_os() {
    if [[ "$OSTYPE" == "darwin"* ]]; then echo "macos"
    elif [ -f /etc/os-release ]; then
        . /etc/os-release
        case "$ID" in
            ubuntu|debian|pop|mint|elementary) echo "debian" ;;
            fedora|rhel|centos|rocky|alma) echo "fedora" ;;
            arch|manjaro|endeavouros) echo "arch" ;;
            *) echo "linux" ;;
        esac
    else echo "linux"; fi
}

OS=$(detect_os)

# ── Install Node.js if missing ──
if ! command -v node &>/dev/null; then
    echo -e "${YELLOW}[!] Node.js not found. Installing...${NC}"
    case "$OS" in
        macos)
            if command -v brew &>/dev/null; then brew install node
            else
                /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
                eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv 2>/dev/null)"
                brew install node
            fi ;;
        debian)
            curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
            sudo apt-get install -y nodejs ;;
        fedora)
            curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
            sudo dnf install -y nodejs ;;
        arch)
            sudo pacman -Sy --noconfirm nodejs npm ;;
        *)
            curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
            export NVM_DIR="$HOME/.nvm"
            [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
            nvm install 20 ;;
    esac
    if ! command -v node &>/dev/null; then
        echo -e "${RED}[X] Failed to install Node.js. Install manually: https://nodejs.org${NC}"
        exit 1
    fi
fi
echo -e "${GREEN}[+] Node.js $(node -v) ready${NC}"

# ── Install Git if missing ──
if ! command -v git &>/dev/null; then
    echo -e "${YELLOW}[!] Git not found. Installing...${NC}"
    case "$OS" in
        macos) xcode-select --install 2>/dev/null || brew install git ;;
        debian) sudo apt-get install -y git ;;
        fedora) sudo dnf install -y git ;;
        arch) sudo pacman -Sy --noconfirm git ;;
    esac
fi

# ── Clone or Update ──
if [ -d "$INSTALL_DIR/.git" ]; then
    echo "[*] Updating existing installation..."
    cd "$INSTALL_DIR"
    git pull --ff-only 2>/dev/null || true
else
    echo "[*] Downloading Aries..."
    rm -rf "$INSTALL_DIR" 2>/dev/null || true
    git clone https://github.com/dsfgsdgf33/aries.git "$INSTALL_DIR"
    cd "$INSTALL_DIR"
fi

# ── Install dependencies ──
echo "[*] Installing dependencies..."
npm install --no-fund --no-audit
echo -e "${GREEN}[+] Dependencies installed!${NC}"

# ── Run setup ──
echo ""
echo "[*] Starting setup wizard..."
node setup.js

# ── Create desktop entry (Linux) or alias (macOS) ──
if [[ "$OS" != "macos" ]] && [ -d "$HOME/.local/share/applications" ]; then
    cat > "$HOME/.local/share/applications/aries.desktop" <<EOF
[Desktop Entry]
Name=ARIES
Comment=Autonomous Runtime Intelligence & Execution System
Exec=bash -c 'cd $INSTALL_DIR && node launcher.js'
Icon=$INSTALL_DIR/aries.ico
Terminal=true
Type=Application
Categories=Utility;
EOF
    echo -e "${GREEN}[+] Desktop entry created!${NC}"
elif [[ "$OS" == "macos" ]]; then
    SHELL_RC="$HOME/.zshrc"
    [ -f "$HOME/.bashrc" ] && ! [ -f "$HOME/.zshrc" ] && SHELL_RC="$HOME/.bashrc"
    if ! grep -q "alias aries=" "$SHELL_RC" 2>/dev/null; then
        echo "alias aries='cd $INSTALL_DIR && node launcher.js'" >> "$SHELL_RC"
        echo -e "${GREEN}[+] Shell alias 'aries' added! Restart terminal or run: source $SHELL_RC${NC}"
    fi
fi

echo ""
echo -e "${GREEN}  ╔═══════════════════════════════════════╗${NC}"
echo -e "${GREEN}  ║       Installation complete!           ║${NC}"
echo -e "${GREEN}  ╚═══════════════════════════════════════╝${NC}"
echo ""
echo "  Location: $INSTALL_DIR"
echo "  Launch:   cd $INSTALL_DIR && node launcher.js"
echo ""
