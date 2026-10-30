export const isWebUrl = (url?: string | null): url is string => {
  try {
    return !!url && ['https:', 'http:'].includes(new URL(url).protocol)
  } catch {
    return false
  }
}
