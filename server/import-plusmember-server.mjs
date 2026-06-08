import http from "node:http";

const PORT = 3001;

function sendJson(response, statusCode, data) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "content-type",
  });
  response.end(JSON.stringify(data));
}

function decodeHtml(text) {
  return String(text ?? "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeImageUrl(imageUrl, pageUrl) {
  if (!imageUrl) return "";
  try {
    return new URL(decodeHtml(imageUrl), pageUrl).toString();
  } catch {
    return "";
  }
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function pick(html, patterns) {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeHtml(match[1]);
  }
  return "";
}

function cleanProductName(rawName) {
  return decodeHtml(rawName)
    .replace(/\|.*$/g, "")
    .replace(/=LOVE OFFICIAL STORE/g, "")
    .replace(/≠ME OFFICIAL STORE/g, "")
    .replace(/≒JOY OFFICIAL STORE/g, "")
    .replace(/OFFICIAL STORE/g, "")
    .replace(/公式通販/g, "")
    .trim();
}

function extractDate(html) {
  const patterns = [
    /(\d{4})[年\/.-]\s*(\d{1,2})[月\/.-]\s*(\d{1,2})日?/,
    /(\d{4})-(\d{2})-(\d{2})/,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      return `${match[1]}-${String(match[2]).padStart(2, "0")}-${String(match[3]).padStart(2, "0")}`;
    }
  }

  return "";
}

function extractSubphotoImageUrls(html, pageUrl) {
  const blockMatch = html.match(/<ul[^>]*id=["']subphotoimg["'][^>]*>[\s\S]*?<\/ul>/i);
  if (!blockMatch?.[0]) return [];

  return unique(
    [...blockMatch[0].matchAll(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi)]
      .map((match) => normalizeImageUrl(match[1], pageUrl))
      .filter((url) => /\.(jpg|jpeg|png|webp)(\?|$)/i.test(url))
  );
}

function extractProfileLinks(html, pageUrl) {
  const base = new URL(pageUrl);
  const links = [...html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>/gi)]
    .map((match) => normalizeImageUrl(match[1], pageUrl))
    .filter(Boolean)
    .filter((url) => {
      try {
        const parsed = new URL(url);
        if (parsed.origin !== base.origin) return false;
        if (!parsed.pathname.startsWith("/feature/")) return false;
        if (parsed.pathname === "/feature/profile") return false;
        if (parsed.pathname.includes("/profile")) return false;
        return true;
      } catch {
        return false;
      }
    });

  return unique(links);
}

function extractBestImageUrl(html, pageUrl) {
  const candidates = [
    pick(html, [
      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
    ]),
    ...[...html.matchAll(/<img[^>]+(?:data-src|src)=["']([^"']+)["'][^>]*>/gi)].map((m) => m[1]),
  ]
    .map((url) => normalizeImageUrl(url, pageUrl))
    .filter((url) => /\.(jpg|jpeg|png|webp)(\?|$)/i.test(url))
    .filter((url) => !url.includes("logo"))
    .filter((url) => !url.includes("bnr"))
    .filter((url) => !url.includes("banner"))
    .filter((url) => !url.includes("icon"));

  return candidates[0] ?? "";
}

function extractProfileName(html) {
  return pick(html, [
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i,
    /<h1[^>]*>([\s\S]*?)<\/h1>/i,
    /<title[^>]*>([\s\S]*?)<\/title>/i,
  ])
    .replace(/\|.*$/g, "")
    .replace(/PROFILE/g, "")
    .replace(/プロフィール/g, "")
    .replace(/=LOVE/g, "")
    .replace(/≠ME/g, "")
    .replace(/≒JOY/g, "")
    .trim();
}

function stripHtml(text) {
  return decodeHtml(
    String(text ?? "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  );
}

function isLikelyProfilePath(pathname) {
  if (!pathname.startsWith("/feature/")) return false;
  if (pathname === "/feature/profile") return false;
  if (pathname === "/feature/profile/") return false;

  const slug = pathname.replace(/^\/feature\//, "").replace(/\/$/, "");
  if (!slug) return false;

  const excluded = [
    "news",
    "schedule",
    "discography",
    "producer",
    "about",
    "faq",
    "profile",
  ];

  if (excluded.includes(slug)) return false;

  return /^[a-z0-9_]+$/i.test(slug);
}

function extractProfileEntries(html, pageUrl) {
  const base = new URL(pageUrl);
  const linkMatches = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi)]
    .map((match) => {
      const url = normalizeImageUrl(match[1], pageUrl);
      if (!url) return null;

      try {
        const parsed = new URL(url);
        if (parsed.origin !== base.origin) return null;
        if (!isLikelyProfilePath(parsed.pathname)) return null;

        return {
          index: match.index ?? 0,
          profileUrl: parsed.toString(),
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  const uniqueLinks = [];
  const seen = new Set();

  linkMatches.forEach((entry) => {
    if (seen.has(entry.profileUrl)) return;
    seen.add(entry.profileUrl);
    uniqueLinks.push(entry);
  });

  return uniqueLinks.map((entry, index) => {
    const nextEntry = uniqueLinks[index + 1];
    const block = html.slice(entry.index, nextEntry?.index ?? html.length);
    const imageUrl = extractProfileListImageUrl(block, pageUrl);
    const name = extractProfileListName(block);

    return {
      name,
      profileUrl: entry.profileUrl,
      imageUrl,
    };
  });
}

function isExcludedProfileImageUrl(imageUrl) {
  const normalized = imageUrl.toLowerCase();

  return [
    "logo",
    "bnr",
    "banner",
    "icon",
    "ico_",
    "/ico",
    "sns",
    "twitter",
    "x_twitter",
    "youtube",
    "showroom",
    "tiktok",
    "instagram",
    "ameblo",
    "app",
    "ec_",
    "fanletter",
    "fan_letter",
    "request",
    "common",
    "/cmn/",
  ].some((word) => normalized.includes(word));
}

function scoreProfileImageUrl(imageUrl) {
  const normalized = imageUrl.toLowerCase();
  let score = 0;

  if (/\.(jpg|jpeg|png|webp)(\?|$)/i.test(imageUrl)) score += 10;
  if (normalized.includes("profile")) score += 40;
  if (normalized.includes("prof")) score += 30;
  if (normalized.includes("member")) score += 30;
  if (normalized.includes("artist")) score += 30;
  if (normalized.includes("files")) score += 15;
  if (normalized.includes("img")) score += 10;
  if (normalized.includes("_list")) score += 8;
  if (normalized.includes("thumb")) score += 5;

  if (isExcludedProfileImageUrl(imageUrl)) score -= 200;

  return score;
}

function extractImageCandidatesFromBlock(block, pageUrl) {
  const candidates = [];

  [...block.matchAll(/<img\b[^>]*>/gi)].forEach((match) => {
    const imgTag = match[0];

    [
      /(?:src|data-src|data-original|data-lazy|data-url)=["']([^"']+)["']/i,
      /srcset=["']([^"']+)["']/i,
    ].forEach((pattern) => {
      const value = imgTag.match(pattern)?.[1];
      if (!value) return;

      const firstSrcsetUrl = value.split(",")[0]?.trim().split(/\s+/)[0] ?? "";
      const normalized = normalizeImageUrl(firstSrcsetUrl, pageUrl);

      if (normalized) candidates.push(normalized);
    });
  });

  [...block.matchAll(/url\(["']?([^"')]+)["']?\)/gi)].forEach((match) => {
    const normalized = normalizeImageUrl(match[1], pageUrl);
    if (normalized) candidates.push(normalized);
  });

  return unique(candidates)
    .filter((url) => /\.(jpg|jpeg|png|webp)(\?|$)/i.test(url))
    .map((url) => ({ url, score: scoreProfileImageUrl(url) }))
    .filter((candidate) => candidate.score > -100)
    .sort((a, b) => b.score - a.score)
    .map((candidate) => candidate.url);
}

function extractProfileListImageUrl(block, pageUrl) {
  return extractImageCandidatesFromBlock(block, pageUrl)[0] ?? "";
}

function extractProfileListName(block) {
  const alt = pick(block, [
    /<img\b[^>]*alt=["']([^"']+)["'][^>]*>/i,
    /aria-label=["']([^"']+)["']/i,
    /title=["']([^"']+)["']/i,
  ]);

  const cleanedAlt = stripHtml(alt)
    .replace(/画像/g, "")
    .replace(/プロフィール/g, "")
    .trim();

  if (/[ぁ-んァ-ヶ一-龠]/.test(cleanedAlt) && cleanedAlt.length <= 20) {
    return cleanedAlt.replace(/\s+/g, "");
  }

  const text = stripHtml(block)
    .replace(/\b[A-Z]{2,}(?:\s+[A-Z]{2,})+\b/g, " ")
    .replace(/SHOWROOM|TikTok|Instagram|YouTube|X|Twitter/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  const match = text.match(/[ぁ-んァ-ヶ一-龠々〆〤\s]{2,12}/);
  return match ? match[0].replace(/\s+/g, "") : "";
}

async function fetchText(targetUrl) {
  const response = await fetch(targetUrl, {
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "accept-language": "ja,en-US;q=0.9,en;q=0.8",
    },
  });

  if (!response.ok) throw new Error(`ページ取得に失敗しました: ${response.status}`);
  return await response.text();
}

async function imageToDataUrl(imageUrl, pageUrl) {
  if (!imageUrl) return "";

  const response = await fetch(imageUrl, {
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
      accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      referer: pageUrl,
    },
  });

  if (!response.ok) return "";

  const contentType = response.headers.get("content-type") || "image/jpeg";
  const arrayBuffer = await response.arrayBuffer();
  return `data:${contentType};base64,${Buffer.from(arrayBuffer).toString("base64")}`;
}

async function imagesToDataUrls(imageUrls, pageUrl) {
  const results = [];

  for (const imageUrl of imageUrls) {
    const dataUrl = await imageToDataUrl(imageUrl, pageUrl);
    if (dataUrl) results.push(dataUrl);
  }

  return results;
}

async function importPlusmemberProduct(productUrl) {
  const html = await fetchText(productUrl);

  const rawName = pick(html, [
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i,
    /<h1[^>]*>([\s\S]*?)<\/h1>/i,
    /<title[^>]*>([\s\S]*?)<\/title>/i,
  ]);

  const imageUrl = normalizeImageUrl(
    pick(html, [
      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
      /<img[^>]+src=["']([^"']+)["'][^>]*>/i,
    ]),
    productUrl
  );

  const subphotoImageUrls = extractSubphotoImageUrls(html, productUrl);
  const parsedUrl = new URL(productUrl);
  const productId = parsedUrl.searchParams.get("product_id") || "";
  const productName = cleanProductName(rawName) || (productId ? `商品ID ${productId}` : "商品名未取得");

  return {
    type: "plusmember-product-import",
    version: 2,
    sourceUrl: productUrl,
    productId,
    product: {
      name: productName,
      releaseDate: extractDate(html) || "未設定",
      normalCardCount: 5,
      hasSecret: true,
      lineupImage: await imageToDataUrl(imageUrl, productUrl),
      imageUrl,
      memberImages: await imagesToDataUrls(subphotoImageUrls, productUrl),
      memberImageUrls: subphotoImageUrls,
    },
  };
}

async function importProfileImages(profileUrl) {
  const html = await fetchText(profileUrl);
  const profileEntries = extractProfileEntries(html, profileUrl);
  const profileImages = [];

  for (const entry of profileEntries) {
    try {
      if (!entry.imageUrl) {
        console.warn(`プロフィール一覧画像が見つかりません: ${entry.profileUrl}`);
        continue;
      }

      const image = await imageToDataUrl(entry.imageUrl, profileUrl);

      if (image) {
        profileImages.push({
          name: entry.name,
          profileUrl: entry.profileUrl,
          imageUrl: entry.imageUrl,
          image,
        });
      }
    } catch (error) {
      console.warn(`プロフィール画像取得に失敗しました: ${entry.profileUrl}`, error);
    }
  }

  return {
    type: "profile-image-import",
    version: 3,
    sourceUrl: profileUrl,
    profileImages,
  };
}

const server = http.createServer(async (request, response) => {
  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, OPTIONS",
      "access-control-allow-headers": "content-type",
    });
    response.end();
    return;
  }

  const requestUrl = new URL(request.url ?? "/", `http://localhost:${PORT}`);

  if (requestUrl.pathname !== "/api/import-plusmember") {
    sendJson(response, 404, { error: "not found" });
    return;
  }

  const targetUrl = requestUrl.searchParams.get("url");
  const mode = requestUrl.searchParams.get("mode") || "product";

  if (!targetUrl) {
    sendJson(response, 400, { error: "url is required" });
    return;
  }

  try {
    const data =
      mode === "profile"
        ? await importProfileImages(targetUrl)
        : await importPlusmemberProduct(targetUrl);

    sendJson(response, 200, data);
  } catch (error) {
    console.error(error);
    sendJson(response, 500, {
      error: "import failed",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

server.listen(PORT, () => {
  console.log(`Plusmember import API: http://localhost:${PORT}`);
});