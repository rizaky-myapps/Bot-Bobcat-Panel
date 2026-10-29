/**
 * Lit une liste d'agents saisie librement : mentions Discord et/ou matricules.
 * "<@123> <@456>, 1234" → labels ["<@123>", "<@456>", "1234"], ids ["123", "456"]
 */
export function parseAgents(input) {
  const raw = String(input || '');
  const ids = [];
  const labels = [];
  const mentionRe = /<@!?(\d{17,21})>/g;
  let match;
  while ((match = mentionRe.exec(raw))) {
    if (!ids.includes(match[1])) {
      ids.push(match[1]);
      labels.push(`<@${match[1]}>`);
    }
  }
  const rest = raw.replace(mentionRe, ' ').trim();
  if (rest) {
    const parts = /[,;]/.test(rest) ? rest.split(/[,;]+/) : rest.split(/\s+/);
    for (const part of parts) {
      const label = part.trim();
      if (label && !labels.includes(label)) labels.push(label);
    }
  }
  return { labels, ids };
}

export const FUTURE_TOLERANCE_MS = 15 * 60 * 1000;

export function isInFuture(date, now = new Date()) {
  return date.getTime() > now.getTime() + FUTURE_TOLERANCE_MS;
}
