/**
 * Development-only warnings. `process.env.NODE_ENV` is what bundlers replace (Vite, webpack, Next.js, esbuild), so the
 * check costs nothing in a production build; read from a page with no bundler at all, `process` does not exist and the
 * warnings stay off.
 */
declare const process: { env: { NODE_ENV?: string } }

function isDevelopment(): boolean {
  try {
    return process.env.NODE_ENV !== 'production'
  } catch {
    return false
  }
}

export const DEV = isDevelopment()

/** Warn once per `seen` set and key, in development only. */
export function warnOnce(seen: Set<string>, key: string, message: string): void {
  if (!DEV || seen.has(key)) return
  seen.add(key)
  console.warn(`[DataSquaresEmbed] ${message}`)
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/** Whether `baseUrl` is plain http to a host other than this machine. */
export function isInsecureRemote(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl)
    return url.protocol === 'http:' && !LOCAL_HOSTS.has(url.hostname) && !url.hostname.endsWith('.localhost')
  } catch {
    return false
  }
}
