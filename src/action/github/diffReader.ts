import * as github from "@actions/github";
import { minimatch } from "minimatch";
import { ActionConfig, ChangedFile, DiffContext } from "../types";
import { logDebug, logInfo, logWarning } from "../logging";

function mapStatus(status: string): ChangedFile["status"] {
  if (status === "added" || status === "modified" || status === "removed" || status === "renamed") {
    return status;
  }
  return "modified";
}

function decodeBase64Content(raw: string): string {
  return Buffer.from(raw, "base64").toString("utf8");
}

function truncateSnippet(value: string, maxLength: number = 90): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) {
    return compact;
  }
  return `${compact.slice(0, maxLength - 3)}...`;
}

function estimatePatchChangeCount(patch: string): number {
  let count = 0;
  for (const line of patch.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("@@")) {
      continue;
    }
    if (line.startsWith("+") || line.startsWith("-")) {
      count += 1;
    }
  }
  return count;
}

function extractPatchLines(patch: string): { added: string[]; removed: string[] } {
  const added: string[] = [];
  const removed: string[] = [];

  for (const line of patch.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("@@")) {
      continue;
    }

    if (line.startsWith("+")) {
      const normalized = line.slice(1).trim();
      if (normalized.length > 0) {
        added.push(normalized);
      }
    }

    if (line.startsWith("-")) {
      const normalized = line.slice(1).trim();
      if (normalized.length > 0) {
        removed.push(normalized);
      }
    }
  }

  return { added, removed };
}

export class DiffReader {
  private readonly octokit;

  constructor(private readonly config: ActionConfig) {
    this.octokit = github.getOctokit(config.githubToken);
  }

  async readPullRequestDiff(): Promise<DiffContext> {
    const { context } = github;
    const pullRequest = context.payload.pull_request;

    if (!pullRequest) {
      throw new Error("This action requires a pull_request event context.");
    }

    const files = (await this.octokit.paginate(this.octokit.rest.pulls.listFiles, {
      owner: context.repo.owner,
      repo: context.repo.repo,
      pull_number: pullRequest.number,
      per_page: 100,
    })) as Array<{
      filename: string;
      status: string;
      previous_filename?: string;
      additions?: number;
      deletions?: number;
      changes?: number;
      patch?: string;
    }>;

    const mappedFiles: ChangedFile[] = files.map((file) => ({
      path: file.filename,
      status: mapStatus(file.status),
      previousPath: file.previous_filename,
      additions: file.additions,
      deletions: file.deletions,
      changes: file.changes,
      patch: file.patch,
    }));

    logInfo(`Fetched ${mappedFiles.length} changed files from PR #${pullRequest.number}.`);

    return {
      prNumber: pullRequest.number,
      headSha: pullRequest.head.sha,
      baseSha: pullRequest.base.sha,
      files: mappedFiles,
    };
  }

  filterTrackedFiles(files: ChangedFile[]): ChangedFile[] {
    const matched = files.filter((file) =>
      this.config.filePatterns.some((pattern) =>
        minimatch(file.path, pattern, { dot: true, nocase: true }),
      ),
    );

    logInfo(
      `Matched ${matched.length}/${files.length} files against tracked patterns (${this.config.filePatterns.length}).`,
    );

    return matched;
  }

  deriveWhatChanged(files: ChangedFile[], maxItems: number = 8): string[] {
    const summaries: string[] = [];

    for (const file of files) {
      if (summaries.length >= maxItems) {
        break;
      }

      const patch = file.patch;
      if (!patch) {
        summaries.push(`${file.path}: modified (${file.status}), patch details unavailable.`);
        continue;
      }

      const { added, removed } = extractPatchLines(patch);
      const plus = added.length;
      const minus = removed.length;

      let detail = `${file.path}: +${plus}/-${minus}`;
      const firstAdded = added[0];
      if (firstAdded) {
        detail += `; add "${truncateSnippet(firstAdded)}"`;
      }
      const firstRemoved = removed[0];
      if (firstRemoved) {
        detail += `; remove "${truncateSnippet(firstRemoved)}"`;
      }

      summaries.push(detail);
    }

    if (files.length > summaries.length) {
      summaries.push(`... and ${files.length - summaries.length} additional tracked file changes.`);
    }

    return summaries;
  }

  async hydrateTrackedFiles(diff: DiffContext, files: ChangedFile[]): Promise<ChangedFile[]> {
    const hydrated: ChangedFile[] = [];
    for (const file of files) {
      if (file.status === "removed") {
        hydrated.push(file);
        continue;
      }

      if (file.content) {
        hydrated.push(file);
        continue;
      }

      const patch = file.patch;
      const patchChangeCount = patch ? estimatePatchChangeCount(patch) : 0;
      const reportedChanges = file.changes ?? 0;
      const patchAppearsIncomplete =
        Boolean(patch) &&
        reportedChanges > 0 &&
        patchChangeCount > 0 &&
        patchChangeCount < reportedChanges;
      const shouldHydrate = !patch;

      if (!shouldHydrate) {
        if (patchAppearsIncomplete) {
          logDebug(
            `Skipping full-file hydration for ${file.path} because parsing is diff-first even when GitHub patch data appears incomplete.`,
          );
        }
        hydrated.push(file);
        continue;
      }

      try {
        const content = await this.getFileContentAtRef(file.path, diff.headSha);
        hydrated.push({ ...file, content });
      } catch (error) {
        logWarning(`Unable to hydrate full file content for ${file.path}: ${String(error)}`);
        hydrated.push(file);
      }
    }

    return hydrated;
  }

  private async getFileContentAtRef(path: string, ref: string): Promise<string> {
    const { context } = github;
    logDebug(`Hydrating file content for ${path} at ${ref}.`);

    const response = await this.octokit.rest.repos.getContent({
      owner: context.repo.owner,
      repo: context.repo.repo,
      path,
      ref,
    });

    if (Array.isArray(response.data) || response.data.type !== "file") {
      throw new Error(`Path ${path} resolved to a directory.`);
    }

    const content = response.data.content;
    if (!content) {
      throw new Error(`Path ${path} has no content payload.`);
    }

    return decodeBase64Content(content);
  }
}
