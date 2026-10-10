const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// ===== KONFIG TELEGRAM =====
const BOT_TOKEN = process.env.BOT_TOKEN || '8894793331:AAFfPZMNP068WOZmkD6cTBfMKccuVzPKzO8';
const ADMIN_ID = process.env.ADMIN_ID || '1936469745';
const WEBHOOK_URL = process.env.WEBHOOK_URL || '';

// ===== QRIS IMAGE =====
const QRIS_IMAGE_URL = process.env.QRIS_IMAGE_URL || 'https://files.catbox.moe/21j158.jpg';

// ===== MIDDLEWARE =====
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ===== DATABASE JSON =====
const DB_FILE = path.join(__dirname, 'db.json');

function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ users: {}, pendingDeposits: [] }, null, 2));
  }
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (e) {
    return { users: {}, pendingDeposits: [] };
  }
}

function saveDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// ===== HELPER TELEGRAM =====
async function sendTelegram(chatId, text) {
  try {
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id: chatId,
      text: text,
      parse_mode: 'Markdown'
    });
  } catch (err) {
    console.error('[Telegram Error]', err.message);
  }
}

// ============================
//   ROUTES API
// ============================

// QRIS
app.get('/api/qris', (req, res) => {
  res.json({ qrisImage: QRIS_IMAGE_URL });
});

// Register
app.post('/api/register', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email & password wajib' });
  if (!email.includes('@')) return res.status(400).json({ error: 'Format email tidak valid' });
  if (password.length < 4) return res.status(400).json({ error: 'Password minimal 4 karakter' });

  const db = loadDB();
  if (db.users[email]) return res.status(400).json({ error: 'Email sudah terdaftar' });

  db.users[email] = { password, saldo: 0, riwayat: [] };
  saveDB(db);
  res.json({ success: true, message: 'Pendaftaran berhasil' });
});

// Login
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  const db = loadDB();
  const user = db.users[email];
  if (!user || user.password !== password) {
    return res.status(401).json({ error: 'Email atau password salah' });
  }
  res.json({ success: true, email, saldo: user.saldo, riwayat: user.riwayat });
});

// Get user
app.get('/api/user/:email', (req, res) => {
  const db = loadDB();
  const user = db.users[req.params.email];
  if (!user) return res.status(404).json({ error: 'User tidak ditemukan' });
  res.json({ email: req.params.email, saldo: user.saldo, riwayat: user.riwayat });
});

// Deposit
app.post('/api/deposit', async (req, res) => {
  const { email, jumlah } = req.body;
  if (!email || !jumlah || jumlah <= 0) {
    return res.status(400).json({ error: 'Data tidak valid' });
  }

  const db = loadDB();
  if (!db.users[email]) return res.status(404).json({ error: 'User tidak ditemukan' });

  const depositId = Date.now().toString();
  db.pendingDeposits.push({
    id: depositId,
    email,
    jumlah,
    status: 'pending',
    tanggal: new Date().toISOString()
  });
  saveDB(db);

  await sendTelegram(ADMIN_ID,
    `🧾 *KONFIRMASI DEPOSIT*\n\n` +
    `👤 Email: ${email}\n` +
    `💰 Jumlah: Rp${jumlah.toLocaleString('id-ID')}\n` +
    `🆔 ID: \`${depositId}\`\n\n` +
    `✅ Approve: \`/approve ${depositId}\`\n` +
    `❌ Reject: \`/reject ${depositId}\``
  );

  res.json({ success: true, message: 'Deposit dikirim, tunggu konfirmasi admin' });
});

// Beli nokos
app.post('/api/beli', (req, res) => {
  const { email, aplikasi, negara } = req.body;
  const HARGA = 5000;

  const db = loadDB();
  const user = db.users[email];
  if (!user) return res.status(404).json({ error: 'User tidak ditemukan' });
  if (user.saldo < HARGA) return res.status(400).json({ error: 'Saldo tidak cukup' });

  const id = Date.now().toString();
  user.saldo -= HARGA;
  user.riwayat.push({ id, aplikasi, negara, harga: HARGA, tanggal: new Date().toISOString() });
  saveDB(db);

  res.json({ success: true, saldo: user.saldo, riwayat: user.riwayat });
});

// Batal beli
app.post('/api/batal', (req, res) => {
  const { email, id } = req.body;
  const db = loadDB();
  const user = db.users[email];
  if (!user) return res.status(404).json({ error: 'User tidak ditemukan' });

  const index = user.riwayat.findIndex(r => r.id === id);
  if (index === -1) return res.status(404).json({ error: 'Data tidak ditemukan' });

  user.saldo += user.riwayat[index].harga;
  user.riwayat.splice(index, 1);
  saveDB(db);

  res.json({ success: true, saldo: user.saldo, riwayat: user.riwayat });
});

// ============================
//   TELEGRAM WEBHOOK
// ============================
app.post('/webhook', async (req, res) => {
  const msg = req.body.message;
  if (!msg || !msg.text) return res.sendStatus(200);

  const chatId = msg.chat.id.toString();
  const text = msg.text.trim();

  if (chatId !== ADMIN_ID) {
    await sendTelegram(chatId, '⛔ Akses ditolak. Hanya admin.');
    return res.sendStatus(200);
  }

  const args = text.split(' ');
  const cmd = args[0].toLowerCase();
  const db = loadDB();

  if (cmd === '/start') {
    await sendTelegram(chatId,
      `👋 *Selamat datang, Admin!*\n\n` +
      `*Perintah tersedia:*\n` +
      `/approve <id> — Setujui deposit\n` +
      `/reject <id> — Tolak deposit\n` +
      `/addsaldo <email> <jumlah> — Tambah saldo\n` +
      `/cek <email> — Lihat data user\n` +
      `/pending — Lihat deposit pending\n` +
      `/users — Lihat semua user`
    );
  }
  else if (cmd === '/approve') {
    const id = args[1];
    const deposit = db.pendingDeposits.find(d => d.id === id && d.status === 'pending');
    if (!deposit) {
      await sendTelegram(chatId, '❌ Deposit tidak ditemukan atau sudah diproses.');
    } else {
      db.users[deposit.email].saldo += deposit.jumlah;
      deposit.status = 'approved';
      saveDB(db);
      await sendTelegram(chatId,
        `✅ *APPROVED*\n\n` +
        `👤 ${deposit.email}\n` +
        `💰 Rp${deposit.jumlah.toLocaleString('id-ID')}\n` +
        `📊 Saldo baru: Rp${db.users[deposit.email].saldo.toLocaleString('id-ID')}`
      );
    }
  }
  else if (cmd === '/reject') {
    const id = args[1];
    const deposit = db.pendingDeposits.find(d => d.id === id && d.status === 'pending');
    if (!deposit) {
      await sendTelegram(chatId, '❌ Deposit tidak ditemukan.');
    } else {
      deposit.status = 'rejected';
      saveDB(db);
      await sendTelegram(chatId, `❌ Deposit ${id} ditolak.`);
    }
  }
  else if (cmd === '/addsaldo') {
    const email = args[1];
    const jumlah = parseInt(args[2]);
    if (!email || !jumlah || jumlah <= 0) {
      await sendTelegram(chatId, '⚠️ Format: `/addsaldo user@mail.com 10000`');
    } else if (!db.users[email]) {
      await sendTelegram(chatId, `❌ User ${email} tidak ditemukan.`);
    } else {
      db.users[email].saldo += jumlah;
      saveDB(db);
      await sendTelegram(chatId,
        `✅ *SALDO DITAMBAH*\n\n` +
        `👤 ${email}\n` +
        `💰 +Rp${jumlah.toLocaleString('id-ID')}\n` +
        `📊 Saldo baru: Rp${db.users[email].saldo.toLocaleString('id-ID')}`
      );
    }
  }
  else if (cmd === '/cek') {
    const email = args[1];
    const user = db.users[email];
    if (!user) {
      await sendTelegram(chatId, `❌ User ${email} tidak ditemukan.`);
    } else {
      await sendTelegram(chatId,
        `👤 *${email}*\n💰 Saldo: Rp${user.saldo.toLocaleString('id-ID')}\n📋 Riwayat: ${user.riwayat.length} item`
      );
    }
  }
  else if (cmd === '/pending') {
    const pending = db.pendingDeposits.filter(d => d.status === 'pending');
    if (pending.length === 0) {
      await sendTelegram(chatId, '📭 Tidak ada deposit pending.');
    } else {
      let text = `📋 *DEPOSIT PENDING (${pending.length})*\n\n`;
      pending.forEach(p => {
        text += `🆔 \`${p.id}\`\n👤 ${p.email}\n💰 Rp${p.jumlah.toLocaleString('id-ID')}\n\n`;
      });
      await sendTelegram(chatId, text);
    }
  }
  else if (cmd === '/users') {
    const emails = Object.keys(db.users);
    if (emails.length === 0) {
      await sendTelegram(chatId, '📭 Belum ada user.');
    } else {
      let text = `👥 *DAFTAR USER (${emails.length})*\n\n`;
      emails.forEach(e => {
        text += `• ${e} — Rp${db.users[e].saldo.toLocaleString('id-ID')}\n`;
      });
      await sendTelegram(chatId, text);
    }
  }
  else {
    await sendTelegram(chatId, '❓ Perintah tidak dikenal. Kirim /start');
  }

  res.sendStatus(200);
});

// Set webhook
app.get('/setwebhook', async (req, res) => {
  if (!WEBHOOK_URL) return res.json({ error: 'WEBHOOK_URL belum diset' });
  try {
    const r = await axios.get(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${WEBHOOK_URL}/webhook`);
    res.json(r.data);
  } catch (err) {
    res.json({ error: err.message });
  }
});

// ===== START =====
app.listen(PORT, () => {
  console.log(`🔥 Server jalan di port ${PORT}`);
  console.log(`📡 Webhook endpoint: POST /webhook`);
});