// Exact-match logic ported from the `unspsc` project (match-utils.js) to the browser.
// Compares two labels ignoring case, separators (-/_) and English singular/plural of the last word.
import pluralize from "./pluralize.js";

/**
 * Normalises a label for comparison: trims, lowercases, treats -/_ as spaces, collapses spaces.
 * @param {string} str
 * @returns {string}
 */
function normalize(str) {
    return String(str == null ? "" : str)
        .trim()
        .toLowerCase()
        .replace(/[-_]/g, " ")
        .replace(/\s+/g, " ");
}

/**
 * Applies a transform to the last word of a (possibly multi-word) string.
 * @param {string} str
 * @param {function(string):string} fn
 * @returns {string}
 */
function transformLastWord(str, fn) {
    const words = str.split(" ");
    const last = words.pop();
    return [...words, fn(last)].join(" ");
}

/**
 * True when two labels match up to case, separators and English singular/plural of the last word.
 * No stemming (too aggressive: "shielding" -> "shield" would be a false positive).
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function matchesCaseAndPlural(a, b) {
    const normA = normalize(a);
    const normB = normalize(b);

    if (normA === normB) {
        return true;
    }

    return (
        transformLastWord(normA, pluralize.plural) === normB ||
        transformLastWord(normA, pluralize.singular) === normB ||
        transformLastWord(normB, pluralize.plural) === normA ||
        transformLastWord(normB, pluralize.singular) === normA
    );
}

const MatchUtils = { normalize, matchesCaseAndPlural };
export default MatchUtils;
export { normalize, matchesCaseAndPlural };
