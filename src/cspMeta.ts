export function placeCspMeta(html: string, policy: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${policy}" />`;
  if (html.includes("Content-Security-Policy")) return html;
  return html.replace(/<head[^>]*>/i, (open) => `${open}\n    ${meta}`);
}
