# Seeds

`manifest.json` lists the brains BigBrain is seeded with and the YouTube videos that feed
each one. It is the only seed file committed to the repo.

```
seeds/
  manifest.json          brains -> videos (committed)
  raw/<creator>/         yt-dlp caption files, <id>.en.vtt (git-ignored)
  content/<brain-slug>/  cleaned Markdown transcripts, <id>.md (git-ignored)
```

## Adding a creator or video

- **New video:** add `{ "id", "title", "url", "published" }` to that brain's `videos` array.
  `id` is the YouTube video id (the `v=` value).
- **New creator:** add a brain with `name`, a one-line `description` (it is used in the
  system prompt as "who this brain is"), a `rawDir` such as `seeds/raw/<creator>`, and its
  `videos`.

## Commands

```sh
node scripts/fetch-transcripts.mjs   # download missing captions with yt-dlp into rawDir
node scripts/build-seeds.mjs         # .vtt -> seeds/content/<brain>/<id>.md, prints a summary
BIGBRAIN_URL=https://bigbrain.designaticlabs.com BIGBRAIN_PIN=123456 \
  npm run seed [-- --reset]          # upload to a deployed BigBrain (builds content if missing)
```

`seed` reuses brains with the same name and skips videos whose `sourceUrl` is already
uploaded, so it is safe to re-run. `--reset` deletes and recreates each manifest brain.
The PIN is read from the environment only. If no PIN has been set yet, `seed` sets it.

To convert one file by hand: `node scripts/vtt-to-markdown.mjs in.vtt --title "T" --url URL > out.md`.

## Why the transcripts are not committed

The transcripts are third-party content. `seeds/raw/` and `seeds/content/` are git-ignored
on purpose. Anyone who clones the repo regenerates them locally with the commands above.
