const DEVICE_ID_KEY = 'finance-sys-device-id'
const LOCAL_SQLITE_USER_PREFIX = 'local:'

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
 * 将浏览器 device id 对齐到已经存在的本地 SQLite userId。
 * 这用于浏览器 localStorage 丢失后，从 SQLite 中恢复原本的本机数据命名空间。
 */
export function adoptDeviceIdFromLocalUserId(userId: string) {
  if (typeof window === 'undefined' || !userId.startsWith(LOCAL_SQLITE_USER_PREFIX)) {
    return
  }

  const deviceId = userId.slice(LOCAL_SQLITE_USER_PREFIX.length)
  if (deviceId) {
    localStorage.setItem(DEVICE_ID_KEY, deviceId)
  }
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
