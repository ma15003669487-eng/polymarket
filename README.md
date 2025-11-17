# Polymarket Telegram Bot

本仓库提供一个 Polymarket 市场套利/扫盘的 Telegram 机器人（含一键启动脚本与底部固定按钮）。下面的说明以 **macOS** 为例，帮助你完成安装和启动。

## 环境准备
- macOS 12 及以上（Apple Silicon 与 Intel 都可）。
- 已安装 [Homebrew](https://brew.sh/)（推荐）。
- Node.js 18+ 与 npm。
  - 如果未安装：`brew install node`

## 获取代码
```bash
# 1) 下载代码
git clone https://github.com/your-org/polymarket.git
cd polymarket
```

## 快速一键启动（推荐）
### 方式 A：终端运行脚本
```bash
chmod +x oneclick-start.sh
./oneclick-start.sh
```
脚本会自动：
1. 生成 `.env` 模板（如果不存在）；
2. 安装依赖；
3. 启动机器人。

### 方式 B：双击运行（macOS 图形界面）
仓库附带 `polymarket-install.command`，可在 Finder 中双击运行，等效于方式 A（会创建 `~/polymarket-eod-bot` 目录并写入模板配置）。若弹出“来自身份不明开发者”提示，可在「系统设置 > 隐私与安全性」允许运行。

## 配置环境变量
首次启动后会在项目根目录生成 `.env` 文件，按需填入自己的参数：
```bash
TELEGRAM_BOT_TOKEN=<你的 Telegram 机器人 Token>
TELEGRAM_CHAT_ID=<接收消息的 chat id>

# 扫描/套利参数（可选）
HOURS_AHEAD=6
PRICE_THRESHOLD=0.85
SCAN_INTERVAL_MIN=15
ARB_THRESHOLD=0.99
AUTO_TRADE=false
TRADE_SIZE=50
SLIPPAGE_BPS=100
AUTO_CREATE_WALLET=true
PRIVATE_KEY=
WALLET_MNEMONIC=
```
> **提示**：`AUTO_TRADE=true` 时会自动提交模拟交易；要真实交易需在代码中接入真实交易逻辑并配置私钥/助记词。

## 手动运行（可替代一键脚本）
如果想自行管理步骤，可按照下面执行：
```bash
# 安装依赖
npm install

# 启动机器人
npm start
```

## 常见问题
- **权限被拒绝**：确保脚本有可执行权限（`chmod +x oneclick-start.sh polymarket-install.command`）。
- **无法联网或被墙**：请确认 macOS 可以访问 `https://gamma-api.polymarket.com` 和 Telegram API。
- **修改配置后未生效**：重新启动机器人以加载最新的 `.env`。

