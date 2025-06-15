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
const ExcelJS = require('exceljs');
const Groq = require('groq-sdk'); // <-- LIBRARY BARU
const lastLocationBySender = {};

const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

// --- Inisialisasi Kunci API Groq ---
const groq = new Groq({
    apiKey: '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' 
});

const app = express();
const port = 3000;
let currentQRCode = '';

const db = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: '17Agustus1945',
  database: 'whatsapp'
});

const groupCooldown = {};

// --- FUNGSI BARU UNTUK GROQ AI ---
/**
 * Gets a response from the Groq AI.
 * @param {string} prompt - The user's question.
 * @returns {Promise<string>} - The AI's response.
 */

// --- FUNGSI BARU UNTUK UPLOAD FOTO TOKO ---
async function uploadFotoToko(params) {
  const apiUrl = 'http://mbedigv2.com/api_whatsapp_sms/api_insert_lokasi.php'; 
  const formData = new FormData();

  formData.append('sender', params.sender);
  formData.append('caption', params.caption);
  formData.append('file', fs.createReadStream(params.file_path));
  
  try {
      const response = await axios.post(apiUrl, formData, {
          headers: formData.getHeaders()
      });
      return response.data.message || 'Foto toko berhasil diunggah.';
  } catch (error) {
      console.error('❌ Gagal mengunggah foto toko:', error.response?.data || error.message);
      return 'Gagal mengunggah foto toko ke server.';
  }
}
// --- AKHIR FUNGSI BARU ---


async function getGroqChatCompletion(prompt) {
  try {
    // --- PERUBAHAN: Mengambil system prompt dari API ---
    let systemPrompt = 'Anda adalah asisten AI dengan nama LARAS dan selalu menjawab dalam Bahasa Indonesia.'; // Fallback default
    try {
        const promptData = await getDataFromServer('get_ai_prompt', {}, false); // Meminta data mentah
        if (promptData && promptData.prompt) {
            systemPrompt = promptData.prompt;
            console.log('✅ Berhasil memuat system prompt dari API.');
        }
    } catch (apiError) {
        console.error('⚠️ Gagal memuat system prompt dari API, menggunakan default. Error:', apiError.message);
    }
    // --- AKHIR DARI PERUBAHAN ---

    const response = await groq.chat.completions.create({
        messages: [
            {
                role: 'system',
                content: systemPrompt // Menggunakan prompt yang didapat dari API
            },
            { 
                role: 'user', 
                content: prompt 
            }
        ],
        model: 'llama3-70b-8192',
    });
    return response.choices[0]?.message?.content || 'Maaf, saya tidak bisa memproses permintaan Anda saat ini.';
  } catch (error) {
    console.error('❌ Gagal menghubungi API Groq:', error);
    return 'Maaf, terjadi kesalahan saat menghubungi layanan AI.';
  }
}

// ... (fungsi-fungsi lain seperti getDataFromServer, simpanKeDatabase, dll tetap sama)
async function getDataFromServer(command, params = {}, asText = true) {
  try {
    const apiUrl = 'http://147.139.166.154/siomay/api_whatsapp_sms/api_get_data.php';

    const requestParams = {
        request: command,
        ...params
    };

    console.log(`🌐 Meminta data dari: ${apiUrl} dengan parameter:`, requestParams);
    const response = await axios.get(apiUrl, { params: requestParams });

    const data = response.data;
    
    if (!asText) {
      // Kembalikan data mentah (JSON) jika diminta
      return data;
    }

    if (data && Array.isArray(data) && data.length > 0) {
      let replyText = '✅ Berikut data yang diberikan Kak Laras Cantik:\n\n';
      data.forEach((item, index) => {
        replyText += `*Data #${index + 1}*\n`;
        if(command === 'check_stock'){
            replyText += `Nama Barang: *${item.nama_barang || '-'}*\n`;
            replyText += `Sisa Stok Semarang: *${item.sisa_stock_semarang || '0'}*\n`;
            replyText += `Sisa Stok Batang: *${item.total_omset_depo || '0'}*\n\n`;
        } else {
            replyText += `Pengirim: ${item.sender || '-'}\n`;
            replyText += `Pesan: ${item.message || '-'}\n`;
            replyText += `Waktu: ${item.timestamp || '-'}\n\n`;
        }
      });
      return replyText;
    } else if (data && data.message) {
        return `✅ Info dari Kak Laras:\n\n${data.message}`;
    } else {
      return 'Maaf, Kak Laras ga bisa ngasi data :(';
    }

  } catch (error) {
    console.error('❌ Gagal mengambil data dari server:', error.message);
    return 'Maaf, terjadi kesalahan saat mencoba menghubungi server. Silakan coba lagi nanti.';
  }
}


async function start() {
  const { state, saveCreds } = await useMultiFileAuthState('auth');
  const sock = makeWASocket({ auth: state, printQRInTerminal: false });

  // ... (kode koneksi dan setup lainnya tetap sama) ...
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
        // await resetAuthFolder(); // Fungsi ini mungkin perlu Anda buat lagi jika dibutuhkan
        currentQRCode = '';
      }
      if (shouldReconnect) {
        start();
      }
    }
    if (connection === 'open') {
      console.log('✅ Terhubung ke WhatsApp!');
    }
  });


  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message) return;

    const from = msg.key.remoteJid;
    const sender = msg.key.participant || from;
    const teks = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';

    const isBotMentioned = (msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || []).some(
        (jid) => jid.split('@')[0] === sock.user.id.split(':')[0]
    );

    if (from.endsWith('@g.us') && isBotMentioned) {
      console.log(`🗣️ Bot dimention oleh ${sender} di grup ${from} dengan pesan: ${teks}`);

      const last = groupCooldown[from] || 0;
      const now = Date.now();
      if (now - last < 10000) {
        console.log('⏳ Masih dalam waktu tunggu grup. Tidak membalas.');
        return;
      }
      groupCooldown[from] = now;

      await delay(2000); // Delay singkat

      const lowerCaseText = teks.toLowerCase();
      let command = null;
      let params = {};
      let replyPromise = null;
      
      // --- Logika AI ---
      if (lowerCaseText.includes('tanya')) {
          const question = teks.replace(/@\d+\s*/, '').replace(/tanya/i, '').trim();
          if (question) {
              await sock.sendMessage(from, { text: `🤔 Sedang memikirkan jawaban untuk: "*${question}*"` });
              const aiResponse = await getGroqChatCompletion(question);
              await sock.sendMessage(from, { text: aiResponse, mentions: [sender] });
          } else {
              await sock.sendMessage(from, { text: `Halo @${sender.split('@')[0]}, mau tanya apa?`, mentions: [sender] });
          }
          return; // Hentikan eksekusi setelah menangani AI
      }
      // --- AKHIR DARI Logika AI ---

      // ... (logika lainnya untuk NOO, omset, cek stock, dll tetap di sini)
      if (lowerCaseText.includes('noo')) {
        const locMessage = msg.message.locationMessage || msg.message.extendedTextMessage?.contextInfo?.quotedMessage?.locationMessage;
        if (locMessage) {
            command = 'check_nearby_stores';
            params = {
                latitude: locMessage.degreesLatitude,
                longitude: locMessage.degreesLongitude,
                sender: sender,
                message: teks
            };
            await sock.sendMessage(from, { text: `⏳ Siap! Menyimpan dan memeriksa lokasi untuk NOO...` });
            replyPromise = getDataFromServer(command, params);
        } else {
             await sock.sendMessage(from, { text: `Halo @${sender.split('@')[0]}! Untuk perintah *NOO*, mohon sertakan juga *lampiran lokasi*.`, mentions: [sender] });
        }

      }
      else if (lowerCaseText.includes('foto toko')) {
        const imageMsg = msg.message.imageMessage || msg.message.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;
          const tagMatch = teks.match(/#(\w+)/);
          
          if (imageMsg && tagMatch) {
              await sock.sendMessage(from, { text: `⏳ Oke, foto toko dengan tagar #${tagMatch[1]} diterima. Mengunggah...` });

              const stream = await downloadContentFromMessage(imageMsg, 'image');
              let buffer = Buffer.from([]);
              for await (const chunk of stream) {
                  buffer = Buffer.concat([buffer, chunk]);
              }
              
              const tempDir = path.join(__dirname, 'temp');
              if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);
              const tempFilePath = path.join(tempDir, `${Date.now()}.jpg`);
              fs.writeFileSync(tempFilePath, buffer);

              const params = {
                  sender: sender,
                  caption: teks,
                  file_path: tempFilePath
              };
              
              const serverResponse = await uploadFotoToko(params);
              await sock.sendMessage(from, { text: serverResponse, mentions: [sender] });
              fs.unlinkSync(tempFilePath);
              return;

          } else {
              await sock.sendMessage(from, { text: `Halo @${sender.split('@')[0]}, untuk perintah *foto toko*, Anda harus mengirim *foto* dengan *caption* yang mengandung tagar.`, mentions: [sender] });
              return;
          }
  
           

       

      }
      else if (lowerCaseText.includes('omset')) {
        command = 'get_total_omset';
        const monthMatch = lowerCaseText.match(/bulan\s+(\d{1,2})/);
        const yearMatch = lowerCaseText.match(/tahun\s+(\d{4})/);
        if (monthMatch && yearMatch) {
            params = { month: monthMatch[1], year: yearMatch[1] };
            await sock.sendMessage(from, { text: `⏳ Siap! Menghitung total omset untuk bulan ${params.month} tahun ${params.year}...` });
        } else {
            await sock.sendMessage(from, { text: `⏳ Siap! Menghitung total omset bulan ini...` });
        }
        replyPromise = getDataFromServer(command, params);

      } else if (lowerCaseText.includes('cek stock') || lowerCaseText.includes('cek stok')) {
        command = 'check_stock';
        const itemQuery = lowerCaseText.replace(/@\d+\s*/, '').replace(/cek st(o|ó)ck/i, '').trim();
        if (itemQuery) {
            params.item = itemQuery;
            await sock.sendMessage(from, { text: `⏳ Siap! Mengecek stok untuk *${itemQuery}*...` });
        } else {
            await sock.sendMessage(from, { text: `⏳ Siap! Mengecek semua stok...` });
        }
        replyPromise = getDataFromServer(command, params);
        
      } else if (lowerCaseText.includes('laporan penjualan')) {
         // ... (logika laporan penjualan tidak berubah)
         const dateRegex = /(\d{4}-\d{2}-\d{2})/g;
         const match = lowerCaseText.match(dateRegex);
 
         if (match && match.length === 2) {
             const startDate = match[0];
             const endDate = match[1];
             command = 'get_sales_report';
             params.startDate = startDate;
             params.endDate = endDate;
             
             await sock.sendMessage(from, { text: `⏳ Siap! Membuat laporan penjualan Excel dari tanggal ${startDate} hingga ${endDate}...` });
             
             const salesData = await getDataFromServer(command, params, false);
 
             if (salesData && Array.isArray(salesData) && data.length > 0) {
                 const workbook = new ExcelJS.Workbook();
                 const worksheet = workbook.addWorksheet('Laporan Penjualan');
                 worksheet.columns = Object.keys(salesData[0]).map(key => ({ header: key.toUpperCase(), key: key, width: 20 }));
                 worksheet.addRows(salesData);
                 const fileName = `laporan_${startDate}_to_${endDate}.xlsx`;
                 const filePath = path.join(__dirname, fileName);
                 await workbook.xlsx.writeFile(filePath);
 
                 await sock.sendMessage(from, {
                     document: { url: filePath },
                     mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                     fileName: `Laporan Penjualan ${startDate} - ${endDate}.xlsx`,
                     caption: `Berikut adalah laporan penjualan untuk rentang tanggal ${startDate} hingga ${endDate}.`
                 });
 
                 fs.unlinkSync(filePath);
                 console.log(`✅ Laporan Excel untuk ${startDate} - ${endDate} berhasil dikirim dan dihapus.`);
 
             } else {
                 await sock.sendMessage(from, { text: `Maaf, tidak ada data penjualan yang ditemukan untuk rentang tanggal ${startDate} - ${endDate}.`});
             }
             return; // Hentikan karena sudah mengirim dokumen
         } else {
             await sock.sendMessage(from, { text: `Halo @${sender.split('@')[0]}! Untuk laporan penjualan, sertakan 2 tanggal (YYYY-MM-DD).`, mentions: [sender] });
         }

      } else {
        const defaultReply = `Halo @${sender.split('@')[0]}! *NOO* (sertakan lokasi Foto Toko, dan KTP)\n`;
        await sock.sendMessage(from, { text: defaultReply, mentions: [sender] });
      }
      
      if (replyPromise) {
        const replyFromServer = await replyPromise;
        await sock.sendMessage(from, { 
            text: replyFromServer,
            mentions: [sender]
        });
      }
    }
  });
}

// ... (kode app.get, app.listen, dll tidak berubah)
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


start();
