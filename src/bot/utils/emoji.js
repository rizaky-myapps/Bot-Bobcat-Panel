const CUSTOM_EMOJI = /^<(a?):([\w~]{2,32}):(\d{17,21})>$/;
const UNICODE_EMOJI = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[#*0-9]️?⃣)(?:[‍️\u{1F3FB}-\u{1F3FF}]|\p{Extended_Pictographic}|\p{Regional_Indicator})*$/u;

export function isValidEmoji(value) {
  if (!value) return false;
  const s = String(value).trim();
  return CUSTOM_EMOJI.test(s) || UNICODE_EMOJI.test(s);
}

/** Convertit un emoji texte en objet accepté par les composants (boutons, menus). */
export function toComponentEmoji(value) {
  if (!value) return undefined;
  const s = String(value).trim();
  const custom = s.match(CUSTOM_EMOJI);
  if (custom) return { id: custom[3], name: custom[2], animated: custom[1] === 'a' };
  if (UNICODE_EMOJI.test(s)) return { name: s };
  return undefined;
}
