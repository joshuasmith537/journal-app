const CHARSET = /[ \t]*<meta\s+charset\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)\s*\/?>[ \t]*\r?\n?/i;

/** Charset stays the first tag in head. The CSP meta is the next one. */
export function placeCspMeta(html: string, policy: string): string {
  if (html.includes("Content-Security-Policy")) return html;
  const charset = html.match(CHARSET)?.[0].trim() ?? `<meta charset="UTF-8" />`;
  const without = html.replace(CHARSET, "");
  const meta = `<meta http-equiv="Content-Security-Policy" content="${policy}" />`;
  return without.replace(/<head[^>]*>/i, (open) => `${open}\n    ${charset}\n    ${meta}`);
}
