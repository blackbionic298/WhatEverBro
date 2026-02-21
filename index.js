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
  host: 'mi-667c7cd2.axenthost.me',
  port: 43046,                      // ← 去面板确认当前端口，如果变了改这里！
  version: '1.21',                  // 强制 1.21，避免自动检测出错
  auth: 'offline',
  checkTimeoutInterval: 300000      // 延长到 5 分钟
};

const BOT_USERNAME = 'WhatEverBro_lol';
const AUTHME_PASSWORD = process.env.AUTHME_PASSWORD || 'deutschland';

let bot;
let jumpInterval;
let reconnecting = false;
let reconnectAttempts = 0; // 新增：重连计数

function startBot() {
  if (reconnecting) return;
  reconnecting = true;
  console.log('⏳ 连接中:', BOT_USERNAME);

  bot = mineflayer.createBot({
    ...CONFIG,
    username: BOT_USERNAME
  });

  // 自动接受资源包（防插件踢）
  bot.on('resourcePack', () => {
    console.log('[资源包] 收到 → 自动接受');
    bot.acceptResourcePack();
  });

  bot.once('spawn', () => {
    console.log('✅ 已进服，等待 5 秒后尝试 AuthMe（防误判）');
    setTimeout(() => {
      reconnecting = false;
      bot.chat(`/login ${AUTHME_PASSWORD}`);
      bot.chat(`/register ${AUTHME_PASSWORD} ${AUTHME_PASSWORD}`);
    }, 5000);

    bot.on('messagestr', (msg) => {
      const m = msg.toLowerCase();

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
        reconnectAttempts = 0; // 成功进服，重置计数
      }
    });
  });

  // 详细 kicked 日志
  bot.on('kicked', (reason, loggedIn) => {
    console.log('❌ 被踢出！ 已登录:', loggedIn ? '是' : '否');
    console.log('踢出原因类型:', typeof reason);
    console.log('踢出原因:', reason);
    if (typeof reason === 'object' && reason !== null) {
      console.log('踢出原因 JSON:', JSON.stringify(reason, null, 2));
    }
    reconnect('被踢出 - 详见上面原因');
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
  const delay = Math.min(30000 + (reconnectAttempts - 1) * 15000, 180000); // 30s → 45s → 60s ... 最多3min
  console.log(`将在 ${delay/1000} 秒后第 ${reconnectAttempts} 次重连...`);

  setTimeout(() => {
    reconnecting = false;
    startBot();
  }, delay);
}

startBot();
