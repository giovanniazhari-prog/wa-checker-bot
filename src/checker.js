const { classifyAccount } = require('./baileys')
const { normalizePhoneNumber } = require('./phone')

const DELAY_MS = parseInt(process.env.DELAY_MS) || 500
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE) || 50

/**
 * Delay helper
 */
const delay = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Parse file .txt → array nomor
 */
function parseNumbersFromText(text) {
  const lines = text.split('\n')
  const numbers = []

  for (let line of lines) {
    line = line.trim()
    if (!line) continue

    const clean = normalizePhoneNumber(line)
    if (!clean) continue

    numbers.push(clean)
  }

  // Hapus duplikat
  return [...new Set(numbers)]
}

/**
 * Proses batch nomor dengan concurrency terkontrol
 */
async function processBatch(numbers, onProgress) {
  const results = []
  const batches = []

  // Split ke chunk sesuai BATCH_SIZE
  for (let i = 0; i < numbers.length; i += BATCH_SIZE) {
    batches.push(numbers.slice(i, i + BATCH_SIZE))
  }

  let processed = 0

  for (const batch of batches) {
    // Proses satu batch secara paralel
    const batchPromises = batch.map(async (number) => {
      const result = await classifyAccount(number)
      processed++
      if (onProgress) onProgress(processed, numbers.length, result)
      return result
    })

    const batchResults = await Promise.all(batchPromises)
    results.push(...batchResults)

    // Delay antar batch
    if (batches.indexOf(batch) < batches.length - 1) {
      await delay(DELAY_MS)
    }
  }

  return results
}

module.exports = { parseNumbersFromText, processBatch, BATCH_SIZE }
