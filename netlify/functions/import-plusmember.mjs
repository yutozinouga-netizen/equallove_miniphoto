export async function handler(event) {
  const url = event.queryStringParameters?.url;

  if (!url) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: "url is required",
      }),
    };
  }

  try {
    const response = await fetch(url, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
      },
    });

    if (!response.ok) {
      return {
        statusCode: response.status,
        body: JSON.stringify({
          error: "failed to fetch product page",
        }),
      };
    }

    const html = await response.text();

    const titleMatch =
      html.match(/<title[^>]*>(.*?)<\/title>/i) ||
      html.match(/<h1[^>]*>(.*?)<\/h1>/i);

    const imageMatch =
      html.match(/<meta property="og:image" content="([^"]+)"/i) ||
      html.match(/<meta name="twitter:image" content="([^"]+)"/i);

    const productName = titleMatch
      ? titleMatch[1].replace(/\s+/g, " ").trim()
      : "";

    const lineupImage = imageMatch ? imageMatch[1] : "";

    return {
      statusCode: 200,
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        type: "plusmember-product-import",
        product: {
          name: productName,
          releaseDate: "未設定",
          normalCardCount: 5,
          hasSecret: true,
          lineupImage,
        },
      }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "import failed",
      }),
    };
  }
}