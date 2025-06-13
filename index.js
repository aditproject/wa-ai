const { default: makeWASocket, useSingleFileAuthState } = require('@whiskeysockets/baileys');

const { state, saveState } = useSingleFileAuthState('./auth_info.json');

async function startBot() {
  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true,
  });

  sock.ev.on('creds.update', saveState);

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;
    const pesan = msg.message.conversation || msg.message.extendedTextMessage?.text;
    console.log('Pesan masuk:', pesan);
    await sock.sendMessage(msg.key.remoteJid, { text: 'Halo! Saya sudah terima pesan kamu.' });
  });
}

startBot();
