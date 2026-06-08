function createResponse(statusCode, data) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, OPTIONS",
      "access-control-allow-headers": "content-type",
    },
    body: JSON.stringify(data),
  };
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

function pick(html, patterns) {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeHtml(match[1]);
  }
  return "";
}

function normalizeImageUrl(imageUrl, pageUrl) {
  if (!imageUrl) return "";

  try {
    return new URL(decodeHtml(imageUrl), pageUrl).toString();
  } catch {
    return "";
  }
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
      return `${match[1]}-${String(match[2]).padStart(2, "0")}-${String(
        match[3]
      ).padStart(2, "0")}`;
    }
  }

  return "";
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function extractSubphotoImageUrls(html, pageUrl) {
  const blockMatch = html.match(
    /<ul[^>]*id=["']subphotoimg["'][^>]*>[\s\S]*?<\/ul>/i
  );

  if (!blockMatch?.[0]) return [];

  const block = blockMatch[0];

  const imageUrls = [...block.matchAll(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi)]
    .map((match) => normalizeImageUrl(match[1], pageUrl))
    .filter((url) => /\.(jpg|jpeg|png|webp)(\?|$)/i.test(url));

  return unique(imageUrls);
}

async function fetchText(targetUrl) {
  const response = await fetch(targetUrl, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
      accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "accept-language": "ja,en-US;q=0.9,en;q=0.8",
    },
  });

  if (!response.ok) {
    throw new Error(`ページ取得に失敗しました: ${response.status}`);
  }

  return await response.text();
}

async function imageToDataUrl(imageUrl, pageUrl) {
  if (!imageUrl) return "";

  const response = await fetch(imageUrl, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
      accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      referer: pageUrl,
    },
  });

  if (!response.ok) return "";

  const contentType = response.headers.get("content-type") || "image/jpeg";
  const arrayBuffer = await response.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");

  return `data:${contentType};base64,${base64}`;
}

async function imagesToDataUrls(imageUrls, pageUrl) {
  const results = [];

  for (const imageUrl of imageUrls) {
    try {
      const dataUrl = await imageToDataUrl(imageUrl, pageUrl);
      if (dataUrl) results.push(dataUrl);
    } catch (error) {
      console.warn(`画像取得に失敗しました: ${imageUrl}`, error);
    }
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

  const productName =
    cleanProductName(rawName) || (productId ? `商品ID ${productId}` : "商品名未取得");

  const releaseDate = extractDate(html);
  const lineupImage = await imageToDataUrl(imageUrl, productUrl);
  const memberImages = await imagesToDataUrls(subphotoImageUrls, productUrl);

  return {
    type: "plusmember-product-import",
    version: 2,
    sourceUrl: productUrl,
    productId,
    product: {
      name: productName,
      releaseDate: releaseDate || "未設定",
      normalCardCount: 5,
      hasSecret: true,
      lineupImage,
      imageUrl,
      memberImages,
      memberImageUrls: subphotoImageUrls,
    },
  };
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, OPTIONS",
        "access-control-allow-headers": "content-type",
      },
      body: "",
    };
  }

  if (event.httpMethod !== "GET") {
    return createResponse(405, { error: "method not allowed" });
  }

  const productUrl = event.queryStringParameters?.url;

  if (!productUrl) {
    return createResponse(400, { error: "url is required" });
  }

  try {
    const data = await importPlusmemberProduct(productUrl);
    return createResponse(200, data);
  } catch (error) {
    console.error(error);

    return createResponse(500, {
      error: "import failed",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}