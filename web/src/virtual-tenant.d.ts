declare module "virtual:tenant" {
  interface TenantRuntime {
    slug: string;
    teamCode: string;
    sheetUrls: {
      events: string;
      schedule: string;
      board: string;
      content: string;
      faq?: string;
    };
    /** "https://imagedelivery.net/<accountHash>/" or "" until Cloudflare Images is configured. */
    imageBase: string;
  }
  const tenant: TenantRuntime;
  export default tenant;
}
