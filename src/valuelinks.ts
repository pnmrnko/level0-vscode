// Links for tag values that point somewhere: Wikidata items, Wikipedia
// articles, Commons files, websites, phone numbers, e-mail addresses, social
// network accounts, street-level imagery. Pure module, no vscode API.
//
// Rules are matched on the key, mostly by its last segment so that namespaced
// keys work the same: wikidata, brand:wikidata, name:etymology:wikidata.
// Values separated by ";" produce one link per part.

export interface ValueLink {
  // Offsets within the value string.
  start: number;
  end: number;
  url: string;
  tooltip: string;
}

const URL_RE = /^https?:\/\/\S+$/i;
const DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i;

function lastSegment(key: string): string {
  return key.slice(key.lastIndexOf(':') + 1);
}

function digits(phone: string): string {
  return (phone.startsWith('+') ? '+' : '') + phone.replace(/\D/g, '');
}

function wikiPath(title: string): string {
  return encodeURIComponent(title.trim().replace(/ /g, '_')).replace(/%3A/gi, ':').replace(/%2F/gi, '/');
}

function handle(value: string): string {
  return value.replace(/^@/, '');
}

// Profile URL for a social network account given as a bare user name.
const SOCIAL: Record<string, (v: string) => string | undefined> = {
  facebook: (v) => `https://www.facebook.com/${handle(v)}`,
  instagram: (v) => `https://www.instagram.com/${handle(v)}`,
  twitter: (v) => `https://twitter.com/${handle(v)}`,
  x: (v) => `https://x.com/${handle(v)}`,
  youtube: (v) => `https://www.youtube.com/${v.startsWith('@') ? v : handle(v)}`,
  tiktok: (v) => `https://www.tiktok.com/@${handle(v)}`,
  linkedin: (v) => `https://www.linkedin.com/in/${handle(v)}`,
  vk: (v) => `https://vk.com/${handle(v)}`,
  ok: (v) => `https://ok.ru/${handle(v)}`,
  pinterest: (v) => `https://www.pinterest.com/${handle(v)}`,
  vimeo: (v) => `https://vimeo.com/${handle(v)}`,
  xing: (v) => `https://www.xing.com/profile/${handle(v)}`,
  foursquare: (v) => `https://foursquare.com/v/${v}`,
  flickr: (v) => `https://www.flickr.com/people/${handle(v)}`,
  bluesky: (v) => `https://bsky.app/profile/${handle(v)}`,
  telegram: (v) => (/^\+?\d[\d\s-]+$/.test(v) ? `https://t.me/${digits(v)}` : `https://t.me/${handle(v)}`),
  whatsapp: (v) => `https://wa.me/${digits(v).replace('+', '')}`,
  viber: (v) => `viber://add?number=${digits(v).replace('+', '')}`,
  mastodon: (v) => {
    const m = /^@?([^@\s]+)@([^@\s]+)$/.exec(v);
    return m ? `https://${m[2]}/@${m[1]}` : undefined;
  },
  matrix: (v) => (/^@[^:\s]+:[^\s]+$/.test(v) ? `https://matrix.to/#/${v}` : undefined),
};

const PHONE_KEYS = /^(phone|mobile|fax|sms|tty)$/;

// Keys whose values are identifiers or addresses rather than vocabulary. Their
// values never get a Tag:key=value wiki link, even when no target is built.
export function isIdentifierKey(key: string): boolean {
  const last = lastSegment(key);
  return (
    key.startsWith('contact:') ||
    key.startsWith('phone:') ||
    key === 'source:url' ||
    PHONE_KEYS.test(last) ||
    /^(wikidata|wikipedia|wikimedia_commons|email|website|url|webcam|image|mapillary|panoramax)$/.test(last) ||
    /^(?:.+:)?wikipedia:[a-z-]+$/.test(key)
  );
}

function each(value: string, fn: (part: string, start: number, end: number) => void): void {
  let pos = 0;
  for (const raw of value.split(';')) {
    const trimmed = raw.trim();
    const start = pos + raw.indexOf(trimmed);
    if (trimmed) {
      fn(trimmed, start, start + trimmed.length);
    }
    pos += raw.length + 1;
  }
}

export function valueLinks(key: string, value: string): ValueLink[] {
  const out: ValueLink[] = [];
  const last = lastSegment(key);
  const add = (start: number, end: number, url: string | undefined, tooltip: string) => {
    if (url) {
      out.push({ start, end, url, tooltip });
    }
  };

  // Deprecated wikipedia:<lang> = Title form.
  const wpLang = /^(?:.+:)?wikipedia:([a-z-]+)$/.exec(key);

  if (last === 'wikidata') {
    each(value, (p, s, e) => {
      if (/^Q\d+$/.test(p)) {
        add(s, e, `https://www.wikidata.org/wiki/${p}`, `Open ${p} on Wikidata`);
      }
    });
  } else if (last === 'wikipedia' || wpLang) {
    each(value, (p, s, e) => {
      if (URL_RE.test(p)) {
        add(s, e, p, 'Open article');
        return;
      }
      const m = /^([a-z-]+):(.+)$/.exec(p);
      const lang = m ? m[1] : wpLang?.[1];
      const title = m ? m[2] : p;
      if (lang) {
        add(s, e, `https://${lang}.wikipedia.org/wiki/${wikiPath(title)}`, `Open "${title.trim()}" on ${lang}.wikipedia.org`);
      }
    });
  } else if (last === 'wikimedia_commons' || (last === 'image' && /^(File|Category):/.test(value))) {
    each(value, (p, s, e) => {
      if (URL_RE.test(p)) {
        add(s, e, p, 'Open on Wikimedia Commons');
      } else if (/^(File|Category):/.test(p)) {
        add(s, e, `https://commons.wikimedia.org/wiki/${wikiPath(p)}`, 'Open on Wikimedia Commons');
      }
    });
  } else if (PHONE_KEYS.test(last) || key.startsWith('phone:')) {
    each(value, (p, s, e) => {
      const d = digits(p);
      if (d.replace('+', '').length >= 3) {
        add(s, e, `tel:${d}`, `Call ${p}`);
      }
    });
  } else if (last === 'email') {
    each(value, (p, s, e) => {
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p)) {
        add(s, e, `mailto:${p}`, `Write to ${p}`);
      }
    });
  } else if (last === 'mapillary') {
    each(value, (p, s, e) => {
      add(s, e, URL_RE.test(p) ? p : /^\d+$/.test(p) ? `https://www.mapillary.com/app/?pKey=${p}` : undefined, 'Open on Mapillary');
    });
  } else if (last === 'panoramax') {
    each(value, (p, s, e) => {
      add(s, e, URL_RE.test(p) ? p : /^[0-9a-f-]{36}$/i.test(p) ? `https://api.panoramax.xyz/#focus=pic&pic=${p}` : undefined, 'Open on Panoramax');
    });
  } else if (key.startsWith('contact:') && last in SOCIAL) {
    each(value, (p, s, e) => {
      add(s, e, URL_RE.test(p) ? p : SOCIAL[last](p), `Open ${last} profile`);
    });
  } else if (/^(website|url|webcam|image)$/.test(last) || key === 'source:url') {
    each(value, (p, s, e) => {
      if (URL_RE.test(p)) {
        add(s, e, p, 'Open link');
      } else if (DOMAIN_RE.test(p)) {
        add(s, e, `https://${p}`, 'Open link');
      }
    });
  } else if (key.startsWith('contact:') && URL_RE.test(value.trim())) {
    // Any other contact key holding a plain URL.
    const start = value.indexOf(value.trim());
    add(start, start + value.trim().length, value.trim(), 'Open link');
  }

  return out;
}
