// GET /api/admin/state — the published pages straight from GitHub (not the
// deployed build, which may lag a commit behind), plus a version for publish.

import { defaultHomePage } from "../../../shared/pages";
import type { AdminState } from "../../../shared/publish";
import { GitHub, json, pagesVersion, type AdminFunction } from "./_lib";

export const onRequestGet: AdminFunction = async ({ env, data }) => {
  const gh = new GitHub(env);
  const files = await gh.pageFiles(env.TENANT, await gh.headSha());
  const pages = await gh.readPages(files);
  const state: AdminState = {
    tenant: env.TENANT,
    version: await pagesVersion(files),
    pages: pages.length ? pages : [defaultHomePage()],
    user: data.user,
    backend: "github",
  };
  return json(200, state);
};
