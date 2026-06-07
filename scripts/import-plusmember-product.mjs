import { writeFile } from "node:fs/promises";
import { basename } from "node:path";

const url = process.argv[2];

if (!url) {
  console.error("使い方: node scripts/import-plusmember-product.mjs \"商品URL\"");
  process.exit(1);
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

async function imageToDataUrl(imageUrl) {
  if (!imageUrl) return "";

  const response = await fetch(imageUrl, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
      "accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      "referer": url
    }
  });

  if (!response.ok) return "";

  const contentType = response.headers.get("content-type") || "image/jpeg";
  const arrayBuffer = await response.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");

  return `data:${contentType};base64,${base64}`;
}

const html = await fetchText(url);

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
  url
);

const parsedUrl = new URL(url);
const productId = parsedUrl.searchParams.get("product_id") || "";

const productName =
  cleanProductName(rawName) || (productId ? `商品ID ${productId}` : "商品名未取得");

const releaseDate = extractDate(html);
const lineupImageDataUrl = await imageToDataUrl(imageUrl);

const output = {
  type: "plusmember-product-import",
  version: 1,
  sourceUrl: url,
  productId,
  product: {
    name: productName,
    releaseDate: releaseDate || "未設定",
    normalCardCount: 5,
    hasSecret: true,
    lineupImage: lineupImageDataUrl,
    imageUrl
  }
};

const outputPath = "plusmember-product-import.json";
await writeFile(outputPath, JSON.stringify(output, null, 2), "utf-8");

console.log("商品情報を書き出しました:");
console.log(outputPath);
console.log("");
console.log("商品名:", output.product.name);
console.log("発売日:", output.product.releaseDate);
console.log("画像URL:", output.product.imageUrl || "未取得");
console.log("画像:", output.product.lineupImage ? "取得済み" : "未取得");
