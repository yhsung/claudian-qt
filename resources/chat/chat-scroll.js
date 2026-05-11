// Pure scroll state logic — no DOM, no globals
export const SCROLL_THRESHOLD = 120;

export function computeUserScrolled(scrollTop, scrollHeight, clientHeight, threshold = SCROLL_THRESHOLD) {
  return scrollHeight - scrollTop - clientHeight >= threshold;
}

export function shouldAutoScroll(scrollTop, scrollHeight, clientHeight, threshold = SCROLL_THRESHOLD) {
  return scrollHeight - scrollTop - clientHeight < threshold;
}
