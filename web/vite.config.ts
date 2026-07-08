import { defineConfig } from "vite";
import { resolveTenantSlug } from "./build/load-tenant";
import { tenantPlugin } from "./build/tenant-plugin";

// Each club is a tenant under ../tenants/<slug>/. TENANT selects which club to
// build/serve (defaults to colm); its public/ dir becomes Vite's publicDir so
// the output contains only that tenant's assets.
export default defineConfig(() => {
  const slug = resolveTenantSlug();
  return {
    base: "/",
    publicDir: `../tenants/${slug}/public`,
    plugins: [tenantPlugin(__dirname, slug)],
  };
});
