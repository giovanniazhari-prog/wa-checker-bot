/**
 * Normalisasi nomor telepon ke format E.164 tanpa tanda +.
 *
 * Aturan:
 * - +15551234567      -> 15551234567
 * - 0015551234567     -> 15551234567
 * - 08xxxxxxxx        -> 628xxxxxxxx  (shortcut lokal Indonesia)
 * - 60123456789       -> 60123456789  (tidak dipaksa jadi 62)
 *
 * Catatan: nomor pairing Baileys butuh country code dan hanya digit.
 */
function normalizePhoneNumber(input) {
  if (input === null || input === undefined) return null

  let clean = String(input).trim()

  // Buang spasi, strip, kurung, dll; simpan digit dan + sementara.
  clean = clean.replace(/[^\d+]/g, '')

  // Format internasional umum: 00[countrycode][number]
  if (clean.startsWith('00')) {
    clean = clean.slice(2)
  }

  // Hapus leading + kalau ada, lalu pastikan sisanya digit saja.
  clean = clean.replace(/^\+/, '').replace(/\D/g, '')

  // Shortcut nomor lokal Indonesia: 08xxx -> 628xxx.
  // Selain pola ini, jangan auto tambah 62 agar bebas negara mana aja.
  if (clean.startsWith('08')) {
    clean = `62${clean.slice(1)}`
  }

  // E.164: country code tidak boleh mulai 0, total max 15 digit.
  if (!/^[1-9]\d{7,14}$/.test(clean)) return null

  return clean
}

module.exports = { normalizePhoneNumber }
