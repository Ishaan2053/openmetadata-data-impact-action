import * as github from "@actions/github";
import { logInfo } from "../logging";

const MARKER = "<!-- openmetadata-impact-analysis -->";
const MAX_COMMENT_LENGTH = 65000;

function parseRetryAfterMs(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const seconds = Number.parseInt(value, 10);
  if (!Number.isNaN(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  const when = Date.parse(value);
  if (Number.isNaN(when)) {
    return undefined;
  }

  const delta = when - Date.now();
  return delta > 0 ? delta : undefined;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(fn: () => Promise<T>, maxRetries: number): Promise<T> {
  let attempt = 0;
  let backoff = 500;

  while (true) {
    attempt += 1;
    try {
      return await fn();
    } catch (error) {
      const asRecord = error as {
        status?: number;
        response?: {
          headers?: {
            "retry-after"?: string;
            [key: string]: string | undefined;
          };
        };
      };

      const status = asRecord.status;
      const retryable = status === 429 || status === 502 || status === 503 || status === 504;
      if (!retryable || attempt > maxRetries) {
        throw error;
      }

      const retryAfter = parseRetryAfterMs(asRecord.response?.headers?.["retry-after"]);
      const jitter = Math.floor(Math.random() * 250);
      await wait((retryAfter ?? backoff) + jitter);
      backoff *= 2;
    }
  }
}

function withMarker(body: string): string {
  const truncated = body.length > MAX_COMMENT_LENGTH ? `${body.slice(0, MAX_COMMENT_LENGTH - 64)}\n\n... (truncated)` : body;
  return `${MARKER}\n${truncated}`;
}

export async function upsertImpactComment(githubToken: string, prNumber: number, body: string): Promise<void> {
  const octokit = github.getOctokit(githubToken);
  const { context } = github;

  let authenticatedLogin: string | undefined;
  try {
    const auth = (await withRetry(() => octokit.rest.users.getAuthenticated(), 2)) as {
      data?: { login?: string };
    };
    authenticatedLogin = auth.data?.login;
  } catch {
    // Continue without strict ownership check if auth identity cannot be resolved.
  }

  const comments = (await withRetry(
    () =>
      octokit.paginate(octokit.rest.issues.listComments, {
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: prNumber,
        per_page: 100,
      }),
    2,
  )) as Array<{
    id: number;
    body?: string;
    user?: { login?: string; type?: string };
  }>;

  const formattedBody = withMarker(body);
  const existing = comments.find((comment) => {
    if (!comment.body?.includes(MARKER)) {
      return false;
    }

    if (authenticatedLogin) {
      return comment.user?.login === authenticatedLogin;
    }

    return false;
  });

  if (existing) {
    await withRetry(
      () =>
        octokit.rest.issues.updateComment({
          owner: context.repo.owner,
          repo: context.repo.repo,
          comment_id: existing.id,
          body: formattedBody,
        }),
      2,
    );
    logInfo(`Updated existing impact analysis comment (${existing.id}).`);
    return;
  }

  const created = (await withRetry(
    () =>
      octokit.rest.issues.createComment({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: prNumber,
        body: formattedBody,
      }),
    2,
  )) as { data?: { id?: number } };

  logInfo(`Created impact analysis comment (${created.data?.id ?? "unknown"}).`);
}
