require('dotenv').config()
const TelegramBot = require('node-telegram-bot-api')
const fs = require('fs')
const path = require('path')
const axios = require('axios')
const moment = require('moment-timezone')

const { connectBaileys, isConnectedStatus } = require('./baileys')
const { parseNumbersFromText, processBatch, BATCH_SIZE } = require('./checker')
const { formatOutputFile } = require('./formatter')
const { normalizePhoneNumber } = require('./phone')

const BOT_TOKEN = process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN
const TIMEZONE = process.env.TIMEZONE || 'Asia/Jakarta'
const BOT_NAME = process.env.BOT_NAME || '@YourBotName'
const SESSION_FOLDER = process.env.SESSION_FOLDER || './session'

if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN tidak ditemukan di environment variables')
  process.exit(1)
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true })

// Track status per chat
const sessions = {} // chatId → { paired: bool, processing: bool }

// Temp folder untuk file output
const TEMP_DIR = './temp'
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true })

// ─────────────────────────────────────────
// COMMAND: /start
// ─────────────────────────────────────────
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id
  bot.sendMessage(
    chatId,
    `🤖 *WA Checker Bot*\n\nBot untuk cek info akun WhatsApp.\n\n*Cara pakai:*\n1. \`/pair +628xxxxxxxxxx\` atau \`/pair +15551234567\` — Connect WA\n2. Upload file \`.txt\` berisi nomor WA\n3. Bot akan proses dan kirim hasil\n\n*Klasifikasi:*\n✅ Exclusive / Verified Meta\n🏢 Standard Business\n🏪 Low Business\n👤 Personal\n❌ Tidak Terdaftar`,
    { parse_mode: 'Markdown' }
  )
})

// ─────────────────────────────────────────
// COMMAND: /pair <nomor>
// ─────────────────────────────────────────
bot.onText(/^\/pair(?:\s+(.+))?$/, async (msg, match) => {
  const chatId = msg.chat.id

  if (isConnectedStatus()) {
    return bot.sendMessage(chatId, '✅ WhatsApp sudah terhubung! Silakan upload file .txt nomor.')
  }

  if (sessions[chatId]?.pairing) {
    return bot.sendMessage(chatId, '⏳ Sedang proses pairing, tunggu sebentar...')
  }

  if (!match[1]) {
    return bot.sendMessage(
      chatId,
      '⚠️ Masukkan nomor pairing. Contoh: `/pair +628123456789`, `/pair +15551234567`, atau `/pair 60123456789`.',
      { parse_mode: 'Markdown' }
    )
  }

  const phoneNumber = normalizePhoneNumber(match[1])

  if (!phoneNumber) {
    return bot.sendMessage(
      chatId,
      '⚠️ Format nomor tidak valid. Pakai format internasional dengan country code, contoh: `/pair +628123456789`, `/pair +15551234567`, atau `/pair 60123456789`.',
      { parse_mode: 'Markdown' }
    )
  }

  sessions[chatId] = { pairing: true, processing: false }

  await bot.sendMessage(
    chatId,
    `📱 Meminta pairing code untuk nomor *+${phoneNumber}*...\n\nTunggu sebentar...`,
    { parse_mode: 'Markdown' }
  )

  try {
    await connectBaileys(
      // QR callback (fallback jika pairing code gagal)
      async (qr) => {
        try {
          const QRCode = require('qrcode')
          const qrPath = path.join(TEMP_DIR, `qr_${chatId}.png`)
          await QRCode.toFile(qrPath, qr, { width: 512 })
          await bot.sendPhoto(chatId, qrPath, {
            caption: '📷 Scan QR ini dengan WhatsApp kamu (Settings → Linked Devices → Link a Device)',
          })
          fs.unlinkSync(qrPath)
        } catch (e) {
          bot.sendMessage(chatId, '⚠️ Gagal generate QR. Coba /pair ulang.')
        }
      },
      // Pairing code callback
      (code) => {
        const formatted = code.match(/.{1,4}/g).join('-')
        bot.sendMessage(
          chatId,
          `🔑 *Pairing Code kamu:*\n\n\`${formatted}\`\n\nCara input:\n1. Buka WhatsApp di HP\n2. Settings → Linked Devices\n3. Link with Phone Number\n4. Masukkan kode di atas\n\n⏳ Menunggu konfirmasi...`,
          { parse_mode: 'Markdown' }
        )
      },
      phoneNumber
    )

    sessions[chatId].pairing = false
    bot.sendMessage(
      chatId,
      '✅ *WhatsApp berhasil terhubung!*\n\nSekarang upload file `.txt` berisi daftar nomor WA yang mau dicek.',
      { parse_mode: 'Markdown' }
    )
  } catch (e) {
    sessions[chatId].pairing = false
    console.error('Pairing error:', e)
    bot.sendMessage(chatId, `❌ Gagal connect: ${e.message}\n\nCoba /pair lagi.`)
  }
})

// ─────────────────────────────────────────
// COMMAND: /status
// ─────────────────────────────────────────
bot.onText(/\/status/, (msg) => {
  const chatId = msg.chat.id
  const connected = isConnectedStatus()
  bot.sendMessage(
    chatId,
    connected
      ? '✅ WhatsApp *terhubung* dan siap digunakan.'
      : '❌ WhatsApp *belum terhubung*. Gunakan /pair untuk connect.',
    { parse_mode: 'Markdown' }
  )
})

// ─────────────────────────────────────────
// COMMAND: /help
// ─────────────────────────────────────────
bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id
  bot.sendMessage(
    chatId,
    `📖 *Panduan WA Checker Bot*\n\n*Commands:*\n/pair \`+[countrycode][nomor]\` — Connect WA, contoh \`+628xxxx\` atau \`+1555xxxx\`\n/status — Cek status koneksi\n/help — Panduan ini\n\n*Format file .txt:*\nSatu nomor per baris, contoh:\n\`\`\`\n628123456789\n08111222333\n+15551234567\n60123456789\n+447700900123\n\`\`\`\n\n*Batch Size:* ${BATCH_SIZE} nomor per batch\n\n*Klasifikasi output:*\n✅ Exclusive = Verified Meta (centang biru)\n🏢 Standard = verifiedName ada\n🏪 Low = Bisnis tanpa verifiedName\n👤 Personal = Akun biasa\n❌ Invalid = Tidak terdaftar di WA`,
    { parse_mode: 'Markdown' }
  )
})

// ─────────────────────────────────────────
// HANDLER: File .txt upload
// ─────────────────────────────────────────
bot.on('document', async (msg) => {
  const chatId = msg.chat.id
  const doc = msg.document

  // Validasi ekstensi
  if (!doc.file_name?.endsWith('.txt')) {
    return bot.sendMessage(chatId, '⚠️ Hanya file `.txt` yang diterima.')
  }

  // Cek koneksi WA
  if (!isConnectedStatus()) {
    return bot.sendMessage(
      chatId,
      '❌ WhatsApp belum terhubung!\n\nGunakan /pair dulu sebelum upload file.'
    )
  }

  // Cek kalau lagi processing
  if (sessions[chatId]?.processing) {
    return bot.sendMessage(chatId, '⏳ Masih ada proses yang berjalan, tunggu selesai dulu.')
  }

  sessions[chatId] = { ...sessions[chatId], processing: true }

  const statusMsg = await bot.sendMessage(chatId, '📂 Membaca file...')

  try {
    // Download file dari Telegram
    const fileLink = await bot.getFileLink(doc.file_id)
    const response = await axios.get(fileLink, { responseType: 'text' })
    const fileContent = response.data

    // Parse nomor
    const numbers = parseNumbersFromText(fileContent)

    if (numbers.length === 0) {
      sessions[chatId].processing = false
      return bot.editMessageText('❌ Tidak ada nomor valid di file.', {
        chat_id: chatId,
        message_id: statusMsg.message_id,
      })
    }

    await bot.editMessageText(
      `📋 *${numbers.length} nomor ditemukan*\n⚡ Batch size: ${BATCH_SIZE}\n🔄 Mulai proses...`,
      { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'Markdown' }
    )

    const startTime = Date.now()
    let lastUpdate = Date.now()

    // Proses dengan progress update
    const results = await processBatch(numbers, (done, total, latest) => {
      // Update progress tiap 5 nomor atau tiap 3 detik
      if (done % 5 === 0 || Date.now() - lastUpdate > 3000) {
        lastUpdate = Date.now()
        const pct = Math.round((done / total) * 100)
        const typeEmoji = {
          exclusive: '✅',
          standard_business: '🏢',
          low_business: '🏪',
          personal: '👤',
          invalid: '❌',
        }
        bot
          .editMessageText(
            `🔄 *Memproses... ${pct}%* (${done}/${total})\n\nTerakhir: ${typeEmoji[latest.type] || '?'} ${latest.number}`,
            { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'Markdown' }
          )
          .catch(() => {})
      }
    })

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1)

    // Format output
    const outputText = formatOutputFile(results, totalTime, BATCH_SIZE)

    // Simpan ke file temp
    const timestamp = moment().tz(TIMEZONE).format('YYYYMMDD_HHmmss')
    const outputPath = path.join(TEMP_DIR, `hasil_${timestamp}.txt`)
    fs.writeFileSync(outputPath, outputText, 'utf8')

    // Hitung summary
    const summary = results.reduce((acc, r) => {
      acc[r.type] = (acc[r.type] || 0) + 1
      return acc
    }, {})

    // Update status message
    await bot.editMessageText(
      `✅ *Selesai!* ${results.length} nomor diproses dalam ${totalTime}s`,
      { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'Markdown' }
    )

    // Kirim ringkasan
    await bot.sendMessage(
      chatId,
      `📊 *Ringkasan Hasil*\n\n✅ Exclusive/Verified Meta : ${summary.exclusive || 0}\n🏢 Standard Business       : ${summary.standard_business || 0}\n🏪 Low Business            : ${summary.low_business || 0}\n👤 Personal                : ${summary.personal || 0}\n❌ Tidak Terdaftar         : ${summary.invalid || 0}\n─────────────────────\n📊 Total: ${results.length} nomor\n⚡ Waktu: ${totalTime}s`,
      { parse_mode: 'Markdown' }
    )

    // Kirim file hasil
    await bot.sendDocument(chatId, outputPath, {
      caption: `📄 Hasil cek ${results.length} nomor WA`,
    })

    // Hapus file temp
    fs.unlinkSync(outputPath)
  } catch (e) {
    console.error('Processing error:', e)
    bot.sendMessage(chatId, `❌ Error: ${e.message}`)
  } finally {
    sessions[chatId].processing = false
  }
})

// ─────────────────────────────────────────
// Reconnect saat bot start jika ada session
// ─────────────────────────────────────────
;(async () => {
  const sessionExists =
    fs.existsSync(SESSION_FOLDER) && fs.readdirSync(SESSION_FOLDER).length > 0

  if (sessionExists) {
    console.log('🔄 Reconnecting saved session...')
    try {
      await connectBaileys(null, null)
      console.log('✅ Auto-reconnected!')
    } catch (e) {
      console.log('⚠️ Auto-reconnect gagal, tunggu /pair manual')
    }
  }

  console.log(`🤖 WA Checker Bot running... (${BOT_NAME})`)
})()
