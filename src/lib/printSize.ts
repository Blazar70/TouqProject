// Nightly H25: the paper this device's receipt printer takes (invoices, credit notes, deposit
// receipts). Per device, not per clinic: the front-desk 80 mm printer and an office A4 printer differ.
export type ReceiptSize = 'a4' | '80mm'

const KEY = 'touq-receipt-size'

export function getReceiptSize(): ReceiptSize {
  try {
    return localStorage.getItem(KEY) === '80mm' ? '80mm' : 'a4'
  } catch {
    return 'a4'
  }
}

export function setReceiptSize(size: ReceiptSize) {
  try {
    localStorage.setItem(KEY, size)
  } catch {
    // Storage blocked (private mode): prints stay A4.
  }
}
