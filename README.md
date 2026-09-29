# Sven Kugener – Web Portfolio

Live: https://kugsv.lme.lu

Static portfolio hosted on GitHub Pages. All texts, projects, skills, certificates etc. live in
**`content/site.json`** and are rendered by `js/app.js`, so the HTML files are only thin shells.

## Editing content (admin panel)

Open **https://kugsv.lme.lu/admin/** and sign in with a GitHub fine-grained token:

1. GitHub → Settings → Developer settings → [Fine-grained tokens → Generate new token](https://github.com/settings/personal-access-tokens/new)
2. Repository access: *Only select repositories* → `kugsv.github.io`
3. Repository permissions → **Contents: Read and write**

In the admin panel you can edit every page, add/reorder/hide projects (Markdown editor with live preview),
upload images/PDFs/videos (images are optimized automatically), manage the media library, preview unpublished
changes and download/restore JSON backups. **Veröffentlichen** commits `content/site.json` to `main`;
GitHub Pages redeploys within about a minute.

Without a token the panel runs in offline mode: edit + preview, then export `site.json` and commit it yourself.

## Structure

```
index.html, projects.html, project.html?id=…, skills.html, certificates.html, externe.html, contact.html
404.html                  styled not-found page
project-*.html            redirects from the old project URLs
content/site.json         all content
css/style.css             design (dark/light theme)
js/app.js                 renderer
admin/                    admin panel
assets/img|docs|video     media; new uploads go to assets/uploads
```

## Local development

The content is loaded via `fetch`, so opening the files directly (`file://`) does not work. Start a local server:

```sh
python -m http.server 8000
# → http://localhost:8000  (admin: http://localhost:8000/admin/)
```
