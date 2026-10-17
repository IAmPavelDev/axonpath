/**
 * Validation for the speech-language tagging the lesson generator emits:
 * `baseLanguage` + `contentLanguages` as structured fields (enforced by the
 * response schema) and inline `[[lang:xx]]…[[/lang]]` markers inside
 * classContentMd (enforced here, post-parse — JSON Schema cannot express
 * balance). A violation fails generation and the pipeline retries, so the
 * convention can never silently vanish from new lessons.
 *
 * The regexes mirror the mobile reader (`apps/mobile/lib/conspect-speech/
 * lang-markers.ts`); duplication is deliberate — the contract package is
 * wire-only and this check runs server-side at generation time.
 */

const LANG_CODE = /^[a-zA-Z]{2,3}(-[a-zA-Z]{2,4})?$/;

/**
 * Returns a human-readable violation, or null when the tagging is coherent:
 * every declared non-base language appears as a marker, every marker's code
 * is declared, and markers are balanced.
 */
export const validateLessonLanguages = (
  contentMd: string,
  baseLanguage: string,
  contentLanguages: string[],
): string | null => {
  if (!LANG_CODE.test(baseLanguage)) {
    return `baseLanguage "${baseLanguage}" is not a BCP-47 code`;
  }
  if (!Array.isArray(contentLanguages) || contentLanguages.length === 0) {
    return "contentLanguages is empty";
  }
  for (const lang of contentLanguages) {
    if (!LANG_CODE.test(lang)) return `contentLanguage "${lang}" is not a BCP-47 code`;
  }
  if (!contentLanguages.includes(baseLanguage)) {
    return `contentLanguages must include the base language "${baseLanguage}"`;
  }

  // Balance walk: a closing without an open, a nested open, or an unclosed
  // open at EOF all leave marker syntax no reader could strip cleanly.
  const markerRe =
    /\[\[lang:([a-zA-Z]{2,3}(?:-[a-zA-Z]{2,4})?)\]\]|\[\[\/lang\]\]/g;
  const tagged = new Set<string>();
  let open = false;
  let openLang = "";
  let m: RegExpExecArray | null;
  while ((m = markerRe.exec(contentMd))) {
    if (m[1]) {
      if (open) return "nested [[lang:]] marker in classContentMd";
      open = true;
      openLang = m[1];
      tagged.add(m[1]);
    } else {
      if (!open) return "stray [[/lang]] marker in classContentMd";
      open = false;
    }
  }
  if (open) return `unclosed [[lang:${openLang}]] marker in classContentMd`;

  for (const lang of contentLanguages) {
    if (lang !== baseLanguage && !tagged.has(lang)) {
      return `contentLanguages declares "${lang}" but classContentMd has no [[lang:${lang}]] marker`;
    }
  }
  for (const lang of tagged) {
    if (!contentLanguages.includes(lang)) {
      return `classContentMd tags [[lang:${lang}]] but contentLanguages does not declare it`;
    }
  }
  return null;
};
