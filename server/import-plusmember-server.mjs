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
    return new URL(imageUrl, pageUrl).toString();
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
    /(\d{4})-(\d{2})-(\d{2})/
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      return `${match[1]}-${String(match[2]).padStart(2, "0")}-${String(match[3]).padStart(2, "0")}`;
    }
  }

  return "";
}

async function fetchText(targetUrl) {
  const response = await fetch(targetUrl, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
      "accept":
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "accept-language": "ja,en-US;q=0.9,en;q=0.8"
    }
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
      "accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      "referer": pageUrl
    }
  });

  if (!response.ok) return "";

  const contentType = response.headers.get("content-type") || "image/jpeg";
  const arrayBuffer = await response.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");

  return `data:${contentType};base64,${base64}`;
}

async function importPlusmemberProduct(productUrl) {
  const html = await fetchText(productUrl);

  const rawName = pick(html, [
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i,
    /<h1[^>]*>([\s\S]*?)<\/h1>/i,
    /<title[^>]*>([\s\S]*?)<\/title>/i
  ]);

  const imageUrl = normalizeImageUrl(
    pick(html, [
      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
      /<img[^>]+src=["']([^"']+)["'][^>]*>/i
    ]),
    productUrl
  );

  const parsedUrl = new URL(productUrl);
  const productId = parsedUrl.searchParams.get("product_id") || "";

  const productName =
    cleanProductName(rawName) || (productId ? `商品ID ${productId}` : "商品名未取得");

  const releaseDate = extractDate(html);
  const lineupImage = await imageToDataUrl(imageUrl, productUrl);

  return {
    type: "plusmember-product-import",
    version: 1,
    sourceUrl: productUrl,
    productId,
    product: {
      name: productName,
      releaseDate: releaseDate || "未設定",
      normalCardCount: 5,
      hasSecret: true,
      lineupImage,
      imageUrl
    }
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

  const productUrl = requestUrl.searchParams.get("url");

  if (!productUrl) {
    sendJson(response, 400, { error: "url is required" });
    return;
  }

  try {
    const data = await importPlusmemberProduct(productUrl);
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
