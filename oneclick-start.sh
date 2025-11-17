#!/usr/bin/env bash
set -euo pipefail

if [ ! -f .env ]; then
  cat > .env <<'ENV'
# 填写你的 Telegram Bot Token 与 Chat ID
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

# 扫描与交易参数（可按需调整）
HOURS_AHEAD=6
PRICE_THRESHOLD=0.85
SCAN_INTERVAL_MIN=15
ARB_THRESHOLD=0.99
AUTO_TRADE=false
TRADE_SIZE=50
SLIPPAGE_BPS=100
AUTO_CREATE_WALLET=true
# PRIVATE_KEY=
# WALLET_MNEMONIC=
ENV
  echo "已生成 .env 模板，请填写 TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID 后重新运行。"
  exit 0
fi

npm install
npm run start
