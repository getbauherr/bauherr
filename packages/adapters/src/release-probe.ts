const PATHS = ['', '/api/health', '/health', '/api/version', '/version'];
const PRIVATE_HOST = /^(localhost|.*\.local|.*\.internal|\[.*\]|\d+\.\d+\.\d+\.\d+|[^.]*)$/i;
const SHORT = 7;

/** True when a public https address answers with the commit at one of the usual version paths. */
export const probeCommit = async (
  fetcher: typeof fetch,
  o: { url: string; sha: string },
  timeoutMs = 5000,
): Promise<boolean> => {
  let base: URL;
  try {
    base = new URL(o.url);
  } catch {
    return false;
  }
  if (base.protocol !== 'https:' || PRIVATE_HOST.test(base.hostname)) return false;
  for (const path of PATHS) {
    try {
      const res = await fetcher(new URL(path, base), { signal: AbortSignal.timeout(timeoutMs), redirect: 'error' });
      if (res.ok && (await res.text()).includes(o.sha.slice(0, SHORT))) return true;
    } catch {
      continue;
    }
  }
  return false;
};
