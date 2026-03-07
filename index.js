const mineflayer = require('mineflayer');
const express = require('express');
const fetch = require('node-fetch');

// ===== HTTP 保活服务器（Render 必须有 HTTP 接口） =====
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => {
  res.send('AFK Bot 在线 - Running on Render');
});
app.listen(PORT, () => {
  console.log(`[Render] HTTP server started on port ${PORT}`);
});

// ===== 自 ping 保活（防止 Render Free 层 15 分钟休眠） =====
const RENDER_URL = process.env.RENDER_EXTERNAL_HOSTNAME
  ? `https://${process.env.RENDER_EXTERNAL_HOSTNAME}`
  : `http://localhost:${PORT}`;
setInterval(() => {
  console.log('[Self-Ping] Pinging:', RENDER_URL);
  fetch(RENDER_URL).catch(err => {
    console.error('[Self-Ping] Failed:', err.message);
  });
}, 300000); // 每 5 分钟 ping 一次

// ===== 配置 =====
const CONFIG = {
  host: 'umc.play.hosting',
  port: 25565,
  version: '1.21',
  auth: 'offline',
  checkTimeoutInterval: 300000
};

const BOT_USERNAME = 'LiveChatBot';
const AUTHME_PASSWORD = process.env.AUTHME_PASSWORD || 'deutschland';
const ALLOWED_USER = 'black_1816'; // 只允许这个玩家控制 bot

let bot;
let jumpInterval;
let reconnecting = false;
let reconnectAttempts = 0;

function startBot() {
  if (reconnecting) return;
  reconnecting = true;
  console.log('⏳ 连接中:', BOT_USERNAME);

  bot = mineflayer.createBot({
    ...CONFIG,
    username: BOT_USERNAME
  });

  // 自动接受资源包
  bot.on('resourcePack', () => {
    console.log('[资源包] 收到 → 自动接受');
    bot.acceptResourcePack();
  });

  bot.once('spawn', () => {
    console.log('✅ 已进服，等待 5 秒后尝试 AuthMe');
    setTimeout(() => {
      reconnecting = false;
      bot.chat(`/login ${AUTHME_PASSWORD}`);
      bot.chat(`/register ${AUTHME_PASSWORD} ${AUTHME_PASSWORD}`);
    }, 5000);

    // AuthMe 消息处理 + 私聊命令控制（/msg LiveChatBot !内容）
    bot.on('messagestr', (msg) => {
      const m = msg.toLowerCase();

      // AuthMe 相关
      if (m.includes('/register')) {
        console.log('→ 检测到注册');
        bot.chat(`/register ${AUTHME_PASSWORD} ${AUTHME_PASSWORD}`);
      }
      if (m.includes('/login')) {
        console.log('→ 检测到登录');
        bot.chat(`/login ${AUTHME_PASSWORD}`);
      }
      if (
        m.includes('success') ||
        m.includes('logged') ||
        m.includes('验证成功') ||
        m.includes('已登录') ||
        m.includes('welcome')
      ) {
        console.log('✅ AuthMe 完成，开始 AFK');
        startAntiAFK();
        reconnectAttempts = 0;
      }

      // 私聊命令：/msg LiveChatBot !hello → bot 公聊 "hello"
      // 支持多种常见格式：From xxx: !msg、xxx whispers to you: !msg、xxx -> bot: !msg
      const whisperIndicators = ['from ', 'whispers to you:', '->', 'whisper from ', 'whispers:'];
      let isWhisper = false;
      let sender = '';
      let content = '';

      for (const indicator of whisperIndicators) {
        if (m.includes(indicator)) {
          isWhisper = true;
          const parts = msg.split(indicator);
          if (parts.length >= 2) {
            sender = parts[0].trim().toLowerCase();
            content = parts.slice(1).join(indicator).trim();
          }
          break;
        }
      }

      // 备选：最常见的 "From xxx: 消息" 格式
      if (!isWhisper && m.includes('from ') && m.includes(':')) {
        const parts = msg.split(':');
        if (parts.length >= 2) {
          sender = parts[0].replace(/from /i, '').trim().toLowerCase();
          content = parts.slice(1).join(':').trim();
          isWhisper = true;
        }
      }

      if (isWhisper && sender.includes(ALLOWED_USER.toLowerCase())) {
        if (content.startsWith('!')) {
          const commandContent = content.slice(1).trim();
          if (commandContent.length > 0) {
            console.log(`[私聊命令 !] ${ALLOWED_USER} → ${commandContent}`);
            bot.chat(commandContent);
          }
        }
      }
    });

    // 公共聊天命令：@aibot xxx 和 !home light
    bot.on('chat', (username, message) => {
      if (username === bot.username) return;
      if (username.toLowerCase() !== ALLOWED_USER.toLowerCase()) return;

      const msgLower = message.toLowerCase().trim();

      // @aibot 复读
      const prefix = '@aibot ';
      if (msgLower.startsWith(prefix)) {
        const content = message.slice(prefix.length).trim();
        if (content.length > 0) {
          console.log(`[Echo @aibot] ${username} → ${content}`);
          bot.chat(content);
          return;
        }
      }

      // !home light → /tpahere black_1816
      if (msgLower === '!home spawn') {
        console.log(`[命令] ${username} → !home spawn → 执行 /tpahere black_1816`);
        bot.chat('/tpahere black_1816');
      }
    });
  });

  bot.on('kicked', (reason, loggedIn) => {
    console.log('❌ 被踢出！ 已登录:', loggedIn ? '是' : '否');
    console.log('踢出原因:', reason);
    if (typeof reason === 'object' && reason !== null) {
      console.log('踢出原因 JSON:', JSON.stringify(reason, null, 2));
    }
    reconnect('被踢出');
  });

  bot.on('end', () => reconnect('连接结束'));

  bot.on('error', (err) => {
    console.log('⚠️ 错误:', err.message || err);
    reconnect('错误: ' + (err.message || '未知'));
  });
}

function startAntiAFK() {
  if (jumpInterval) return;
  console.log('启动反AFK：每20秒跳一下');
  jumpInterval = setInterval(() => {
    if (!bot?.entity) return;
    bot.setControlState('jump', true);
    setTimeout(() => bot.setControlState('jump', false), 300);
  }, 20000);
}

function reconnect(reason = '未知') {
  console.log('❌ 掉线:', reason);
  try { bot?.quit(); } catch {}
  bot?.removeAllListeners();
  bot = null;
  if (jumpInterval) {
    clearInterval(jumpInterval);
    jumpInterval = null;
  }
  reconnectAttempts++;
  const delay = Math.min(30000 + (reconnectAttempts - 1) * 15000, 180000);
  console.log(`将在 ${delay/1000} 秒后第 ${reconnectAttempts} 次重连...`);
  setTimeout(() => {
    reconnecting = false;
    startBot();
  }, delay);
}

startBot();
