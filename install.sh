#!/usr/bin/env bash
# ARIES v5.3 — One Click Setup (Linux/macOS)
# Usage: ./install.sh
set -e

RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; YELLOW='\033[1;33m'; NC='\033[0m'

echo ""
echo -e "${CYAN}  ╔═══════════════════════════════════════╗${NC}"
echo -e "${CYAN}  ║     ARIES v5.3 - One Click Setup      ║${NC}"
echo -e "${CYAN}  ╚═══════════════════════════════════════╝${NC}"
echo ""

# ── Detect OS ──
detect_os() {
    if [[ "$OSTYPE" == "darwin"* ]]; then
        echo "macos"
    elif [ -f /etc/os-release ]; then
        . /etc/os-release
        case "$ID" in
            ubuntu|debian|pop|mint|elementary) echo "debian" ;;
            fedora|rhel|centos|rocky|alma) echo "fedora" ;;
            arch|manjaro|endeavouros) echo "arch" ;;
            *) echo "linux" ;;
        esac
    else
        echo "linux"
    fi
}

OS=$(detect_os)
echo -e "[*] Detected OS: ${CYAN}${OS}${NC}"

# ── Install Node.js if missing ──
if ! command -v node &>/dev/null; then
    echo -e "${YELLOW}[!] Node.js not found. Installing...${NC}"
    case "$OS" in
        macos)
            if command -v brew &>/dev/null; then
                brew install node
            else
                echo "[*] Installing Homebrew first..."
                /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
                brew install node
            fi
            ;;
        debian)
            curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
            sudo apt-get install -y nodejs
            ;;
        fedora)
            curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
            sudo dnf install -y nodejs
            ;;
        arch)
            sudo pacman -Sy --noconfirm nodejs npm
            ;;
        *)
            echo "[*] Trying nvm..."
            curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
            export NVM_DIR="$HOME/.nvm"
            [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
            nvm install 20
            ;;
    esac

    if ! command -v node &>/dev/null; then
        echo -e "${RED}[X] Failed to install Node.js. Please install manually: https://nodejs.org${NC}"
        exit 1
    fi
    echo -e "${GREEN}[+] Node.js $(node -v) installed!${NC}"
else
    echo -e "${GREEN}[+] Node.js $(node -v) found${NC}"
fi
echo ""

# ── Install dependencies ──
echo "[*] Installing dependencies..."
npm install --no-fund --no-audit
echo -e "${GREEN}[+] Dependencies installed!${NC}"
echo ""

# ── Run setup wizard ──
echo "[*] Starting setup wizard..."
echo "────────────────────────────────────────────"
node setup.js
echo "────────────────────────────────────────────"
echo ""

echo -e "${GREEN}  ╔═══════════════════════════════════════╗${NC}"
echo -e "${GREEN}  ║       Setup complete!                  ║${NC}"
echo -e "${GREEN}  ║   Run: node launcher.js                ║${NC}"
echo -e "${GREEN}  ╚═══════════════════════════════════════╝${NC}"
echo ""
