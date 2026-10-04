// Live product list from the Hidden Jewels Shopify store, read from the
// storefront's public /products.json feed (the same data any shopper can
// see — no Admin API token needed). Fetched server-side because the
// storefront doesn't send CORS headers, and cached briefly so opening the
// Preorders form repeatedly doesn't hammer the store.

const STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || "hiddenjewelsco.com";
const CACHE_MS = 5 * 60 * 1000;
const PAGE_LIMIT = 250;
const MAX_PAGES = 20;

let cache = null; // { at, products }

function normalizeProduct(p) {
  const options = (p.options || [])
    .map((o) => ({ name: String(o.name || ""), values: (o.values || []).map(String) }))
    .filter((o) => o.name && !(o.name === "Title" && o.values.length === 1 && o.values[0] === "Default Title"));
  const variants = (p.variants || []).map((v) => ({
    id: String(v.id),
    title: v.title === "Default Title" ? "" : String(v.title || ""),
    price: v.price == null ? "" : Number(v.price).toFixed(2),
    available: v.available !== false,
    options: [v.option1, v.option2, v.option3].slice(0, options.length).map((x) => (x == null ? "" : String(x))),
    image: (v.featured_image && v.featured_image.src) || "",
  }));
  const prices = variants.map((v) => Number(v.price)).filter((n) => isFinite(n));
  return {
    id: String(p.id),
    title: String(p.title || ""),
    handle: p.handle || "",
    type: p.product_type || "",
    tags: Array.isArray(p.tags) ? p.tags : String(p.tags || "").split(",").map((t) => t.trim()).filter(Boolean),
    image: (p.images && p.images[0] && p.images[0].src) || "",
    url: p.handle ? `https://${STORE_DOMAIN}/products/${p.handle}` : "",
    priceMin: prices.length ? Math.min(...prices).toFixed(2) : "",
    priceMax: prices.length ? Math.max(...prices).toFixed(2) : "",
    available: variants.some((v) => v.available),
    options,
    variants,
  };
}

async function fetchAllProducts() {
  const products = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await fetch(`https://${STORE_DOMAIN}/products.json?limit=${PAGE_LIMIT}&page=${page}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`Shopify store returned HTTP ${res.status}`);
    const data = await res.json();
    const batch = Array.isArray(data.products) ? data.products : [];
    products.push(...batch.map(normalizeProduct));
    if (batch.length < PAGE_LIMIT) break;
  }
  return products;
}

export async function listShopifyProducts({ refresh = false } = {}) {
  if (!refresh && cache && Date.now() - cache.at < CACHE_MS) return cache.products;
  try {
    const products = await fetchAllProducts();
    cache = { at: Date.now(), products };
    return products;
  } catch (err) {
    // A stale list beats none if the store blips.
    if (cache) return cache.products;
    throw err;
  }
}
