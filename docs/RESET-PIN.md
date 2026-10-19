# Forgot your PIN? Reset access

BigBrain never stores your PIN. It keeps only a salted hash of it in Cloudflare KV
(key `pin_hash`), and signs login sessions with a secret in the same namespace
(key `session_secret`). To reset a forgotten PIN you delete those keys; the next visit
then asks you to **Set your PIN** again. No CLI is required.

These same instructions are shown inside the app: on the lock screen (**Forgot your PIN?**
under the PIN field) and in **Settings → Forgot your PIN? → Show reset instructions**.

## Steps (Cloudflare dashboard)

1. Open the Cloudflare dashboard at the KV namespace:
   <https://dash.cloudflare.com/?to=/:account/workers/kv/namespaces/4cdb52e461014a1c96085abacf6f9254>
   (the `:account` placeholder makes the dashboard fill in your account; if the namespace id
   changes, use <https://dash.cloudflare.com/?to=/:account/workers/kv/namespaces> and pick it from the list).
   In the app, the **Open KV in Cloudflare** button uses the id from the `KV_NAMESPACE_ID` var.
2. Sign in if asked and pick the account that hosts BigBrain.
3. In **Workers & Pages → KV**, open the namespace **BIGBRAIN_KV**.
4. On the **KV Pairs** tab find `pin_hash`, open its row menu (**⋯**) and choose **Delete**; confirm.
5. Do the same for `session_secret`. **This logs out every device**, which is what you want
   if the PIN may have leaked.
6. Come back to BigBrain and reload: you'll see **Set your PIN**.

### What the screen looks like

The in-app guide includes an illustration (a drawing, not a real screenshot) of the
**KV Pairs** tab: a header bar reading "BIGBRAIN_KV · KV Pairs", a table with the columns
*Key* and *Value*, and two rows, `pin_hash` (value starting `pbkdf2$100000$…`) and
`session_secret`. The **⋯** button at the right end of the `pin_hash` row is open, showing a
small menu with **View**, **Edit** and **Delete**, with **Delete** highlighted in red.
The real dashboard may differ slightly in layout and wording.

## Alternative: CLI

```sh
npx wrangler kv key delete --namespace-id 4cdb52e461014a1c96085abacf6f9254 --remote pin_hash
npx wrangler kv key delete --namespace-id 4cdb52e461014a1c96085abacf6f9254 --remote session_secret
```

## Notes

- Deleting only `pin_hash` lets you set a new PIN, but devices that are already signed in
  stay signed in until their session expires. Deleting `session_secret` as well signs out
  **all** devices immediately; a new secret is created automatically on the next login.
- Your brains, documents and conversations are not touched by a PIN reset.
- Until a new PIN is set, anyone who opens the site can set one, so do steps 4 to 6 back to back.
