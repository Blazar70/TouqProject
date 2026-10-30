import { useRef } from 'react'

// One random key per save attempt (0102): pressing Save again after the answer was lost (Wi-Fi dropped after the
// server saved) sends the same key, so the server returns the first result instead of billing twice.
// A fresh key once a save is known to have worked.
export function useRequestKey() {
  const key = useRef(crypto.randomUUID())
  return {
    current: () => key.current,
    renew: () => {
      key.current = crypto.randomUUID()
    },
  }
}
