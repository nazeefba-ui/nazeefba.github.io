# Publishing a new article

Every article on the site needs to exist in two places: an entry in the
`writings` list embedded in `index.html`, and a standalone page in
`articles/` with its own share/SEO metadata. This tool generates both from
one Markdown file so you never have to touch either by hand.

## One-time setup

```
cd tools/new-post
npm install
```

## Writing and publishing a post

1. Copy `posts/TEMPLATE.md` to a new file in `posts/`, e.g. `posts/my-article.md`.
2. Fill in the front matter (`title` and `category` are required; category
   must be `academic`, `opinion`, or `scicomm`) and write the article body
   in Markdown below the `---`.
3. From the repo root, run:

   ```
   node tools/new-post/index.js posts/my-article.md
   ```

   This updates `index.html`, writes `articles/<slug>.html`, then commits
   and pushes both. GitHub Pages redeploys automatically after the push.

Flags:

- `--no-git` — write the files but skip commit/push, so you can review the
  diff yourself first.
- `--force` — if a post with the same slug already exists, overwrite its
  entry instead of failing (useful for fixing a typo after publishing).

## Notes

- The excerpt, read time, and date are all auto-generated if you leave them
  out of the front matter.
- The standalone article page is built directly from the freshly-updated
  `index.html`, so the homepage and the article page can never drift out of
  sync with each other.
