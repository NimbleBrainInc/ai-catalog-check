// The copied Link header parser (src/vendor/http-link-header.ts), held to the
// parse tests of the upstream project it came from (http-link-header 1.1.4,
// test/{index,quotes,rfc-examples,foldline,in-the-wild,encoding}.js), plus the
// cases discovery depends on, including the valueless parameters RFC 8288 allows
// and upstream mis-parses.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseLinkHeader } from "../src/vendor/http-link-header.ts";

/** Plain objects, so null-prototype references compare by their members. */
const plain = (v: unknown) => JSON.parse(JSON.stringify(v)) as unknown;

const CASES: [string, string, object[]][] = [
  // index.js
  ["bare link", "<example.com>", [{ uri: "example.com" }]],
  ["link with rel", "<example.com>; rel=example", [{ uri: "example.com", rel: "example" }]],
  ["link with attribute without value", "<example.com>; nopush", [{ uri: "example.com", nopush: "" }]],
  ["link with quoted rel", '<example.com>; rel="example"', [{ uri: "example.com", rel: "example" }]],
  [
    "multiple links",
    '<example.com>; rel="example", <example-01.com>; rel=alternate',
    [
      { uri: "example.com", rel: "example" },
      { uri: "example-01.com", rel: "alternate" },
    ],
  ],
  ["rel only once; later ones ignored", '<example.com>; rel="example"; rel="invalid"', [{ uri: "example.com", rel: "example" }]],
  [
    "escaped quotes in a quoted value",
    '<example.com>; rel="example"; title="Something of \\"importance\\""',
    [{ uri: "example.com", rel: "example", title: 'Something of "importance"' }],
  ],
  [
    "whitespace around delimiters",
    "<example.com>; rel= example; title = Something",
    [{ uri: "example.com", rel: "example", title: "Something" }],
  ],
  [
    "repeated attributes collect, type lowercased",
    '</example>; rel="alternate"; hreflang="en-US"; hreflang="de"; type="Text/HTML"; media="screen"',
    [{ uri: "/example", rel: "alternate", hreflang: ["en-US", "de"], type: "text/html", media: "screen" }],
  ],
  // quotes.js
  [
    "attribute with semicolon",
    '<http://example.com/quotes/semicolons>; rel="previous"; title="previous; chapter"',
    [{ uri: "http://example.com/quotes/semicolons", rel: "previous", title: "previous; chapter" }],
  ],
  [
    "attribute with comma",
    '<http://example.com/quotes/semicolons>; rel="previous"; title="previous, chapter"',
    [{ uri: "http://example.com/quotes/semicolons", rel: "previous", title: "previous, chapter" }],
  ],
  [
    "multiple links with mixed comma and semicolon",
    '<example.com>; rel="example,comma", <example-01.com>; rel="alternate;semicolon"',
    [
      { uri: "example.com", rel: "example,comma" },
      { uri: "example-01.com", rel: "alternate;semicolon" },
    ],
  ],
  [
    "multiple rel types with semicolon",
    '<example.com>; rel="example; start"',
    [
      { uri: "example.com", rel: "example;" },
      { uri: "example.com", rel: "start" },
    ],
  ],
  // rfc-examples.js (RFC 8288 section 3.5)
  [
    "RFC 8288 example 1, folded",
    '<http://example.com/TheBook/chapter2>; rel="previous";\n         title="previous chapter"',
    [{ uri: "http://example.com/TheBook/chapter2", rel: "previous", title: "previous chapter" }],
  ],
  ["RFC 8288 example 2", '</>; rel="http://example.net/foo"', [{ uri: "/", rel: "http://example.net/foo" }]],
  ["RFC 8288 example 3", '</terms>; rel="copyright"; anchor="#foo"', [{ uri: "/terms", rel: "copyright", anchor: "#foo" }]],
  [
    "RFC 8288 example 4, UTF-8 extended values",
    "</TheBook/chapter2>;\n         rel=\"previous\"; title*=UTF-8'de'letztes%20Kapitel,\n         </TheBook/chapter4>;\n         rel=\"next\"; title*=UTF-8'de'n%c3%a4chstes%20Kapitel",
    [
      { uri: "/TheBook/chapter2", rel: "previous", "title*": { language: "de", encoding: null, value: "letztes Kapitel" } },
      { uri: "/TheBook/chapter4", rel: "next", "title*": { language: "de", encoding: null, value: "nächstes Kapitel" } },
    ],
  ],
  [
    "RFC 8288 example 5, multiple relations",
    '<http://example.org/>;\n         rel="start http://example.net/relation/other"',
    [
      { uri: "http://example.org/", rel: "start" },
      { uri: "http://example.org/", rel: "http://example.net/relation/other" },
    ],
  ],
  // foldline.js
  [
    "unfolds a hard-folded header",
    '<https://acme-staging.api.let\r\n sencrypt.org/acme/new-authz>;\r\n rel="next", <https://letsencr\r\n ypt.org/documents/LE-SA-v1.1.\r\n 1-August-1-2016.pdf>;rel="ter\r\n ms-of-service"',
    [
      { uri: "https://acme-staging.api.letsencrypt.org/acme/new-authz", rel: "next" },
      { uri: "https://letsencrypt.org/documents/LE-SA-v1.1.1-August-1-2016.pdf", rel: "terms-of-service" },
    ],
  ],
  // in-the-wild.js
  [
    "GitHub pagination",
    '<https://api.github.com/user/repos?page=3&per_page=100>; rel="next", <https://api.github.com/user/repos?page=50&per_page=100>; rel="last"',
    [
      { uri: "https://api.github.com/user/repos?page=3&per_page=100", rel: "next" },
      { uri: "https://api.github.com/user/repos?page=50&per_page=100", rel: "last" },
    ],
  ],
  // encoding.js
  [
    "GB2312 extended value kept encoded",
    "</risk-mitigation>; rel=\"start\"; title*=GB2312'cn'%C6%F3%20%D2%B5",
    [{ uri: "/risk-mitigation", rel: "start", "title*": { language: "cn", encoding: "gb2312", value: "%C6%F3%20%D2%B5" } }],
  ],
  [
    "extended value with no language",
    "</risk-mitigation>; rel=\"start\"; title*=UTF-8''%CE%BB",
    [{ uri: "/risk-mitigation", rel: "start", "title*": { language: "", encoding: null, value: "λ" } }],
  ],
  // ai-catalog-check
  [
    "a quoted comma before rel (r10c1)",
    '<https://example.com/catalog.json>; title="AI, catalog"; rel="ai-catalog"',
    [{ uri: "https://example.com/catalog.json", title: "AI, catalog", rel: "ai-catalog" }],
  ],
  ["an attribute named __proto__ is a member", "<x>; __proto__=y", [{ uri: "x", __proto__: "y" }]],
  [
    "a valueless parameter before rel (r11c1)",
    '</catalog.json>; nopush; rel="ai-catalog"',
    [{ uri: "/catalog.json", nopush: "", rel: "ai-catalog" }],
  ],
  [
    "a valueless parameter ending a link before another link",
    '</app.css>; rel=preload; as=style; nopush, </catalog.json>; rel="ai-catalog"',
    [
      { uri: "/app.css", rel: "preload", as: "style", nopush: "" },
      { uri: "/catalog.json", rel: "ai-catalog" },
    ],
  ],
  ["a valueless parameter with whitespace around it", "<a>; nopush ; rel=x", [{ uri: "a", nopush: "", rel: "x" }]],
];

describe("the copied Link header parser", () => {
  for (const [name, header, refs] of CASES) {
    it(name, () => {
      const expected = name.includes("__proto__") ? [JSON.parse('{"uri":"x","__proto__":"y"}')] : refs;
      assert.deepEqual(plain(parseLinkHeader(header)), plain(expected));
    });
  }

  it("throws on a malformed header", () => {
    assert.throws(() => parseLinkHeader("<example.com"), /end of URI delimiter/);
    assert.throws(() => parseLinkHeader("example.com"), /Unexpected character/);
  });

  it("keeps a malformed percent-encoding instead of throwing", () => {
    const [ref] = parseLinkHeader("</a>; title*=UTF-8''%E0%A4%A");
    assert.deepEqual(plain(ref), { uri: "/a", "title*": { language: "", encoding: null, value: "%E0%A4%A" } });
  });
});
