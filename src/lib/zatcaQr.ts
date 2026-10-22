// ZATCA phase-1 (simplified tax invoice) QR payload: TLV records, Base64.
// Tags: 1 seller name, 2 VAT number, 3 timestamp (ISO 8601), 4 total incl. VAT,
// 5 VAT total. Each length is the value's size in UTF-8 BYTES (an Arabic letter
// is 2 bytes) in one byte, so a value can be at most 255 bytes.

export type ZatcaFields = { seller: string; vatNumber: string; timestamp: string; total: string; vat: string }

export function zatcaTlvBase64(f: ZatcaFields): string {
  const encoder = new TextEncoder()
  const bytes: number[] = []
  ;[f.seller, f.vatNumber, f.timestamp, f.total, f.vat].forEach((value, i) => {
    const encoded = encoder.encode(value)
    if (encoded.length > 255) throw new Error(`ZATCA tag ${i + 1} is longer than 255 bytes`)
    bytes.push(i + 1, encoded.length, ...encoded)
  })
  return btoa(String.fromCharCode(...bytes))
}

/** The reverse, for tests and checks: values in tag order. */
export function decodeZatcaTlv(base64: string): string[] {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
  const values: string[] = []
  for (let i = 0; i < bytes.length; i += 2 + bytes[i + 1]) {
    values[bytes[i] - 1] = new TextDecoder().decode(bytes.slice(i + 2, i + 2 + bytes[i + 1]))
  }
  return values
}
