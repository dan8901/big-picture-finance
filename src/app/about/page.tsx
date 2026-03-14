"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { APP_VERSION, REPO_URL, REPO_API_URL } from "@/lib/version";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface ReleaseInfo {
  tag_name: string;
  name: string;
  body: string;
  html_url: string;
  published_at: string;
}

interface CommitInfo {
  sha: string;
  commit: {
    message: string;
    author: { date: string };
  };
  html_url: string;
}

function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(".").map(Number);
  const pb = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function AboutPage() {
  const [checking, setChecking] = useState(false);
  const [release, setRelease] = useState<ReleaseInfo | null>(null);
  const [currentRelease, setCurrentRelease] = useState<ReleaseInfo | null>(null);
  const [commits, setCommits] = useState<CommitInfo[]>([]);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  async function checkForUpdates() {
    setChecking(true);
    setCheckError(null);
    setRelease(null);
    setCurrentRelease(null);
    setCommits([]);
    try {
      // Fetch latest release
      const res = await fetch(`${REPO_API_URL}/releases/latest`);
      if (res.status === 404) {
        setChecked(true);
        return;
      }
      if (res.status === 403) {
        setCheckError("GitHub API rate limit exceeded. Try again later.");
        return;
      }
      if (!res.ok) {
        setCheckError(`GitHub API error: ${res.status}`);
        return;
      }
      const latestData: ReleaseInfo = await res.json();
      setRelease(latestData);

      // Fetch current version's release for its date
      const currentRes = await fetch(`${REPO_API_URL}/releases/tags/v${APP_VERSION}`);
      if (currentRes.ok) {
        const currentData: ReleaseInfo = await currentRes.json();
        setCurrentRelease(currentData);
      }

      // If newer, fetch commits between the two tags
      const latestVer = latestData.tag_name.replace(/^v/, "");
      if (compareVersions(latestVer, APP_VERSION) > 0) {
        const commitsRes = await fetch(
          `${REPO_API_URL}/compare/v${APP_VERSION}...${latestData.tag_name}`
        );
        if (commitsRes.ok) {
          const compareData = await commitsRes.json();
          setCommits(compareData.commits ?? []);
        }
      }

      setChecked(true);
    } catch {
      setCheckError("Failed to connect to GitHub. Check your internet connection.");
    } finally {
      setChecking(false);
    }
  }

  const latestVersion = release?.tag_name?.replace(/^v/, "") ?? null;
  const isNewer = latestVersion ? compareVersions(latestVersion, APP_VERSION) > 0 : false;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">About</h2>
        <p className="text-muted-foreground">Version info and updates</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Big Picture Finance</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <span className="text-muted-foreground">Current version:</span>
            <span className="font-mono font-semibold">v{APP_VERSION}</span>
            {currentRelease && (
              <span className="text-xs text-muted-foreground">
                ({formatDate(currentRelease.published_at)})
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <Button onClick={checkForUpdates} disabled={checking} variant="outline">
              {checking ? "Checking..." : "Check for Updates"}
            </Button>
            <a
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-muted-foreground hover:underline"
            >
              View on GitHub
            </a>
          </div>

          {checkError && (
            <p className="text-sm text-destructive">{checkError}</p>
          )}

          {checked && !isNewer && !checkError && (
            <p className="text-sm text-green-600">You&apos;re up to date!</p>
          )}

          {isNewer && release && (
            <Card className="border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950">
              <CardContent className="pt-6 space-y-4">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span className="font-semibold text-blue-700 dark:text-blue-300">
                    New version available: v{latestVersion}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    ({formatDate(release.published_at)})
                  </span>
                </div>

                {release.body && (
                  <div className="prose prose-sm dark:prose-invert max-w-none">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {release.body}
                    </ReactMarkdown>
                  </div>
                )}

                {commits.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold mb-2 text-blue-700 dark:text-blue-300">
                      Commits since v{APP_VERSION} ({commits.length})
                    </h4>
                    <ul className="space-y-1.5 text-sm">
                      {commits.map((c) => (
                        <li key={c.sha} className="flex gap-2">
                          <a
                            href={c.html_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono text-xs text-muted-foreground hover:underline shrink-0 mt-0.5"
                          >
                            {c.sha.slice(0, 7)}
                          </a>
                          <span className="text-foreground">
                            {c.commit.message.split("\n")[0]}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <a
                  href={release.html_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block text-sm text-blue-600 hover:underline dark:text-blue-400"
                >
                  View release on GitHub
                </a>
              </CardContent>
            </Card>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>How to Update</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>If you deployed via the &quot;Deploy with Vercel&quot; button, your repo is a fork. To update:</p>
          <ol className="list-decimal list-inside space-y-1 ml-2">
            <li>Go to your fork on GitHub</li>
            <li>Click <strong className="text-foreground">&quot;Sync fork&quot;</strong> → <strong className="text-foreground">&quot;Update branch&quot;</strong></li>
            <li>Vercel will automatically redeploy with the latest changes</li>
          </ol>
          <p className="pt-2">
            The build process runs database migrations automatically, so new tables or columns are applied on deploy.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
