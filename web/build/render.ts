import type { Tenant } from "./load-tenant";
import { mdInline, mdBlock } from "./load-tenant";

function esc(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Scalar {{ key }} substitutions for index.html. */
export function scalars(t: Tenant): Record<string, string> {
  const c = t.config;
  return {
    title: `${c.name} — ${c.teamCode}`,
    description: esc(c.description),
    ogImage: `${c.domain}/icon-512.png`,
    shortName: esc(c.shortName),
    name: esc(c.name),
    heroSub: mdInline(c.hero.sub),
    heroTagline: mdInline(c.hero.tagline),
    scheduleNote: mdInline(c.scheduleNote),
  };
}

/** Optional :root color overrides, injected after the stylesheet link. */
export function colorVars(t: Tenant): string {
  const entries = Object.entries(t.config.colors ?? {});
  if (!entries.length) return "";
  const vars = entries.map(([k, v]) => `--${k}: ${v};`).join(" ");
  return `<style>:root { ${vars} }</style>`;
}

export function aboutText(t: Tenant): string {
  return t.aboutHtml;
}

export function quickFacts(t: Tenant): string {
  const c = t.config;
  return [
    `<dt>Team Code</dt><dd>${esc(c.teamCode)}</dd>`,
    `<dt>LMSC</dt><dd>${esc(c.lmscName)}</dd>`,
    `<dt>Pool</dt><dd>${esc(c.pool)}</dd>`,
    `<dt>Address</dt><dd>${esc(c.address.street)}<br>${esc(c.address.city)}, ${esc(c.address.region)} ${esc(c.address.postalCode)}</dd>`,
  ].join("\n              ");
}

/** Static fallback schedule cards — same markup as renderSchedule() in src/main.ts. */
export function scheduleFallback(t: Tenant): string {
  return t.fallback.schedule
    .map((e) => {
      const badgeClass = e.type.toLowerCase().includes("closed") ? "badge-closed" : "badge-open";
      const location = e.location?.trim();
      return `<div class="schedule-card">
            <div class="schedule-day">${esc(e.day)}</div>
            <div class="schedule-time">${esc(e.time)}</div>
            <span class="badge ${badgeClass}">${esc(e.type)}</span>
            ${location ? `<div class="schedule-location">${esc(location)}</div>` : ""}
          </div>`;
    })
    .join("\n          ");
}

/** Static fallback event cards — same markup as renderEvents() in src/main.ts. */
export function eventsFallback(t: Tenant): string {
  return t.fallback.events
    .map(
      (e) => `<article class="event-card">
            <div class="event-date"><span class="month">${esc(e.month)}</span><span class="day">${esc(e.day)}</span></div>
            <div class="event-info">
              <h3>${esc(e.title)}</h3>
              <p>${esc(e.detail)}</p>
            </div>
          </article>`
    )
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

export function copyright(t: Tenant): string {
  const year = new Date().getFullYear();
  return `&copy; ${year} ${esc(t.config.name)} (${esc(t.config.teamCode)}). All rights reserved.`;
}

export function jsonLd(t: Tenant): string {
  const c = t.config;
  const recordsUrl = `${c.domain}/data/${c.teamCode}_all_records.json`;
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

Sitemap: ${t.config.domain}/sitemap.xml
`;
}

export function sitemapXml(t: Tenant): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${t.config.domain}/</loc>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
`;
}

export function llmsTxt(t: Tenant): string {
  const c = t.config;
  return `# ${c.name} (${c.teamCode})

> ${c.description} This site provides team information, practice schedules, upcoming events, and a searchable database of team records (top times).

Team code: ${c.teamCode}
LMSC: ${c.lmscName}
Pool: ${c.pool}, ${c.address.street}, ${c.address.city}, ${c.address.region} ${c.address.postalCode}

## Data

- [Data Index](${c.domain}/data/index.json): Machine-readable index describing all available datasets, their schemas, and download URLs
- [All Team Records](${c.domain}/data/${c.teamCode}_all_records.json): JSON array of all ${c.teamCode} top times across every course (SCY/SCM/LCM), event, gender, and age group

## Site

- [Home](${c.domain}/): Main site with about info, practice schedule, upcoming events, coach bios, board members, and searchable team records
- [Sitemap](${c.domain}/sitemap.xml): XML sitemap
`;
}
