const GITHUB_STEP_SUMMARY_MAX_BYTES = 1024 * 1024;
const SUMMARY_TRUNCATION_NOTICE = "\n\n---\nSummary truncated to fit GitHub Actions step summary limit (1 MiB). Full details remain available in the PR comment and action outputs.";

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function sliceToMaxBytes(value: string, maxBytes: number): string {
  if (maxBytes <= 0) {
    return "";
  }

  let low = 0;
  let high = value.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const candidate = value.slice(0, mid);
    if (byteLength(candidate) <= maxBytes) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  return value.slice(0, low);
}

export function truncateForStepSummary(
  markdown: string,
  maxBytes = GITHUB_STEP_SUMMARY_MAX_BYTES,
): { markdown: string; truncated: boolean } {
  const normalized = markdown.trim();
  if (byteLength(normalized) <= maxBytes) {
    return { markdown: normalized, truncated: false };
  }

  const noticeBytes = byteLength(SUMMARY_TRUNCATION_NOTICE);
  if (noticeBytes >= maxBytes) {
    return {
      markdown: sliceToMaxBytes(SUMMARY_TRUNCATION_NOTICE, maxBytes),
      truncated: true,
    };
  }

  const allowedBodyBytes = maxBytes - noticeBytes;
  const truncatedBody = sliceToMaxBytes(normalized, allowedBodyBytes).trimEnd();
  return {
    markdown: `${truncatedBody}${SUMMARY_TRUNCATION_NOTICE}`,
    truncated: true,
  };
}
