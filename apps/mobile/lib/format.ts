/** Accepts Date or serialized date strings coming through the RPC layer. */
const asDate = (value: Date | string): Date => (value instanceof Date ? value : new Date(value));

/** "12 March 2026" */
export const formatDateLong = (value: Date | string): string =>
  asDate(value).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

/** "12 Mar" */
export const formatDateShort = (value: Date | string): string =>
  asDate(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

const DAY_MS = 86_400_000;

const dayStart = (value: Date): number => {
  const copy = new Date(value);
  copy.setHours(0, 0, 0, 0);
  return copy.getTime();
};

/** "Today", "Yesterday", "3 days ago", then "12 Mar 2026" past a week. */
export const formatRelativeDate = (value: Date | string): string => {
  const date = asDate(value);
  const diffDays = Math.round((dayStart(new Date()) - dayStart(date)) / DAY_MS);

  if (diffDays <= 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};
