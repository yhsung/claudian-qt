// Pure message navigation logic — no DOM, no globals
export function navigateUp(currentIdx, count) {
  if (!count) return -1;
  if (currentIdx <= 0) return count - 1; // wrap to last
  return currentIdx - 1;
}

export function navigateDown(currentIdx, count) {
  if (!count) return -1;
  if (currentIdx < 0) return 0;
  return Math.min(currentIdx + 1, count - 1);
}
