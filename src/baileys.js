const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  getBinaryNodeChild,
} = require('baileys')
const pino = require('pino')
const fs = require('fs')

const SESSION_FOLDER = process.env.SESSION_FOLDER || './session'
const PAIRING_TIMEOUT_MS = parseInt(process.env.PAIRING_TIMEOUT_MS, 10) || 120000

let sock = null
let isConnected = false

const logger = pino({ level: process.env.BAILEYS_LOG_LEVEL || 'silent' })

async function connectBaileys(onQR, onPairingCode, phoneNumber = null) {
  if (!fs.existsSync(SESSION_FOLDER)) {
    fs.mkdirSync(SESSION_FOLDER, { recursive: true })
  }

  const { state, saveCreds } = await useMultiFileAuthState(SESSION_FOLDER)
  const { version } = await fetchLatestBaileysVersion()

  let settled = false
  let pairingRequested = false
  let timeout = null

  const settle = (fn, value) => {
    if (settled) return
    settled = true
    if (timeout) clearTimeout(timeout)
    fn(value)
  }

  const waitForConnection = new Promise((resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new Error('Timeout menunggu koneksi WhatsApp. Coba /pair ulang atau pakai QR fallback.'))
    }, PAIRING_TIMEOUT_MS)

    sock = makeWASocket({
      version,
      logger,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      printQRInTerminal: false,
      browser: ['WA Checker Bot', 'Chrome', '120.0.0'],
      generateHighQualityLinkPreview: false,
      syncFullHistory: false,
    })

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update

      if (qr && onQR) {
        onQR(qr)
      }

      // Baileys minta pairing code setelah socket masuk connecting / QR event.
      if (
        phoneNumber &&
        !sock.authState.creds.registered &&
        !pairingRequested &&
        (connection === 'connecting' || qr)
      ) {
        pairingRequested = true
        try {
          const code = await sock.requestPairingCode(phoneNumber)
          if (onPairingCode) onPairingCode(code)
        } catch (e) {
          settle(reject, new Error(`Gagal request pairing code: ${e.message}`))
        }
      }

      if (connection === 'open') {
        isConnected = true
        console.log('✅ WhatsApp Connected!')
        settle(resolve, true)
      }

      if (connection === 'close') {
        isConnected = false
        const statusCode = lastDisconnect?.error?.output?.statusCode
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut
        console.log('❌ Connection closed. Reconnect:', shouldReconnect)

        if (shouldReconnect) {
          setTimeout(() => {
            connectBaileys(onQR, onPairingCode, phoneNumber)
              .then((value) => settle(resolve, value))
              .catch((err) => settle(reject, err))
          }, 3000)
        } else {
          settle(reject, new Error('Session WhatsApp logout. Hapus folder session lalu /pair ulang.'))
        }
      }
    })
  })

  return waitForConnection
}

function getSocket() {
  return sock
}

function isConnectedStatus() {
  return isConnected
}

function ensureSocketReady() {
  if (!sock || !isConnected) {
    throw new Error('WhatsApp belum terhubung')
  }
}

/**
 * Cek apakah nomor terdaftar di WA
 */
async function checkOnWhatsApp(number) {
  try {
    ensureSocketReady()
    const result = await sock.onWhatsApp(number)
    if (!result || result.length === 0) return null
    return result[0]
  } catch (e) {
    return null
  }
}

/**
 * Ambil status/bio WA
 */
async function getStatus(jid) {
  try {
    ensureSocketReady()
    const result = await sock.fetchStatus(jid)
    return result?.status || null
  } catch (e) {
    return null
  }
}

/**
 * Cek apakah ada foto profil
 */
async function getProfilePicture(jid) {
  try {
    ensureSocketReady()
    const url = await sock.profilePictureUrl(jid, 'image')
    return url ? true : false
  } catch (e) {
    return false
  }
}

/**
 * Ambil business profile
 */
async function getBusinessProfile(jid) {
  try {
    ensureSocketReady()
    const result = await sock.getBusinessProfile(jid)
    return result || null
  } catch (e) {
    return null
  }
}

/**
 * Ambil verifiedName dari contact
 * Ini yang jadi pembeda Standard vs Low Business
 */
async function getVerifiedName(jid) {
  try {
    ensureSocketReady()

    // Query raw ke WA server untuk ambil verifiedName
    const result = await sock.query({
      tag: 'iq',
      attrs: {
        to: jid,
        type: 'get',
        xmlns: 'w:biz',
      },
      content: [
        {
          tag: 'verified_name',
          attrs: {},
        },
      ],
    })

    const verifiedNameNode = getBinaryNodeChild(result, 'verified_name')
    if (!verifiedNameNode) return null

    const vnameCertNode = getBinaryNodeChild(verifiedNameNode, 'vname_cert')
    if (!vnameCertNode) return null

    // Cek level verifikasi Meta
    // level 2 = Official Business Account (Verified Meta)
    const verifiedLevel = verifiedNameNode.attrs?.level
      ? parseInt(verifiedNameNode.attrs.level, 10)
      : null

    const name =
      typeof vnameCertNode.content === 'string'
        ? vnameCertNode.content
        : vnameCertNode.content?.toString() || null

    return {
      name,
      level: verifiedLevel, // 1 = Standard, 2 = Exclusive/Meta Verified
    }
  } catch (e) {
    return null
  }
}

/**
 * Klasifikasi akun WA
 * Returns: 'invalid' | 'personal' | 'low_business' | 'standard_business' | 'exclusive'
 */
async function classifyAccount(number) {
  const startTime = Date.now()

  // Format nomor
  const cleanNumber = number.replace(/[^0-9]/g, '')
  const jid = `${cleanNumber}@s.whatsapp.net`

  // Step 1: Cek apakah ada di WA
  const onWA = await checkOnWhatsApp(cleanNumber)
  if (!onWA || !onWA.exists) {
    return {
      number: `+${cleanNumber}`,
      type: 'invalid',
      elapsed: ((Date.now() - startTime) / 1000).toFixed(1),
    }
  }

  const normalizedJid = onWA.jid || jid

  // Step 2: Ambil semua info paralel
  const [bizProfile, verifiedInfo, status, hasPP] = await Promise.all([
    getBusinessProfile(normalizedJid),
    getVerifiedName(normalizedJid),
    getStatus(normalizedJid),
    getProfilePicture(normalizedJid),
  ])

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)

  // Step 3: Klasifikasi
  // Bukan bisnis sama sekali
  if (!bizProfile) {
    return {
      number: `+${cleanNumber}`,
      type: 'personal',
      name: verifiedInfo?.name || null,
      bio: status,
      hasPP,
      elapsed,
    }
  }

  // Bisnis dengan Meta Verified (level 2)
  if (verifiedInfo?.level === 2) {
    return {
      number: `+${cleanNumber}`,
      type: 'exclusive',
      name: verifiedInfo.name || bizProfile.wid || null,
      bio: status,
      hasPP,
      bizProfile,
      verifiedName: verifiedInfo.name,
      elapsed,
    }
  }

  // Bisnis dengan verifiedName tapi bukan Meta Verified → Standard
  if (verifiedInfo?.name) {
    return {
      number: `+${cleanNumber}`,
      type: 'standard_business',
      name: verifiedInfo.name,
      bio: status,
      hasPP,
      bizProfile,
      verifiedName: verifiedInfo.name,
      elapsed,
    }
  }

  // Bisnis tanpa verifiedName → Low Business
  return {
    number: `+${cleanNumber}`,
    type: 'low_business',
    name: null,
    bio: status,
    hasPP,
    bizProfile,
    elapsed,
  }
}

module.exports = {
  connectBaileys,
  getSocket,
  isConnectedStatus,
  classifyAccount,
}
