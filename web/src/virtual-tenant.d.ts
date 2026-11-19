declare module "virtual:tenant" {
  interface TenantRuntime {
    slug: string;
    /** "lmsc" = state site: records span every club in the LMSC. */
    kind: "club" | "lmsc";
    teamCode: string;
    /** Swimmer names link to /swimmers/<slug>/ via data/swimmers.json. */
    swimmerPages: boolean;
    sheetUrls: {
      events: string;
      schedule: string;
      board: string;
      content: string;
      faq?: string;
    };
    /** "https://imagedelivery.net/<accountHash>/" or "" until Cloudflare Images is configured. */
    imageBase: string;
    /** tenant.json teamStore, when the club has one. */
    teamStore?: import("../shared/team-store").TeamStore;
  }
  const tenant: TenantRuntime;
  export default tenant;
}
