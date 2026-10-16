// GET /api/admin/state — the published pages and design settings straight from GitHub (not the
// deployed build, which may lag a commit behind), plus a version for publish.

import { defaultHomePage } from "../../../shared/pages";
import type { AdminState } from "../../../shared/publish";
import { GitHub, json, pagesVersion, type AdminFunction } from "./_lib";

export const onRequestGet: AdminFunction = async ({ env, data }) => {
  const gh = new GitHub(env);
  const head = await gh.headSha();
  const [files, siteSha] = await Promise.all([gh.pageFiles(env.TENANT, head), gh.siteSha(env.TENANT, head)]);
  const [pages, site] = await Promise.all([gh.readPages(files), gh.readSite(siteSha)]);
  const state: AdminState = {
    tenant: env.TENANT,
    version: await pagesVersion(files, siteSha),
    pages: pages.length ? pages : [defaultHomePage()],
    site,
    user: data.user,
    backend: "github",
  };
  return json(200, state);
};
