/* Loads the Hidden Jewels product catalog (a static snapshot pulled from
   Shopify) so the item combobox in Appointments/Leads can search it.
   Refresh assets/products.json manually when the catalog changes — there's
   no live Shopify API call from this static site. */
(function () {
  fetch("assets/products.json", { cache: "no-store" })
    .then((res) => res.json())
    .then((items) => {
      window.RPC_MODEL_NAMES = items.map((p) => p.name);
      window.dispatchEvent(new Event("rpc-models"));
    })
    .catch((err) => {
      console.warn("Couldn't load product catalog:", err);
      window.RPC_MODEL_NAMES = [];
    });
})();
