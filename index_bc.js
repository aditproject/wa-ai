const {
  default: makeWASocket,
  useMultiFileAuthState,
  delay,
  DisconnectReason
} = require('@whiskeysockets/baileys');

const express = require('express');
const qrcode = require('qrcode');
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const axios = require('axios');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');



const app = express();
const port = 3000;
let currentQRCode = '';

const db = mysql.createPool({
  host: 'localhost',  // sesuaikan dengan host MySQL kamu
  user: 'root',
  password: '17Agustus1945',
  database: 'whatsapp' // sesuaikan dengan nama database
});

const groupCooldown = {};
const mentionLog = {}; // menyimpan user yang sudah mention hari ini

function todayKey() {
  const now = new Date();
  return now.toISOString().slice(0, 10);
}

async function simpanKeDatabase(sender, message) {
  try {
    await db.query('INSERT INTO messages (sender, message) VALUES (?, ?)', [sender, message]);
    console.log('✅ Pesan disimpan ke database');
  } catch (err) {
    console.error('❌ Gagal simpan ke database:', err);
  }
}

async function simpanKeDatabaseserver(sender, message) {
  const formData = new FormData();
  formData.append('sender', sender);
  formData.append('message', message);


  try {
    const response = await axios.post('https://mbedigv2.com/api_whatsapp_sms/api_insert.php', formData, {
      headers: formData.getHeaders()
    });
    console.log('📬 Respons dari server PHP:', response.data);
  } catch (err) {
    console.error('❌ Gagal kirim gambar ke server PHP:', err.response?.data || err.message);
  }
}
async function simpanGambarDanDatabaseserver(sock, msg, sender, from) {
  try {
    const messageContent = msg.message;
    const imageMessage = messageContent.imageMessage;

    const stream = await downloadContentFromMessage(imageMessage, 'image');
    const buffer = [];

    for await (const chunk of stream) {
      buffer.push(chunk);
    }

    const imageBuffer = Buffer.concat(buffer);
    const fileName = `image_${Date.now()}.jpg`;
    const downloadDir = path.join(__dirname, 'downloads');
    const filePath = path.join(downloadDir, fileName);

    if (!fs.existsSync(downloadDir)) {
      fs.mkdirSync(downloadDir);
    }

    fs.writeFileSync(filePath, imageBuffer);
    console.log(`✅ Gambar disimpan ke ${filePath}`);

    //const caption = imageMessage.caption || '[gambar tanpa teks]';
    //await db.query('INSERT INTO messages (sender, message, filename) VALUES (?, ?, ?)', [sender, caption, fileName]);

    // Kirim juga ke server PHP via multipart/form-data
    const formData = new FormData();
    formData.append('sender', sender);
    formData.append('message', caption);
    formData.append('filename', fileName);
    formData.append('file', fs.createReadStream(filePath));

    await axios.post('https://mbedigv2.com/api_whatsapp_sms/api_insert.php', formData, {
      headers: formData.getHeaders()
    });

    console.log('🌐 Gambar dan caption dikirim ke server PHP');
  } catch (err) {
    console.error('❌ Gagal download/simpan/kirim gambar:', err);
  }
}



async function simpanGambarDanDatabase(sock, msg, sender, from) {
  try {
    const messageContent = msg.message;
    const imageMessage = messageContent.imageMessage;

    const stream = await downloadContentFromMessage(imageMessage, 'image');
    const buffer = [];

    for await (const chunk of stream) {
      buffer.push(chunk);
    }

    const imageBuffer = Buffer.concat(buffer);

    // Buat nama file unik
    const fileName = `image_${Date.now()}.jpg`;
    const downloadDir = path.join(__dirname, 'downloads');
    const filePath = path.join(downloadDir, fileName);

    // Pastikan folder downloads ada
    if (!fs.existsSync(downloadDir)) {
      fs.mkdirSync(downloadDir);
    }

    fs.writeFileSync(filePath, imageBuffer);
    console.log(`✅ Gambar disimpan ke ${filePath}`);

    // Ambil caption (jika ada)
    const caption = imageMessage.caption || '[gambar tanpa teks]';

    // Simpan ke database
    await db.query('INSERT INTO messages (sender, message, filename) VALUES (?, ?, ?)', [sender, caption, fileName]);

  } catch (err) {
    console.error('❌ Gagal download atau simpan gambar:', err);
  }
}


app.get('/', (req, res) => {
  if (currentQRCode) {
    res.send(`<h2>Scan QR Code WhatsApp</h2><img src="${currentQRCode}" style="width:300px;" />`);
  } else {
    res.send('<p>QR Code belum tersedia. Silakan tunggu sebentar...</p>');
  }
});

app.listen(port, () => {
  console.log(`✅ QR Code tersedia di http://localhost:${port}`);
});

async function resetAuthFolder() {
  const authPath = path.resolve('./auth');
  if (fs.existsSync(authPath)) {
    fs.rmSync(authPath, { recursive: true, force: true });
    console.log('🗑️ Folder auth dihapus agar sesi reset.');
  }
}

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState('auth');

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { qr, connection, lastDisconnect } = update;

    if (qr) {
      try {
        currentQRCode = await qrcode.toDataURL(qr);
        console.log('📲 QR code diperbarui, silakan buka di browser.');
      } catch (err) {
        console.error('❌ Gagal ubah QR ke data URL:', err);
      }
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      console.log('🔌 Koneksi ditutup. Reconnect:', shouldReconnect, 'Status:', statusCode);

      if (!shouldReconnect && statusCode === DisconnectReason.loggedOut) {
        console.log('❗ Terjadi logout, reset sesi dan QR code muncul kembali.');
        await resetAuthFolder();
        currentQRCode = ''; // supaya halaman QR menampilkan "belum tersedia"
      }

      if (shouldReconnect) {
        start();
      }
    }

    if (connection === 'open') {
      console.log('✅ Terhubung ke WhatsApp!');
    }
  });

// Fungsi untuk normalisasi JID, menghilangkan suffix setelah ":"
function normalizeJid(jid) {
  return jid?.split(':')[0]; // ini sudah benar
}

sock.ev.on('messages.upsert', async ({ messages }) => {
  const msg = messages[0];
  console.log('📩 Pesan diterima dari:', msg.key.remoteJid);

  if (!msg.message) return;

  const from = msg.key.remoteJid;
  const sender = msg.key.participant || from;
  const messageContent = msg.message;

  const mentionedJid = messageContent?.extendedTextMessage?.contextInfo?.mentionedJid || [];
  const teks = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '-';

  
  const botIdNormalized = normalizeJid(sock.user.id);
  const mentionedNormalized = mentionedJid.map(normalizeJid);
  
  console.log('🆔 Bot ID (full):', sock.user.id);
  console.log('🆔 Bot ID (normalized):', botIdNormalized);
  console.log('📍 mentionedNormalized:', mentionedNormalized);

  const isBotMentioned = mentionedNormalized.some(jid => jid.split('@')[0] === botIdNormalized.split('@')[0]);

if (from.endsWith('@g.us') && isBotMentioned) {
    console.log(`👥 Kamu dimention oleh ${sender} di grup ${from}: ${teks}`);


  // Simpan gambar jika ada
  if (msg.message.imageMessage) {
    //await simpanGambarDanDatabase(sock, msg, sender, from);
    await simpanGambarDanDatabaseserver(sock, msg, sender, from);
    
    
  }else{
  //await simpanKeDatabase(sender, teks);
  await simpanKeDatabaseserver(sender, teks);
  
  }

    const today = todayKey();
    if (!mentionLog[today]) mentionLog[today] = new Set();

    if (mentionLog[today].has(sender)) {
      console.log('🔁 Sudah membalas mention user ini hari ini. Lewat.');
      return;
    }
    mentionLog[today].add(sender);

    const last = groupCooldown[from] || 0;
    const now = Date.now();
    if (now - last < 30_000) {
      console.log('⏳ Masih dalam waktu tunggu grup. Tidak membalas.');
      return;
    }
    groupCooldown[from] = now;



    await delay(5000 + Math.random() * 5000);

    const safeReply = `Oke @${sender.split('@')[0]}, Noted!`;
    await sock.sendMessage(from, {
      text: safeReply,
      mentions: [sender]
    });
  }
});

}

start();
