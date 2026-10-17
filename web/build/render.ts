import type { Tenant } from "./load-tenant";
import { mdInline, mdBlock, sheetUrls } from "./load-tenant";
import fs from "node:fs";
import path from "node:path";
import { accentVars, THEMES } from "../shared/site";
import {
  buildContent,
  DEFAULT_TIME_ZONE,
  llmsTxt as contentLlmsTxt,
  todayIn,
  upcomingEvents,
  type SiteManifest,
} from "../shared/content";

function esc(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** A non-empty content-tab value from the Sheet snapshot. */
function sheet(t: Tenant, key: string): string | undefined {
  return t.fallback.content[key]?.trim() || undefined;
}

const timeZone = (t: Tenant) => t.config.timeZone ?? DEFAULT_TIME_ZONE;

/** Scalar {{ key }} substitutions for index.html. */
export function scalars(t: Tenant): Record<string, string> {
  const c = t.config;
  return {
    title: `${c.name} — ${c.teamCode}`,
    description: esc(c.description),
    ogImage: `${c.domain}/icon-512.png`,
    shortName: esc(c.shortName),
    name: esc(c.name),
    // The Sheet's content tab (snapshot in fallback/content.json) wins over tenant.json,
    // so the static HTML matches what the runtime override shows.
    heroSub: mdInline(sheet(t, "hero_sub") ?? c.hero.sub),
    heroTagline: mdInline(sheet(t, "hero_tagline") ?? c.hero.tagline),
    scheduleNote: mdInline(sheet(t, "schedule_note") ?? c.scheduleNote),
  };
}

/** `<html>` attributes selecting the design template; empty without content/site.json. */
export function themeAttrs(t: Tenant): string {
  if (!t.site) return "";
  return ` data-theme="${t.site.theme}" style="${accentVars(t.site)}"`;
}

/**
 * Theme stylesheet + web fonts, injected before Vite processes the HTML so the
 * theme CSS is bundled and hashed like style.css.
 */
export function themeHead(t: Tenant): string {
  const theme = t.site ? THEMES[t.site.theme] : null;
  if (!theme) return "";
  const tags: string[] = [];
  if (theme.fonts) {
    tags.push(
      `<link rel="preconnect" href="https://fonts.googleapis.com" />`,
      `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />`,
      `<link rel="stylesheet" href="${esc(theme.fonts)}" />`
    );
  }
  if (theme.stylesheet) tags.push(`<link rel="stylesheet" href="/src/themes/${theme.id}.css" />`);
  return tags.join("\n    ");
}

/** Optional :root color overrides, injected after the stylesheet link. */
export function colorVars(t: Tenant): string {
  const entries = Object.entries(t.config.colors ?? {});
  if (!entries.length) return "";
  const vars = entries.map(([k, v]) => `--${k}: ${v};`).join(" ");
  return `<style>:root { ${vars} }</style>`;
}

/** about.md, or the Sheet's about_text paragraphs — same rule as renderContent() in src/main.ts. */
export function aboutText(t: Tenant): string {
  const c = t.fallback.content;
  if (!c.about_text) return t.aboutHtml;
  return [c.about_text, c.about_text_2, c.about_text_3]
    .filter(Boolean)
    .map((p) => `<p>${mdInline(p)}</p>`)
    .join("");
}

export function quickFacts(t: Tenant): string {
  const c = t.config;
  return [
    `<dt>Team Code</dt><dd>${esc(c.teamCode)}</dd>`,
    `<dt>LMSC</dt><dd>${esc(c.lmscName)}</dd>`,
    ...(c.pools && c.pools.length > 1
      ? [`<dt>Pools</dt><dd>${c.pools.map((p) => `${esc(p.name)}, ${esc(p.city)}`).join("<br>")}</dd>`]
      : [
          `<dt>Pool</dt><dd>${esc(c.pool)}</dd>`,
          `<dt>Address</dt><dd>${esc(c.address.street)}<br>${esc(c.address.city)}, ${esc(c.address.region)} ${esc(c.address.postalCode)}</dd>`,
        ]),
  ].join("\n              ");
}

/** Static fallback schedule cards — same markup as renderSchedule() in src/main.ts. */
export function scheduleFallback(t: Tenant): string {
  return t.fallback.schedule
    .map((e) => {
      const badgeClass = e.type?.toLowerCase().includes("closed") ? "badge-closed" : "badge-open";
      const location = e.location?.trim();
      const badge = e.type ? `<span class="badge ${badgeClass}">${esc(e.type)}</span>` : "";
      return `<div class="schedule-card">
            <div class="schedule-day">${esc(e.day)}</div>
            <div class="schedule-time">${esc(e.time)}</div>
            ${badge}
            ${location ? `<div class="schedule-location">${esc(location)}</div>` : ""}
          </div>`;
    })
    .join("\n          ");
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Static fallback event cards — same markup and "upcoming" rule as renderEvents()
 * in src/main.ts, as of build day in the club's time zone.
 */
export function eventsFallback(t: Tenant): string {
  const day = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? String(Number(iso.slice(8))) : "");
  return upcomingEvents(t.fallback.events, todayIn(timeZone(t)))
    .map((e) => {
      const month = /^\d{4}-\d{2}/.test(e.date) ? MONTHS[Number(e.date.slice(5, 7)) - 1] ?? "" : "";
      const days = e.endDate ? `${day(e.date)}-${day(e.endDate)}` : day(e.date);
      const title = e.url
        ? `<a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.title)}</a>`
        : esc(e.title);
      return `<article class="event-card">
            <div class="event-date"><span class="month">${esc(month)}</span><span class="day">${esc(days)}</span></div>
            <div class="event-info">
              <h3>${title}</h3>
              <p>${esc(e.location)}${e.notes ? " &mdash; " + mdInline(e.notes) : ""}</p>
            </div>
          </article>`;
    })
    .join("\n          ");
}

export function classesSection(t: Tenant): string {
  return t.classes
    .map((cls) => {
      const callout = cls.callout
        ? `<div class="class-callout">
                <div class="class-callout-title">${esc(cls.callout.title)}</div>
                <p>${cls.callout.bodyHtml}</p>
              </div>`
        : "";
      const links = cls.links.length
        ? `<ul class="class-links">
                ${cls.links.map((l) => `<li><a href="${esc(l.url)}"${l.url.startsWith("mailto:") ? "" : ' target="_blank" rel="noopener"'}>${esc(l.label)}</a></li>`).join("\n                ")}
              </ul>`
        : "";
      const flyer = cls.flyer
        ? `<a
              href="${esc(cls.flyer)}"
              target="_blank"
              rel="noopener"
              class="class-flyer"
              aria-label="${esc(cls.flyerAriaLabel ?? "Open flyer")}"
            >
              <img
                src="${esc(cls.flyer)}"
                alt="${esc(cls.flyerAlt ?? "")}"
                loading="lazy"
              />
            </a>`
        : "";
      return `<article class="class-card">
            <div class="class-info">
              <h3>${cls.titleHtml}</h3>
              <p class="class-tagline">${cls.taglineHtml}</p>
              ${callout}
              ${links}
            </div>
            ${flyer}
          </article>`;
    })
    .join("\n          ");
}

export function coachesSection(t: Tenant): string {
  return t.coaches
    .map(
      (c) => `<article class="coach-card">
            <img class="coach-photo" src="${esc(c.photo)}" alt="Coach ${esc(c.name)}" loading="lazy" />
            <div class="coach-bio">
              <h3>${esc(c.name)}</h3>
              ${c.bioHtml}
            </div>
          </article>`
    )
    .join("\n          ");
}

/** Static fallback board cards — same markup as renderBoard() in src/main.ts. */
export function boardFallback(t: Tenant): string {
  return t.fallback.board
    .map(
      (m) => `<div class="board-card">
            <div class="board-role">${esc(m.role)}</div>
            <div class="board-name">${esc(m.name)}</div>
          </div>`
    )
    .join("\n          ");
}

/** Static fallback FAQ items — same markup as renderFAQ() in src/main.ts. */
export function faqFallback(t: Tenant): string {
  return t.fallback.faq
    .map(
      (f) => `<details class="faq-item">
            <summary>${esc(f.question)}</summary>
            <div class="faq-answer">${mdBlock(f.answer)}</div>
          </details>`
    )
    .join("\n          ");
}

export function footerAddress(t: Tenant): string {
  const c = t.config;
  return `<h3>${esc(c.name)}</h3>
            <p>${esc(c.pool)}<br>
              ${esc(c.address.street)}<br>
              ${esc(c.address.city)}, ${esc(c.address.region)} ${esc(c.address.postalCode)}</p>`;
}

export function footerSocials(t: Tenant): string {
  return t.config.socials
    .map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label)}</a></li>`)
    .join("\n              ");
}

/** Optional club document links (e.g. bylaws PDF) appended to the footer Resources list. */
export function footerResources(t: Tenant): string {
  return (t.config.documents ?? [])
    .map((d) => `<li><a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.label)}</a></li>`)
    .join("\n              ");
}

export function copyright(t: Tenant): string {
  const year = new Date().getFullYear();
  return `&copy; ${year} ${esc(t.config.name)} (${esc(t.config.teamCode)}). All rights reserved.`;
}

export function jsonLd(t: Tenant): string {
  const c = t.config;
  const recordsUrl = `${c.domain}/data/${c.teamCode}_all_records.json`;
  const events = upcomingEvents(t.fallback.events, todayIn(timeZone(t)))
    .filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date))
    .map((e) => ({
      "@type": "SportsEvent",
      name: e.title,
      startDate: e.date,
      ...(e.endDate ? { endDate: e.endDate } : {}),
      ...(e.location ? { location: { "@type": "Place", name: e.location } } : {}),
      ...(e.url ? { url: e.url } : {}),
      sport: "Swimming",
    }));

  const data = {
    "@context": "https://schema.org",
    "@type": "SportsClub",
    name: c.name,
    url: c.domain,
    description: c.description,
    sport: "Swimming",
    address: {
      "@type": "PostalAddress",
      streetAddress: c.address.street,
      addressLocality: c.address.city,
      addressRegion: c.address.region,
      postalCode: c.address.postalCode,
    },
    memberOf: {
      "@type": "SportsOrganization",
      name: "US Masters Swimming",
      url: "https://www.usms.org/",
    },
    sameAs: c.socials.filter((s) => s.sameAs).map((s) => s.url),
    ...(events.length ? { event: events } : {}),
    hasOfferCatalog: {
      "@type": "OfferCatalog",
      name: `${c.teamCode} Team Records`,
      itemListElement: [
        {
          "@type": "Offer",
          itemOffered: {
            "@type": "Dataset",
            name: `${c.name} Records`,
            description: `All ${c.teamCode} top times across every course, event, gender, and age group, sourced from the USMS top-times database.`,
            url: recordsUrl,
            encodingFormat: "application/json",
            license: "https://creativecommons.org/licenses/by/4.0/",
            creator: { "@type": "Organization", name: c.name, url: c.domain },
            publisher: { "@type": "Organization", name: c.name, url: c.domain },
          },
        },
      ],
    },
  };
  return JSON.stringify(data, null, 2);
}

export function robotsTxt(t: Tenant): string {
  return `User-agent: *
Allow: /
Allow: /data/
Allow: /api/records
Allow: /api/content
Allow: /openapi.json
Disallow: /admin/
Disallow: /api/

Sitemap: ${t.config.domain}/sitemap.xml
`;
}

/**
 * Every public page, home first: editor pages plus standalone static pages in
 * public/ (currently /workouts/). Feeds the sitemap, llms.txt and data/site.json.
 */
export function sitePages(t: Tenant): SiteManifest["pages"] {
  const c = t.config;
  const [home, ...rest] = t.pages;
  const pages: SiteManifest["pages"] = [
    {
      title: "Home",
      path: "/",
      description: home.description || "About the club, practice schedule, upcoming events, coaches, board and searchable team records",
    },
    ...rest.map((p) => ({ title: p.title, path: `/${p.slug}/`, ...(p.description ? { description: p.description } : {}) })),
  ];
  if (fs.existsSync(path.join(t.publicDir, "workouts", "index.html"))) {
    pages.push({ title: "Sample Workouts", path: "/workouts/", description: `Sample ${c.shortName} practices` });
  }
  return pages;
}

export function sitemapXml(t: Tenant): string {
  const urls = sitePages(t)
    .map((p) => {
      const home = p.path === "/";
      return `
  <url>
    <loc>${t.config.domain}${p.path}</loc>
    <changefreq>${home ? "weekly" : "monthly"}</changefreq>
    <priority>${home ? "1.0" : "0.7"}</priority>
  </url>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}
</urlset>
`;
}

/** data/site.json: everything /api/content and the live /llms.txt need beyond the Sheet. */
export function siteManifest(t: Tenant): SiteManifest {
  const c = t.config;
  const abs = (url: string) => (url.startsWith("/") ? c.domain + url : url);
  return {
    club: {
      name: c.name,
      shortName: c.shortName,
      teamCode: c.teamCode,
      lmsc: c.lmscName,
      description: c.description,
      website: c.domain,
      pool: c.pool,
      address: c.address,
      socials: c.socials.map((s) => ({ label: s.label, url: abs(s.url) })),
      documents: (c.documents ?? []).map((d) => ({ label: d.label, url: abs(d.url) })),
    },
    timeZone: timeZone(t),
    sheetUrls: sheetUrls(c),
    about: t.about,
    scheduleNote: c.scheduleNote,
    coaches: t.coaches.map((co) => ({ name: co.name, bio: co.bio })),
    pages: sitePages(t),
    fallback: t.fallback,
  };
}

/** Static /llms.txt from the Sheet snapshot; the llms.txt Function serves a live version. */
export function llmsTxt(t: Tenant): string {
  const m = siteManifest(t);
  return contentLlmsTxt(m, buildContent(m, m.fallback, "fallback", todayIn(m.timeZone)));
}
