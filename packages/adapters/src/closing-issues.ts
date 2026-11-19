const KEYWORD = '(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)';
const CLOSING = new RegExp(`(?<![\\w/#-])${KEYWORD}:?\\s+#(\\d+)(?!\\w)`, 'gi');

/**
 * Issue numbers of the same repository that a pull request description closes, ascending and unique.
 * GitHub and GitLab understand the same keywords.
 */
export const closingIssues = (description: string): number[] => {
  const numbers = [...description.matchAll(CLOSING)].map((m) => Number(m[1]));
  return [...new Set(numbers)].sort((a, b) => a - b);
};
