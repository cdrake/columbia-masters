// POST /api/admin/publish — commit the editor's pages, design settings (and new
// uploads) to the deploy branch as one commit; Cloudflare Pages then rebuilds.
// Only tenants/<TENANT>/content/pages/*, content/site.json and public/uploads/*
// are ever written, and pages/site pass the same validators the build uses.

import {
  commitMessage,
  pageFileContent,
  pagePath,
  pagesDir,
  uploadPath,
  validatePublish,
  type PublishRequest,
  type PublishResult,
} from "../../../shared/publish";
import { siteFileContent, sitePath } from "../../../shared/site";
import { fail, GitHub, GitHubError, json, pagesVersion, type AdminFunction } from "./_lib";

interface TreeEntry {
  path: string;
  mode: "100644";
  type: "blob";
  sha?: string | null;
  content?: string;
}

const CONFLICT = "The site changed since you started editing.";

export const onRequestPost: AdminFunction = async ({ request, env }) => {
  let body: PublishRequest;
  try {
    body = (await request.json()) as PublishRequest;
  } catch {
    return fail(400, "Request body must be JSON.");
  }
  const errors = validatePublish(body);
  if (errors.length) return fail(400, "Invalid pages", errors);

  const gh = new GitHub(env);
  const tenant = env.TENANT;
  const head = await gh.headSha();
  const [before, siteBefore] = await Promise.all([gh.pageFiles(tenant, head), gh.siteSha(tenant, head)]);
  if (!body.overwrite && body.version !== (await pagesVersion(before, siteBefore))) return fail(409, CONFLICT);

  // Unchanged pages are skipped by comparing git blob shas, so a no-op publish makes no commit.
  const tree: TreeEntry[] = [];
  const keep = new Set<string>();
  for (const p of body.pages) {
    const name = `${p.slug}.json`;
    keep.add(name);
    const content = pageFileContent(p);
    if (before[name] !== (await gitBlobSha(content))) {
      tree.push({ path: pagePath(tenant, p.slug), mode: "100644", type: "blob", content });
    }
  }
  for (const name of Object.keys(before)) {
    if (!keep.has(name)) tree.push({ path: `${pagesDir(tenant)}/${name}`, mode: "100644", type: "blob", sha: null });
  }
  if (body.site) {
    const content = siteFileContent(body.site);
    if (siteBefore !== (await gitBlobSha(content))) {
      tree.push({ path: sitePath(tenant), mode: "100644", type: "blob", content });
    }
  }
  for (const u of body.uploads ?? []) {
    const blob = await gh.api<{ sha: string }>("POST", "/git/blobs", { content: u.dataBase64, encoding: "base64" });
    tree.push({ path: uploadPath(tenant, u.name), mode: "100644", type: "blob", sha: blob.sha });
  }

  if (!tree.length) {
    return json(200, { version: await pagesVersion(before, siteBefore) } satisfies PublishResult);
  }

  const newTree = await gh.api<{ sha: string }>("POST", "/git/trees", { base_tree: await gh.treeSha(head), tree });
  const commit = await gh.api<{ sha: string; html_url: string }>("POST", "/git/commits", {
    message: commitMessage(tenant, body),
    tree: newTree.sha,
    parents: [head],
  });
  try {
    // force:false fails if the branch moved since `head` (e.g. a records refresh landed).
    await gh.api("PATCH", `/git/refs/heads/${gh.branch}`, { sha: commit.sha, force: false });
  } catch (e) {
    if (e instanceof GitHubError && e.status === 422) return fail(409, CONFLICT);
    throw e;
  }

  const result: PublishResult = {
    version: await pagesVersion(await gh.pageFiles(tenant, commit.sha), await gh.siteSha(tenant, commit.sha)),
    commitUrl: commit.html_url,
  };
  return json(200, result);
};

/** git's blob id: sha1("blob <bytes>\0" + content). */
async function gitBlobSha(content: string): Promise<string> {
  const bytes = new TextEncoder().encode(content);
  const header = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const buf = new Uint8Array(header.length + bytes.length);
  buf.set(header);
  buf.set(bytes, header.length);
  const digest = await crypto.subtle.digest("SHA-1", buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
