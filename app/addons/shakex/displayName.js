import punycode from 'punycode/';
import {verifyName} from 'hsd/lib/covenants/rules';

// Display only. Never feed the result into wallet actions, routes or records.
// Conservative fallback for controls, formatting/joiners, private-use/unassigned
// characters, separators and invisible characters (except emoji variation selectors).
// This is not a confusable/spoof detector: always retain the canonical ASCII label.
export function displayName(name) {
  if (typeof name !== 'string' || !name.startsWith('xn--') || !verifyName(name)) return name;
  try {
    const unicode = punycode.toUnicode(name);
    const visible = unicode.replace(/[\uFE0E\uFE0F]/g, '');
    if (unicode === name || punycode.toASCII(unicode) !== name ||
        !/[^\x00-\x7f]/.test(unicode) ||
        /[\p{C}\p{Z}]/u.test(unicode) ||
        /\p{Default_Ignorable_Code_Point}/u.test(visible) ||
        /^\p{M}/u.test(unicode) ||
        /[^\p{L}\p{N}\p{M}\p{S}_-]/u.test(unicode)) return name;
    return unicode;
  } catch (error) {
    return name;
  }
}

export function matchesName(name, query) {
  const search = query.trim().toLowerCase();
  return name.includes(search) || displayName(name).toLowerCase().includes(search);
}
