import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { isIdentifierKey, valueLinks } from '../valuelinks';

const cases: [string, string, string[]][] = [
  ['wikidata', 'Q1234', ['https://www.wikidata.org/wiki/Q1234']],
  ['name:etymology:wikidata', 'Q42;Q43 ; Q44', ['https://www.wikidata.org/wiki/Q42', 'https://www.wikidata.org/wiki/Q43', 'https://www.wikidata.org/wiki/Q44']],
  ['wikidata', 'nope', []],
  ['wikipedia', 'uk:Київ (місто)', ['https://uk.wikipedia.org/wiki/%D0%9A%D0%B8%D1%97%D0%B2_(%D0%BC%D1%96%D1%81%D1%82%D0%BE)']],
  ['subject:wikipedia', 'en:Cafe', ['https://en.wikipedia.org/wiki/Cafe']],
  ['wikipedia:ru', 'Киев', ['https://ru.wikipedia.org/wiki/%D0%9A%D0%B8%D0%B5%D0%B2']],
  ['wikimedia_commons', 'Category:Kyiv;File:Foo bar.jpg', ['https://commons.wikimedia.org/wiki/Category:Kyiv', 'https://commons.wikimedia.org/wiki/File:Foo_bar.jpg']],
  ['image', 'File:Foo.jpg', ['https://commons.wikimedia.org/wiki/File:Foo.jpg']],
  ['image', 'https://example.com/a.jpg', ['https://example.com/a.jpg']],
  ['website', 'example.com/page', ['https://example.com/page']],
  ['contact:website', 'https://example.com', ['https://example.com']],
  ['url', 'ftp://nope', []],
  ['phone', '+380 44 123-45-67; +380 (50) 111 22 33', ['tel:+380441234567', 'tel:+380501112233']],
  ['contact:mobile', '0501112233', ['tel:0501112233']],
  ['phone:mobile', '+1 555', ['tel:+1555']],
  ['email', 'info@example.com', ['mailto:info@example.com']],
  ['contact:email', 'bad@', []],
  ['contact:facebook', 'KyivCoffee', ['https://www.facebook.com/KyivCoffee']],
  ['contact:instagram', 'https://instagram.com/kyivcoffee', ['https://instagram.com/kyivcoffee']],
  ['contact:twitter', '@kyiv', ['https://twitter.com/kyiv']],
  ['contact:telegram', '+380501112233', ['https://t.me/+380501112233']],
  ['contact:telegram', 'kyivcoffee', ['https://t.me/kyivcoffee']],
  ['contact:whatsapp', '+380 50 111 22 33', ['https://wa.me/380501112233']],
  ['contact:viber', '+380501112233', ['viber://add?number=380501112233']],
  ['contact:mastodon', '@kyiv@mastodon.social', ['https://mastodon.social/@kyiv']],
  ['contact:matrix', '@kyiv:matrix.org', ['https://matrix.to/#/@kyiv:matrix.org']],
  ['contact:bluesky', 'kyiv.bsky.social', ['https://bsky.app/profile/kyiv.bsky.social']],
  ['contact:youtube', '@kyivcoffee', ['https://www.youtube.com/@kyivcoffee']],
  ['contact:tiktok', 'kyivcoffee', ['https://www.tiktok.com/@kyivcoffee']],
  ['contact:line', 'someid', []],
  ['contact:xiaohongshu', 'https://xhs.example/x', ['https://xhs.example/x']],
  ['mapillary', '290478013593080', ['https://www.mapillary.com/app/?pKey=290478013593080']],
  ['panoramax', '7fb7bdbb-b23e-4169-b1a8-c93b55b884c7', ['https://api.panoramax.xyz/#focus=pic&pic=7fb7bdbb-b23e-4169-b1a8-c93b55b884c7']],
  ['amenity', 'cafe', []],
  ['name', 'Kyiv Coffee', []],
];

for (const [key, value, expected] of cases) {
  test(`${key} = ${value}`, () => {
    assert.deepEqual(valueLinks(key, value).map((l) => l.url), expected);
  });
}

test('link offsets point at the parts of the value', () => {
  const value = 'Q42;Q43 ; Q44';
  assert.deepEqual(valueLinks('wikidata', value).map((l) => value.slice(l.start, l.end)), ['Q42', 'Q43', 'Q44']);
});

test('identifier keys', () => {
  for (const k of ['wikidata', 'brand:wikidata', 'wikipedia:en', 'contact:line', 'phone', 'phone:mobile', 'website', 'source:url']) {
    assert.equal(isIdentifierKey(k), true, k);
  }
  for (const k of ['amenity', 'name', 'ref', 'addr:street']) {
    assert.equal(isIdentifierKey(k), false, k);
  }
});
