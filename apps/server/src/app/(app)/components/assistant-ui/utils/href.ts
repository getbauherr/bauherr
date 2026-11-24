const RELATIVE = /^(?:[/?#]|\.{1,2}\/)/;

const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

const parse = (url: string) => {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
};

export function safeHref(url: string | undefined): string | undefined {
  if (typeof url !== "string") return undefined;
  const trimmed = url.trim();
  if (trimmed === "") return undefined;
  const parsed = parse(trimmed);
  if (parsed) {
    return ALLOWED_PROTOCOLS.has(parsed.protocol) ? trimmed : undefined;
  }
  return RELATIVE.test(trimmed) ? trimmed : undefined;
}

export function hostOf(url: string | undefined): string | undefined {
  const href = safeHref(url);
  const hostname = href === undefined ? "" : (parse(href)?.hostname ?? "");
  return hostname.replace(/^www\./, "") || undefined;
}

const LOCAL_SCHEME = /^(?:data:image\/|data:audio\/|data:video\/|blob:)/i;

export function canPreload(
  url: string | undefined,
  origins: readonly string[] | undefined,
): boolean {
  if (typeof url !== "string") return false;
  const trimmed = url.trim();
  if (trimmed === "") return false;
  if (LOCAL_SCHEME.test(trimmed)) return true;
  if (/^[a-z][a-z\d+.-]*:/i.test(trimmed)) {
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      return false;
    }
    return isListed(parsed, origins);
  }

  return ["http:", "https:"].every((scheme) => {
    const base = `${scheme}//relative.invalid`;
    try {
      const resolved = new URL(trimmed, `${base}/`);
      return resolved.origin === base || isListed(resolved, origins);
    } catch {
      return false;
    }
  });
}

function isListed(url: URL, origins: readonly string[] | undefined): boolean {
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  return (origins ?? []).some((entry) => {
    if (entry === "*") return true;
    try {
      return new URL(entry).origin === url.origin;
    } catch {
      return false;
    }
  });
}

const CSS_URL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^"'()\s]*))\s*\)/gi;

const INDIRECT_CSS = /\\|image-set\(|\b(?:var|env|attr|src)\(/i;

export function safeBackgroundImage(
  value: string | undefined,
  origins: readonly string[] | undefined,
): string | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  if (INDIRECT_CSS.test(value)) return undefined;
  let allowed = true;
  const rest = value.replace(
    CSS_URL,
    (_match, double?: string, single?: string, bare?: string) => {
      if (!canPreload(double ?? single ?? bare ?? "", origins)) allowed = false;
      return "";
    },
  );

  if (!allowed || /url\(|["']/i.test(rest)) return undefined;
  return value;
}
