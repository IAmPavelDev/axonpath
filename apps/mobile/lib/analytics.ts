import {
  getAnalytics,
  logEvent,
  logScreenView,
} from '@react-native-firebase/analytics'

/**
 * Thin wrapper over Firebase Analytics. Firebase rejects params that are not
 * string/number/boolean, so undefined/null are dropped and everything else is
 * coerced. Every call is best-effort: analytics must never crash the app
 * (native module absent in Expo Go → getAnalytics() throws → silent skip).
 */
type AnalyticsParams = Record<
  string,
  string | number | boolean | undefined | null
>

export const track = async (
  event: string,
  params?: AnalyticsParams,
): Promise<void> => {
  try {
    const cleaned: Record<string, string | number | boolean> = {}
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value === undefined || value === null) continue
      cleaned[key] =
        typeof value === 'number' || typeof value === 'boolean'
          ? value
          : String(value)
    }
    await logEvent(getAnalytics(), event, cleaned)
  } catch {
    // Expo Go / missing native module — analytics is inert, not load-bearing.
  }
}

export const trackScreen = async (name: string): Promise<void> => {
  try {
    // Native auto screen reporting cannot see JS routes; fire it manually.
    await logScreenView(getAnalytics(), {
      screen_name: name,
      screen_class: name,
    })
  } catch {
    // Same inert contract as track().
  }
}
