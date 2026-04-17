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

    const files = await this.octokit.paginate(this.octokit.rest.pulls.listFiles, {
      owner: context.repo.owner,
      repo: context.repo.repo,
      pull_number: pullRequest.number,
      per_page: 100,
    });

    const mappedFiles: ChangedFile[] = files.map((file) => ({
      path: file.filename,
      status: mapStatus(file.status),
      previousPath: file.previous_filename,
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

      const shouldHydrate = !file.patch || file.patch.length < 300;
      if (!shouldHydrate) {
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
