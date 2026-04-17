import * as github from "@actions/github";
import { logInfo } from "../logging";

const MARKER = "<!-- openmetadata-impact-analysis -->";
const MAX_COMMENT_LENGTH = 65000;

function withMarker(body: string): string {
  const truncated = body.length > MAX_COMMENT_LENGTH ? `${body.slice(0, MAX_COMMENT_LENGTH - 64)}\n\n... (truncated)` : body;
  return `${MARKER}\n${truncated}`;
}

export async function upsertImpactComment(githubToken: string, prNumber: number, body: string): Promise<void> {
  const octokit = github.getOctokit(githubToken);
  const { context } = github;

  const comments = await octokit.paginate(octokit.rest.issues.listComments, {
    owner: context.repo.owner,
    repo: context.repo.repo,
    issue_number: prNumber,
    per_page: 100,
  });

  const formattedBody = withMarker(body);
  const existing = comments.find((comment) => comment.body?.includes(MARKER));

  if (existing) {
    await octokit.rest.issues.updateComment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      comment_id: existing.id,
      body: formattedBody,
    });
    logInfo(`Updated existing impact analysis comment (${existing.id}).`);
    return;
  }

  const created = await octokit.rest.issues.createComment({
    owner: context.repo.owner,
    repo: context.repo.repo,
    issue_number: prNumber,
    body: formattedBody,
  });

  logInfo(`Created impact analysis comment (${created.data.id}).`);
}
