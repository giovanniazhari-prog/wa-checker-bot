const moment = require('moment-timezone')

const TIMEZONE = process.env.TIMEZONE || 'Asia/Jakarta'
const BOT_NAME = process.env.BOT_NAME || '@YourBotName'

// ─────────────────────────────────────────
// Helper: format menit → HH.mm
// ─────────────────────────────────────────
function formatTime(minutes) {
  if (!minutes && minutes !== 0) return '?'
  const h = Math.floor(minutes / 60).toString().padStart(2, '0')
  const m = (minutes % 60).toString().padStart(2, '0')
  return `${h}.${m}`
}

// ─────────────────────────────────────────
// Helper: format jam buka bisnis
// ─────────────────────────────────────────
function formatBusinessHours(businessHours) {
  if (!businessHours) return null

  const config = businessHours.config || businessHours.business_config
  if (!config || config.length === 0) return null

  const shortDay = {
    Monday: 'Sen', Tuesday: 'Sel', Wednesday: 'Rab',
    Thursday: 'Kam', Friday: 'Jum', Saturday: 'Sabtu', Sunday: 'Minggu',
  }

  const groups = []
  let cur = null

  for (const day of config) {
    const open  = day.mode === 'close' ? null : formatTime(day.open_time)
    const close = day.mode === 'close' ? null : formatTime(day.close_time)
    const key   = day.mode === 'close' ? 'TUTUP' : `${open}-${close}`

    if (cur && cur.key === key) {
      cur.days.push(day.day_of_week)
    } else {
      if (cur) groups.push(cur)
      cur = { days: [day.day_of_week], key, mode: day.mode }
    }
  }
  if (cur) groups.push(cur)

  return groups.map((g, i) => {
    const d0  = shortDay[g.days[0]] || g.days[0]
    const dN  = shortDay[g.days[g.days.length - 1]] || g.days[g.days.length - 1]
    const day = g.days.length > 1 ? `${d0}-${dN}` : d0
    const time = g.mode === 'close' ? 'Tutup' : g.key
    const pad  = i === 0 ? '' : '          '
    return `${pad}${day.padEnd(7)} ${time}`
  }).join('\n')
}

// ─────────────────────────────────────────
// Label status
// ─────────────────────────────────────────
function statusLabel(type, withEmoji = false) {
  const map = {
    exclusive:         withEmoji ? 'Business · Verified Meta ✅' : 'Business · Verified Meta',
    standard_business: withEmoji ? 'Business · Standard 🏢'     : 'Business · Standard',
    low_business:      withEmoji ? 'Business · Low 🏪'           : 'Business · Low',
    personal:          withEmoji ? 'Personal 👤'                 : 'Personal',
    invalid:           withEmoji ? 'Tidak terdaftar ❌'           : 'Tidak terdaftar',
  }
  return map[type] || type
}

// ─────────────────────────────────────────
// FORMAT CARD — untuk pesan Telegram
// ─────────────────────────────────────────
function formatCard(data) {
  const now = moment().tz(TIMEZONE).format('DD MMM YYYY · HH:mm z')
  const L   = []

  L.push(`[ WA Checker · ${BOT_NAME} ]`)
  L.push('')
  L.push(`Nomor     ${data.number}`)
  L.push(`Status    ${statusLabel(data.type, true)}`)

  if (data.type === 'invalid') {
    L.push('')
    L.push(`${now} · ${data.elapsed}s`)
    return L.join('\n')
  }

  L.push(`Foto PP   ${data.hasPP ? 'Ada' : 'Tidak ada'}`)

  L.push('')
  L.push('— Profile —')
  L.push(`Nama      ${data.name || '-'}`)
  L.push(`Bio       ${data.bio  || '-'}`)

  if (data.type === 'personal') {
    L.push('')
    L.push(`${now} · ${data.elapsed}s`)
    return L.join('\n')
  }

  if (data.bizProfile) {
    const biz  = data.bizProfile
    const webs = biz.website?.length ? biz.website.join(', ') : '-'
    const jam  = formatBusinessHours(biz.business_hours)

    L.push('')
    L.push('— Business —')
    L.push(`Kategori  ${biz.category || '-'}`)
    L.push(`Email     ${biz.email    || '-'}`)
    L.push(`Website   ${webs}`)
    L.push(`Alamat    ${biz.address  || '-'}`)
    if (jam) L.push(`Jam Buka  ${jam}`)
  }

  L.push('')
  L.push(`${now} · ${data.elapsed}s`)
  return L.join('\n')
}

// ─────────────────────────────────────────
// FORMAT FILE — output .txt batch lengkap
// ─────────────────────────────────────────
function formatOutputFile(results, totalTime, batchSize) {
  const now = moment().tz(TIMEZONE).format('DD MMM YYYY · HH:mm z')

  const sections = {
    exclusive:         [],
    standard_business: [],
    low_business:      [],
    personal:          [],
    invalid:           [],
  }
  for (const r of results) sections[r.type]?.push(r)

  const active = results.length - sections.invalid.length
  const S      = sections
  const L      = []

  // Header
  L.push(`[ WA Checker · ${BOT_NAME} ]`)
  L.push('')
  L.push(`Tanggal   ${now}`)
  L.push(`Total     ${results.length} nomor  ·  ${active} aktif  ·  ${S.invalid.length} invalid  ·  ${totalTime}s`)
  L.push(`Batch     ${batchSize} per batch`)
  L.push('')
  L.push(`Verified  ${S.exclusive.length}   Standard  ${S.standard_business.length}   Low Biz  ${S.low_business.length}   Personal  ${S.personal.length}   Invalid  ${S.invalid.length}`)

  // Sections
  const defs = [
    { key: 'exclusive',         label: 'Verified Meta'     },
    { key: 'standard_business', label: 'Standard Business' },
    { key: 'low_business',      label: 'Low Business'      },
    { key: 'personal',          label: 'Personal'          },
    { key: 'invalid',           label: 'Tidak Terdaftar'   },
  ]

  for (const { key, label } of defs) {
    const items = sections[key]
    if (!items.length) continue

    L.push('')
    L.push(`— ${label} (${items.length}) —`)

    for (const item of items) {
      L.push('')
      L.push(`Nomor     ${item.number}`)
      L.push(`Status    ${statusLabel(item.type)}`)

      if (item.type === 'invalid') {
        L.push('─'.repeat(40))
        continue
      }

      L.push(`Foto PP   ${item.hasPP ? 'Ada' : 'Tidak ada'}`)
      L.push('')
      L.push('— Profile —')
      L.push(`Nama      ${item.name || '-'}`)
      L.push(`Bio       ${item.bio  || '-'}`)

      if (item.bizProfile) {
        const biz  = item.bizProfile
        const webs = biz.website?.length ? biz.website.join(', ') : '-'
        const jam  = formatBusinessHours(biz.business_hours)

        L.push('')
        L.push('— Business —')
        L.push(`Kategori  ${biz.category || '-'}`)
        L.push(`Email     ${biz.email    || '-'}`)
        L.push(`Website   ${webs}`)
        L.push(`Alamat    ${biz.address  || '-'}`)
        if (jam) L.push(`Jam Buka  ${jam}`)
      }

      L.push('')
      L.push(`${now} · ${item.elapsed}s`)
      L.push('─'.repeat(40))
    }
  }

  return L.join('\n')
}

module.exports = { formatCard, formatOutputFile }
