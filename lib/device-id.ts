const DEVICE_ID_KEY = 'finance-sys-device-id'

/**
 * Get or generate a unique device ID for this browser.
 * This ID is used to identify the user across devices for multi-device sync.
 */
export function getDeviceId(): string {
  if (typeof window === 'undefined') {
    return ''
  }

  let deviceId = localStorage.getItem(DEVICE_ID_KEY)

  if (!deviceId) {
    deviceId = generateDeviceId()
    localStorage.setItem(DEVICE_ID_KEY, deviceId)
  }

  return deviceId
}

/**
 * Generate a unique device ID.
 * Uses crypto.randomUUID if available, falls back to a timestamp + random string.
 */
function generateDeviceId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }

  // Fallback for older browsers
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 15)
  return `dev_${timestamp}_${random}`
}
