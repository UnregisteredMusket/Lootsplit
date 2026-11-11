// GitHub lookups for scripts/check-android-release.mjs, kept apart so they can be tested
// with a mocked API. `api(path, { paginate })` returns parsed JSON (an array of pages when
// paginate is set) and throws an error carrying `status` for failed HTTP requests.
//
// The release list cannot be used here: every main commit publishes a standby-<sha>
// prerelease, so within days page one holds no Android release at all and both checks
// below would silently check nothing (audit G8, 2026-11-10).

export const androidTag = (version) => `android-v${version}`;

export function androidReleaseState({ api, repo, version }) {
  return {
    released: releaseExists({ api, repo, tag: androidTag(version) }),
    publishedTags: androidTags({ api, repo }),
  };
}

function releaseExists({ api, repo, tag }) {
  try {
    return api(`repos/${repo}/releases/tags/${tag}`)?.tag_name === tag;
  } catch (error) {
    if (error?.status === 404) return false;
    throw error;
  }
}

// Every android-v* tag (each Android release creates one), across all pages.
function androidTags({ api, repo }) {
  const pages = api(`repos/${repo}/git/matching-refs/tags/android-v`, { paginate: true });
  return pages
    .flat()
    .map((entry) => String(entry?.ref ?? "").replace(/^refs\/tags\//, ""))
    .filter((tag) => /^android-v/.test(tag));
}

// The real API: `gh api`, which exits non-zero and prints "(HTTP <status>)" on stderr.
export function ghApi(execFileSync) {
  return (path, { paginate = false } = {}) => {
    const args = ["api", ...(paginate ? ["--paginate", "--slurp"] : []), path];
    try {
      return JSON.parse(
        execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
      );
    } catch (error) {
      const status = Number(String(error?.stderr ?? "").match(/\(HTTP (\d{3})\)/)?.[1]);
      if (status) error.status = status;
      // A 404 is an expected answer ("not released"); anything else is shown and fails.
      if (status !== 404 && error?.stderr) process.stderr.write(error.stderr);
      throw error;
    }
  };
}
