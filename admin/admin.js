/* =========================================================
   Portfolio admin panel
   Edits content/site.json and uploads media straight into the
   GitHub repository via the GitHub REST API. GitHub Pages then
   rebuilds the site automatically (usually < 1 minute).
   ========================================================= */
(() => {
  'use strict';

  const DEFAULT_REPO = 'SZeroFx/kugsv.github.io';
  const DEFAULT_BRANCH = 'main';
  const CONTENT_PATH = 'content/site.json';
  const UPLOAD_DIR = 'assets/uploads';
  const AUTH_KEY = 'portfolio-admin-auth';
  const DRAFT_KEY = 'portfolio-draft';          // read by js/app.js in preview mode
  const DRAFT_META_KEY = 'portfolio-draft-meta';
  const OPTIMIZE_KEY = 'portfolio-admin-optimize';

  const S = {
    auth: null,          // { token, owner, repo, branch } — null in offline mode
    data: null,          // the content object being edited
    sha: null,           // blob sha of content/site.json we based our edits on
    dirty: false,
    section: 'home',
    open: new Set(),     // expanded list items (by path)
    blobs: new Map(),    // freshly uploaded path -> object URL (for previews before Pages rebuilds)
    tree: null,          // cached repo file list for the media library
    titleRefs: []        // live-updating list item titles
  };

  /* =========================================================
     Small DOM + data helpers
     ========================================================= */
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }
  const ico = (cls) => h('i', { class: cls, 'aria-hidden': 'true' });
  const $ = (sel, root = document) => root.querySelector(sel);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const getIn = (obj, path) => path.reduce((o, k) => (o == null ? undefined : o[k]), obj);
  function setIn(obj, path, value) {
    let o = obj;
    for (let i = 0; i < path.length - 1; i++) {
      if (o[path[i]] == null) o[path[i]] = typeof path[i + 1] === 'number' ? [] : {};
      o = o[path[i]];
    }
    o[path[path.length - 1]] = value;
  }
  const pathKey = (path) => path.join('.');
  const slugify = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const fmtSize = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
  const isImage = (p) => /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(p || '');
  const isVideo = (p) => /\.(mp4|webm|mov)$/i.test(p || '');
  // content paths are relative to the site root; the admin lives in /admin/
  const siteUrl = (p) => {
    if (!p) return '';
    if (S.blobs.has(p)) return S.blobs.get(p);
    if (/^(https?:|data:|blob:|\/)/i.test(p)) return p;
    return '../' + p;
  };

  function b64encode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  const b64decode = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), (c) => c.charCodeAt(0)));
  const fileToBase64 = (blob) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

  function renderMarkdown(text) {
    let html = window.marked ? marked.parse(String(text || ''), { gfm: true }) : '';
    if (window.DOMPurify) html = DOMPurify.sanitize(html, { ADD_TAGS: ['video', 'source'], ADD_ATTR: ['controls', 'preload', 'target'] });
    // rewrite relative asset paths so they resolve from /admin/
    return html.replace(/(src|href)="(?!https?:|data:|blob:|\/|#|mailto:)([^"]+)"/g, (m, attr, p) => `${attr}="${siteUrl(p)}"`);
  }

  /* =========================================================
     Toasts & modals
     ========================================================= */
  function toast(msg, type = 'ok', ms = 4200) {
    const t = h('div', { class: `toast ${type}` }, ico(type === 'err' ? 'fas fa-circle-exclamation' : 'fas fa-circle-check'), h('div', null, msg));
    $('#toasts').append(t);
    setTimeout(() => t.remove(), ms);
  }

  function modal({ title, body, actions = [], wide = false, onClose }) {
    return new Promise((resolve) => {
      const close = (v) => { bd.remove(); document.removeEventListener('keydown', onKey); onClose?.(); resolve(v); };
      const onKey = (e) => { if (e.key === 'Escape') close(null); };
      const foot = actions.length ? h('div', { class: 'modal-foot' }, actions.map((a) =>
        h('button', { class: `btn ${a.class || ''}`, type: 'button', onclick: () => close(typeof a.value === 'function' ? a.value() : a.value) }, a.icon && ico(a.icon), a.label))) : null;
      const bd = h('div', { class: 'modal-backdrop', onmousedown: (e) => { if (e.target === bd) close(null); } },
        h('div', { class: `modal${wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true' },
          h('div', { class: 'modal-head' }, h('h2', null, title), h('button', { class: 'btn ghost icon', type: 'button', 'aria-label': 'Schließen', onclick: () => close(null) }, ico('fas fa-xmark'))),
          h('div', { class: 'modal-body' }, body),
          foot));
      document.addEventListener('keydown', onKey);
      document.body.append(bd);
      bd._close = close;
      setTimeout(() => $('input, textarea, .btn.primary', bd)?.focus(), 30);
    });
  }
  const closeTopModal = (v) => [...document.querySelectorAll('.modal-backdrop')].pop()?._close(v);
  const confirmBox =(title, text, okLabel = 'OK', danger = false) => modal({
    title, body: h('p', null, text),
    actions: [{ label: 'Abbrechen', value: false }, { label: okLabel, value: true, class: danger ? 'danger' : 'primary' }]
  });

  /* =========================================================
     GitHub API
     ========================================================= */
  async function gh(path, opts = {}) {
    const res = await fetch(`https://api.github.com${path}`, {
      cache: 'no-store',
      ...opts,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${S.auth.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(opts.body ? { 'Content-Type': 'application/json' } : {})
      }
    });
    if (!res.ok) {
      let msg = res.statusText;
      try { msg = (await res.json()).message || msg; } catch (e) { /* ignore */ }
      const hint = res.status === 401 ? ' (Token ungültig oder abgelaufen)'
        : res.status === 403 || res.status === 404 ? ' (Token hat keinen Zugriff – Berechtigung „Contents: Read and write“ prüfen)' : '';
      throw Object.assign(new Error(`GitHub: ${msg}${hint}`), { status: res.status });
    }
    return res.status === 204 ? null : res.json();
  }
  const repoPath = () => `/repos/${S.auth.owner}/${S.auth.repo}`;
  const encPath = (p) => p.split('/').map(encodeURIComponent).join('/');

  async function fetchRemoteContent() {
    const f = await gh(`${repoPath()}/contents/${encPath(CONTENT_PATH)}?ref=${encodeURIComponent(S.auth.branch)}`);
    let text;
    if (f.content) text = b64decode(f.content);
    else text = b64decode((await gh(`${repoPath()}/git/blobs/${f.sha}`)).content); // files > 1 MB
    return { data: JSON.parse(text), sha: f.sha };
  }

  async function putFile(path, base64, message, sha) {
    return gh(`${repoPath()}/contents/${encPath(path)}`, {
      method: 'PUT',
      body: JSON.stringify({ message, content: base64, branch: S.auth.branch, ...(sha ? { sha } : {}) })
    });
  }

  /* =========================================================
     Draft handling (also powers the live preview)
     ========================================================= */
  let draftTimer;
  function saveDraft(now = false) {
    clearTimeout(draftTimer);
    const write = () => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(S.data));
        localStorage.setItem(DRAFT_META_KEY, JSON.stringify({ baseSha: S.sha, dirty: S.dirty, savedAt: Date.now() }));
      } catch (e) { /* quota / private mode */ }
    };
    if (now) write(); else draftTimer = setTimeout(write, 300);
  }
  function clearDraftFlag() {
    try { localStorage.setItem(DRAFT_META_KEY, JSON.stringify({ baseSha: S.sha, dirty: false, savedAt: Date.now() })); } catch (e) { /* ignore */ }
  }
  function markDirty() {
    if (!S.dirty) { S.dirty = true; renderStatus(); }
    saveDraft();
  }

  /* =========================================================
     Content schema – drives the whole editor UI
     ========================================================= */
  const LINK = {
    type: 'object', fields: {
      label: { type: 'text', label: 'Beschriftung' },
      url: { type: 'file', label: 'Link oder Datei', help: 'z. B. https://…, projects.html oder eine hochgeladene Datei' },
      icon: { type: 'icon', label: 'Icon' },
      style: { type: 'select', label: 'Stil', options: [['primary', 'Primär (gefüllt)'], ['secondary', 'Sekundär (Umriss)']] },
      download: { type: 'checkbox', label: 'Als Download anbieten' }
    }
  };
  const linkList = (label) => ({
    type: 'list', label, item: LINK,
    title: (v) => v.label || 'Button', sub: (v) => v.url, icon: (v) => v.icon,
    create: () => ({ label: 'Neuer Button', url: '', icon: 'fas fa-arrow-right', style: 'secondary', download: false })
  });
  const PAGE_HEAD = (name) => ({
    type: 'object', label: name, fields: {
      title: { type: 'text', label: 'Titel' },
      icon: { type: 'icon', label: 'Icon' },
      subtitle: { type: 'text', label: 'Untertitel', wide: true },
      note: { type: 'text', label: 'Zusatznotiz (optional)', wide: true }
    }
  });

  const SECTIONS = [
    { group: 'Inhalte' },
    {
      id: 'home', label: 'Startseite', icon: 'fas fa-house', path: ['home'], page: 'index.html',
      intro: 'Hero-Bereich, Über-mich-Texte und Übersichtskarten der Startseite.',
      schema: {
        type: 'object', fields: {
          title: { type: 'text', label: 'Name / Überschrift' },
          profileImage: { type: 'image', label: 'Profilbild' },
          subtitle: { type: 'textarea', label: 'Untertitel', wide: true, rows: 2, md: true },
          buttons: linkList('Buttons'),
          cv: {
            type: 'object', label: 'Lebenslauf-Download', fields: {
              label: { type: 'text', label: 'Beschriftung' },
              icon: { type: 'icon', label: 'Icon' },
              files: {
                type: 'list', label: 'Dateien (Sprachen)', title: (v) => v.label || 'Datei', sub: (v) => v.file,
                item: { type: 'object', fields: { label: { type: 'text', label: 'Sprache' }, file: { type: 'file', label: 'PDF-Datei', accept: '.pdf' } } },
                create: () => ({ label: 'Deutsch', file: '' })
              }
            }
          },
          aboutTitle: { type: 'text', label: 'Überschrift „Über mich“' },
          developmentTitle: { type: 'text', label: 'Überschrift „Entwicklung“' },
          about: { type: 'textarea', label: 'Über mich', rows: 5, md: true },
          development: { type: 'textarea', label: 'Entwicklung während des BTS', rows: 5, md: true },
          featuredTitle: { type: 'text', label: 'Überschrift „Ausgewählte Projekte“' },
          featuredCount: { type: 'number', label: 'Anzahl ausgewählter Projekte', help: 'Die ersten N Projekte der Liste. 0 = Bereich ausblenden.' },
          overviewTitle: { type: 'text', label: 'Überschrift Übersicht', wide: true },
          overview: {
            type: 'list', label: 'Übersichtskarten', title: (v) => v.title, sub: (v) => v.text, icon: (v) => v.icon,
            item: {
              type: 'object', fields: {
                title: { type: 'text', label: 'Titel' }, icon: { type: 'icon', label: 'Icon' },
                text: { type: 'textarea', label: 'Text', wide: true, rows: 2 },
                url: { type: 'text', label: 'Link' }, linkLabel: { type: 'text', label: 'Link-Text' }
              }
            },
            create: () => ({ title: 'Neue Karte', icon: 'fas fa-star', text: '', url: 'index.html', linkLabel: 'More' })
          }
        }
      }
    },
    {
      id: 'projects', label: 'Projekte', icon: 'fas fa-diagram-project', path: ['projects'], page: 'projects.html',
      count: (d) => (d.projects || []).length,
      intro: 'Reihenfolge = Reihenfolge auf der Webseite. Ausgeblendete Projekte sind nur in der Vorschau sichtbar.',
      schema: {
        type: 'list',
        title: (v) => v.title || 'Ohne Titel', sub: (v) => v.summary, icon: (v) => v.icon || 'fas fa-folder',
        hidden: (v) => v.hidden,
        create: () => ({
          id: '', title: 'Neues Projekt', subtitle: '', icon: 'fas fa-folder', tags: [], summary: '',
          banner: '', logo: '', links: [], videos: [], hidden: true,
          body: '## Project Overview\n\nDescribe the project here.\n\n## Technology Stack\n\n- **Tool** - What it was used for\n'
        }),
        item: {
          type: 'object', fields: {
            title: { type: 'text', label: 'Titel' },
            id: { type: 'slug', label: 'URL-Kürzel (ID)', from: 'title', help: 'Adresse: project.html?id=…' },
            subtitle: { type: 'text', label: 'Untertitel (farbig unter dem Titel)' },
            icon: { type: 'icon', label: 'Icon' },
            tags: { type: 'tags', label: 'Kategorien' },
            hidden: { type: 'checkbox', label: 'Ausblenden (Entwurf – nicht öffentlich)' },
            summary: { type: 'textarea', label: 'Kurzbeschreibung (Karte)', wide: true, rows: 2 },
            banner: { type: 'image', label: 'Bannerbild (Header & Karte)' },
            logo: { type: 'image', label: 'Logo' },
            links: linkList('Buttons / Downloads'),
            body: { type: 'markdown', label: 'Inhalt', wide: true },
            videosTitle: { type: 'text', label: 'Überschrift Videos', wide: true, help: 'Leer = Standard aus „Beschriftungen“' },
            videos: {
              type: 'list', label: 'Videos', title: (v) => v.title || 'Video', sub: (v) => v.src, icon: () => 'fas fa-film',
              item: { type: 'object', fields: { title: { type: 'text', label: 'Titel' }, src: { type: 'file', label: 'Videodatei', accept: 'video/*' }, poster: { type: 'image', label: 'Vorschaubild (optional)', wide: true } } },
              create: () => ({ title: '', src: '' })
            }
          }
        }
      }
    },
    {
      id: 'skills', label: 'Skills', icon: 'fas fa-code', path: ['skills'], page: 'skills.html',
      count: (d) => (d.skills || []).length,
      schema: {
        type: 'list', title: (v) => v.title, sub: (v) => (v.items || []).join(', '), icon: (v) => v.icon,
        create: () => ({ title: 'Neue Kategorie', icon: 'fas fa-star', items: [] }),
        item: { type: 'object', fields: { title: { type: 'text', label: 'Kategorie' }, icon: { type: 'icon', label: 'Icon' }, items: { type: 'strings', label: 'Skills (einer pro Zeile)', wide: true } } }
      }
    },
    {
      id: 'certificates', label: 'Zertifikate', icon: 'fas fa-certificate', path: ['certificates'], page: 'certificates.html',
      count: (d) => (d.certificates || []).length,
      schema: {
        type: 'list', title: (v) => v.title, sub: (v) => v.issuer, thumb: (v) => v.image,
        create: () => ({ issuer: '', title: 'Neues Zertifikat', image: '', url: '', badgeIcon: '' }),
        item: {
          type: 'object', fields: {
            issuer: { type: 'text', label: 'Aussteller / Programm' }, title: { type: 'text', label: 'Titel' },
            image: { type: 'image', label: 'Badge-Bild' }, url: { type: 'text', label: 'Link zum Nachweis (z. B. Credly)' },
            badgeIcon: { type: 'icon', label: 'Kleines Icon (optional)' }, linkLabel: { type: 'text', label: 'Link-Text (optional)', help: 'Leer = „View Badge“' }
          }
        }
      }
    },
    {
      id: 'externals', label: 'Externals', icon: 'fas fa-chalkboard-user', path: ['externals'], page: 'externe.html',
      count: (d) => (d.externals || []).length,
      schema: {
        type: 'list', title: (v) => v.name, sub: (v) => v.meta, icon: (v) => v.icon,
        create: () => ({ name: 'Neuer Gast', meta: '', icon: 'fas fa-user', text: '' }),
        item: { type: 'object', fields: { name: { type: 'text', label: 'Name' }, icon: { type: 'icon', label: 'Icon' }, meta: { type: 'text', label: 'Firma / Thema', wide: true }, text: { type: 'textarea', label: 'Text', wide: true, rows: 4, md: true } } }
      }
    },
    {
      id: 'contact', label: 'Kontakt', icon: 'fas fa-envelope', path: ['contact'], page: 'contact.html',
      schema: {
        type: 'object', fields: {
          cards: {
            type: 'list', label: 'Kontaktkarten', title: (v) => v.title, sub: (v) => v.text, icon: (v) => v.icon,
            create: () => ({ title: 'Neu', text: '', url: '', icon: 'fas fa-link', linkLabel: 'Open', color: '#34d399' }),
            item: { type: 'object', fields: { title: { type: 'text', label: 'Titel' }, icon: { type: 'icon', label: 'Icon' }, text: { type: 'text', label: 'Text' }, url: { type: 'text', label: 'Link', help: 'mailto:… für E-Mail' }, linkLabel: { type: 'text', label: 'Link-Text' }, color: { type: 'color', label: 'Farbe' } } }
          },
          info: { type: 'textarea', label: 'Infobox', wide: true, rows: 2, md: true }
        }
      }
    },
    { group: 'Einstellungen' },
    {
      id: 'site', label: 'Allgemein', icon: 'fas fa-sliders', path: ['site'],
      schema: {
        type: 'object', fields: {
          name: { type: 'text', label: 'Name' },
          brand: { type: 'text', label: 'Markenname (Navigation)' },
          description: { type: 'textarea', label: 'SEO-Beschreibung', wide: true, rows: 2 },
          email: { type: 'text', label: 'E-Mail' },
          footer: { type: 'text', label: 'Footer-Text' },
          nav: {
            type: 'list', label: 'Navigation', title: (v) => v.label, sub: (v) => v.href,
            item: { type: 'object', fields: { label: { type: 'text', label: 'Beschriftung' }, href: { type: 'text', label: 'Ziel' } } },
            create: () => ({ label: 'Neu', href: 'index.html' })
          },
          socials: {
            type: 'list', label: 'Social Links (Footer)', title: (v) => v.label, sub: (v) => v.url, icon: (v) => v.icon,
            item: { type: 'object', fields: { label: { type: 'text', label: 'Name' }, icon: { type: 'icon', label: 'Icon' }, url: { type: 'text', label: 'Link', wide: true } } },
            create: () => ({ label: 'GitHub', icon: 'fab fa-github', url: 'https://github.com/' })
          }
        }
      }
    },
    {
      id: 'pages', label: 'Seitenköpfe', icon: 'fas fa-heading', path: ['pages'],
      intro: 'Titel und Untertitel oben auf den Unterseiten.',
      schema: {
        type: 'object', fields: {
          projects: PAGE_HEAD('Projekte'), skills: PAGE_HEAD('Skills'), certificates: PAGE_HEAD('Zertifikate'),
          externals: PAGE_HEAD('Externals'), contact: PAGE_HEAD('Kontakt')
        }
      }
    },
    {
      id: 'labels', label: 'Beschriftungen', icon: 'fas fa-tag', path: [],
      intro: 'Projekt-Kategorien (Filter) und kleine UI-Texte der Webseite.',
      schema: {
        type: 'object', fields: {
          categories: {
            type: 'list', label: 'Projekt-Kategorien', title: (v) => v.label, sub: (v) => 'ID: ' + v.id,
            item: { type: 'object', fields: { label: { type: 'text', label: 'Anzeigename' }, id: { type: 'slug', label: 'ID', from: 'label' } } },
            create: () => ({ id: '', label: 'Neue Kategorie' })
          },
          labels: {
            type: 'object', label: 'UI-Texte', fields: {
              filterAll: { type: 'text', label: 'Filter „Alle“' }, backToProjects: { type: 'text', label: 'Zurück-Link' },
              viewBadge: { type: 'text', label: 'Zertifikat-Link' }, videosTitle: { type: 'text', label: 'Standard-Überschrift Videos' },
              statProjects: { type: 'text', label: 'Statistik: Projekte' }, statSkills: { type: 'text', label: 'Statistik: Skills' },
              statCertificates: { type: 'text', label: 'Statistik: Zertifikate' }, viewAllProjects: { type: 'text', label: 'Link „Alle Projekte“' },
              previous: { type: 'text', label: 'Vorheriges Projekt' }, next: { type: 'text', label: 'Nächstes Projekt' },
              contents: { type: 'text', label: 'Inhaltsverzeichnis' }
            }
          }
        }
      }
    },
    { id: 'media', label: 'Mediathek', icon: 'fas fa-photo-film', custom: () => renderMediaSection() },
    { id: 'json', label: 'JSON / Backup', icon: 'fas fa-code-branch', custom: () => renderJsonSection() }
  ];
  const sectionById = (id) => SECTIONS.find((s) => s.id === id);

  /* =========================================================
     Form rendering
     ========================================================= */
  function update(path, value) {
    setIn(S.data, path, value);
    markDirty();
    S.titleRefs.forEach((r) => r());
  }

  function renderNode(node, path, key) {
    if (node.type === 'object') return renderObject(node, path, key);
    if (node.type === 'list') return renderList(node, path, key);
    return renderField(node, path, key);
  }

  function renderObject(node, path, key) {
    const grid = h('div', { class: 'grid' }, Object.entries(node.fields).map(([k, f]) => renderNode(f, [...path, k], k)));
    if (!node.label) return grid;
    return h('div', { class: 'group' }, h('div', { class: 'group-title' }, node.label), grid);
  }

  function renderList(node, path) {
    const arr = getIn(S.data, path) || [];
    const wrap = h('div', { class: 'list' });
    const rerender = () => { const fresh = renderList(node, path); wrap.replaceWith(fresh); };
    const mutate = (fn) => { const a = clone(getIn(S.data, path) || []); fn(a); setIn(S.data, path, a); markDirty(); rerender(); renderSidebar(); };

    arr.forEach((item, i) => {
      const ipath = [...path, i];
      const key = pathKey(ipath);
      const titleEl = h('span', { class: 'title' });
      const subEl = h('span', { class: 'sub' });
      const iconEl = h('span', { class: 'item-icon' });
      const details = h('details', { class: 'list-item' });
      const refresh = () => {
        const v = getIn(S.data, ipath);
        if (!v) return;
        titleEl.textContent = (node.title ? node.title(v) : v) || '—';
        subEl.textContent = node.sub ? (node.sub(v) || '') : '';
        const ic = node.icon ? node.icon(v) : null;
        iconEl.innerHTML = '';
        if (ic) iconEl.append(ico(ic));
        else if (node.thumb && node.thumb(v)) iconEl.append(h('img', { src: siteUrl(node.thumb(v)), alt: '', style: 'width:22px;height:22px;object-fit:contain' }));
        details.classList.toggle('hidden-item', !!(node.hidden && node.hidden(v)));
      };
      S.titleRefs.push(refresh);
      const stop = (fn) => (e) => { e.preventDefault(); e.stopPropagation(); fn(); };
      const tools = h('span', { class: 'tools' },
        h('button', { class: 'btn ghost icon sm', type: 'button', title: 'Nach oben', disabled: i === 0, onclick: stop(() => mutate((a) => { [a[i - 1], a[i]] = [a[i], a[i - 1]]; moveOpen(path, i, i - 1); })) }, ico('fas fa-arrow-up')),
        h('button', { class: 'btn ghost icon sm', type: 'button', title: 'Nach unten', disabled: i === arr.length - 1, onclick: stop(() => mutate((a) => { [a[i + 1], a[i]] = [a[i], a[i + 1]]; moveOpen(path, i, i + 1); })) }, ico('fas fa-arrow-down')),
        h('button', { class: 'btn ghost icon sm', type: 'button', title: 'Duplizieren', onclick: stop(() => mutate((a) => { const c = clone(a[i]); if (c.id != null) c.id = c.id ? c.id + '-copy' : ''; a.splice(i + 1, 0, c); })) }, ico('far fa-copy')),
        h('button', {
          class: 'btn ghost icon sm danger', type: 'button', title: 'Löschen', onclick: stop(async () => {
            const name = node.title ? node.title(getIn(S.data, ipath)) : '';
            if (await confirmBox('Eintrag löschen?', `„${name || 'Eintrag'}“ wird entfernt. Das wird erst beim Veröffentlichen übernommen.`, 'Löschen', true)) {
              S.open.delete(key); mutate((a) => a.splice(i, 1));
            }
          })
        }, ico('far fa-trash-can')));
      details.append(h('summary', null, h('i', { class: 'fas fa-chevron-right chev' }), iconEl,
        h('span', { style: 'display:flex;flex-direction:column;min-width:0' }, titleEl, subEl), tools));
      let bodyBuilt = false;
      const buildBody = () => {
        if (bodyBuilt) return;
        bodyBuilt = true;
        details.append(h('div', { class: 'item-body' }, renderNode(node.item, ipath)));
      };
      if (S.open.has(key)) { details.open = true; buildBody(); }
      details.addEventListener('toggle', () => {
        if (details.open) { S.open.add(key); buildBody(); } else S.open.delete(key);
      });
      refresh();
      wrap.append(details);
    });
    if (!arr.length) wrap.append(h('div', { class: 'list-empty' }, 'Noch keine Einträge.'));
    wrap.append(h('button', {
      class: 'btn list-add', type: 'button', onclick: () => {
        const n = (getIn(S.data, path) || []).length;
        S.open.add(pathKey([...path, n]));
        mutate((a) => a.push(node.create ? node.create() : ''));
      }
    }, ico('fas fa-plus'), 'Hinzufügen'));

    if (node.label) return h('div', { class: 'field wide' }, h('label', null, node.label), wrap);
    return wrap;
  }
  function moveOpen(path, from, to) {
    const a = pathKey([...path, from]), b = pathKey([...path, to]);
    const ha = S.open.has(a), hb = S.open.has(b);
    S.open.delete(a); S.open.delete(b);
    if (ha) S.open.add(b);
    if (hb) S.open.add(a);
  }

  function renderField(node, path) {
    const id = 'f-' + path.join('-');
    const value = getIn(S.data, path);
    const set = (v) => update(path, v);
    let control;

    switch (node.type) {
      case 'number':
        control = h('input', { class: 'input', id, type: 'number', min: 0, value: value ?? 0, oninput: (e) => set(Number(e.target.value) || 0) });
        break;
      case 'textarea':
        control = h('textarea', { class: 'input', id, rows: node.rows || 3, value: value ?? '', oninput: (e) => set(e.target.value) });
        break;
      case 'markdown':
        control = markdownEditor(path, id);
        break;
      case 'checkbox':
        return h('div', { class: `field${node.wide ? ' wide' : ''}`, style: 'justify-content:flex-end' },
          h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!value, onchange: (e) => { set(e.target.checked); } }), node.label));
      case 'select':
        control = h('select', { class: 'input', id, onchange: (e) => set(e.target.value) },
          node.options.map(([v, l]) => h('option', { value: v, selected: v === value }, l)));
        break;
      case 'color': {
        const text = h('input', { class: 'input mono', id, value: value || '', placeholder: '#34d399', oninput: (e) => { set(e.target.value); if (/^#[0-9a-f]{6}$/i.test(e.target.value)) sw.value = e.target.value; } });
        const sw = h('input', { class: 'color-swatch', type: 'color', value: /^#[0-9a-f]{6}$/i.test(value) ? value : '#34d399', oninput: (e) => { text.value = e.target.value; set(e.target.value); } });
        control = h('div', { class: 'input-row' }, sw, text);
        break;
      }
      case 'icon': control = iconInput(path, id); break;
      case 'image': control = assetInput(path, id, { image: true, accept: 'image/*' }); break;
      case 'file': control = assetInput(path, id, { image: false, accept: node.accept }); break;
      case 'tags': {
        const cats = S.data.categories || [];
        const cur = new Set(value || []);
        control = h('div', { class: 'checks' }, cats.length ? cats.map((c) => h('label', { class: 'check' },
          h('input', { type: 'checkbox', checked: cur.has(c.id), onchange: (e) => { e.target.checked ? cur.add(c.id) : cur.delete(c.id); set(cats.map((x) => x.id).filter((x) => cur.has(x))); } }), c.label))
          : h('span', { class: 'help' }, 'Keine Kategorien – unter „Beschriftungen“ anlegen.'));
        break;
      }
      case 'strings':
        control = h('textarea', {
          class: 'input', id, rows: Math.min(14, Math.max(4, (value || []).length + 1)), value: (value || []).join('\n'),
          oninput: (e) => set(e.target.value.split('\n').map((s) => s.trim()).filter(Boolean))
        });
        break;
      case 'slug': {
        const input = h('input', {
          class: 'input mono', id, value: value || '',
          oninput: (e) => { e.target.value = e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 60); set(e.target.value); },
          onchange: (e) => { e.target.value = slugify(e.target.value); set(e.target.value); }
        });
        const gen = h('button', {
          class: 'btn sm', type: 'button', title: 'Aus Titel erzeugen', onclick: () => {
            const src = getIn(S.data, [...path.slice(0, -1), node.from]);
            input.value = slugify(src); set(input.value);
          }
        }, ico('fas fa-wand-magic-sparkles'));
        control = h('div', { class: 'input-row' }, input, gen);
        break;
      }
      default:
        control = h('input', { class: 'input', id, type: 'text', value: value ?? '', oninput: (e) => set(e.target.value) });
    }

    const help = node.help || (node.md ? 'Unterstützt **fett**, *kursiv* und [Links](https://…).' : null);
    return h('div', { class: `field${node.wide ? ' wide' : ''}` },
      h('label', { for: id }, node.label), control, help && h('p', { class: 'help' }, help));
  }

  /* ---------- icon field ---------- */
  const ICONS = ['fas fa-server', 'fas fa-network-wired', 'fas fa-globe', 'fas fa-code', 'fas fa-terminal', 'fas fa-cloud', 'fas fa-database',
    'fas fa-shield-alt', 'fas fa-lock', 'fas fa-microchip', 'fas fa-layer-group', 'fas fa-cubes', 'fab fa-docker', 'fab fa-linux', 'fab fa-windows',
    'fab fa-aws', 'fab fa-microsoft', 'fab fa-github', 'fab fa-git-alt', 'fab fa-python', 'fab fa-js', 'fab fa-html5', 'fab fa-css3-alt',
    'fab fa-linkedin', 'fab fa-youtube', 'fas fa-envelope', 'fas fa-link', 'fas fa-download', 'fas fa-external-link-alt', 'fas fa-arrow-right',
    'fas fa-project-diagram', 'fas fa-diagram-project', 'fas fa-certificate', 'fas fa-award', 'fas fa-graduation-cap', 'fas fa-chalkboard-user',
    'fas fa-comments', 'fas fa-user', 'fas fa-users', 'fas fa-tasks', 'fas fa-tools', 'fas fa-cogs', 'fas fa-laptop-code', 'fas fa-headset',
    'fas fa-chart-line', 'fas fa-paint-brush', 'fas fa-bicycle', 'fas fa-gamepad', 'fas fa-camera', 'fas fa-film', 'fas fa-file-pdf',
    'fas fa-book', 'fas fa-lightbulb', 'fas fa-rocket', 'fas fa-star', 'fas fa-heart', 'fas fa-folder', 'fas fa-house', 'fas fa-info-circle', 'fas fa-seedling'];

  function iconInput(path, id) {
    const value = getIn(S.data, path) || '';
    const preview = h('span', { class: 'icon-preview' }, value ? ico(value) : '');
    const input = h('input', {
      class: 'input mono', id, value, placeholder: 'fas fa-star',
      oninput: (e) => { preview.innerHTML = ''; if (e.target.value) preview.append(ico(e.target.value)); update(path, e.target.value.trim()); }
    });
    const pick = h('button', {
      class: 'btn sm', type: 'button', title: 'Icon auswählen', onclick: async () => {
        const grid = h('div', { class: 'icon-grid' });
        const p = modal({
          title: 'Icon auswählen',
          body: h('div', null, grid, h('p', { class: 'help', style: 'margin-top:14px' }, 'Weitere Icons: ',
            h('a', { href: 'https://fontawesome.com/search?o=r&m=free', target: '_blank', rel: 'noopener' }, 'fontawesome.com'),
            ' – Klasse (z. B. „fas fa-rocket“) einfach ins Feld kopieren.'))
        });
        ICONS.forEach((c) => grid.append(h('button', { type: 'button', title: c, onclick: () => { closeTopModal(c); } }, ico(c))));
        const chosen = await p;
        if (chosen) { input.value = chosen; input.dispatchEvent(new Event('input')); }
      }
    }, ico('fas fa-icons'));
    return h('div', { class: 'input-row' }, preview, input, pick);
  }

  /* ---------- image / file field ---------- */
  function assetInput(path, id, { image, accept }) {
    const value = getIn(S.data, path) || '';
    const thumb = h('div', { class: 'thumb' });
    const paint = (v) => {
      thumb.innerHTML = '';
      if (!v) thumb.append(ico(image ? 'far fa-image' : 'far fa-file'));
      else if (isImage(v)) thumb.append(h('img', { src: siteUrl(v), alt: '' }));
      else thumb.append(ico(isVideo(v) ? 'fas fa-film' : 'far fa-file-lines'));
    };
    paint(value);
    const input = h('input', { class: 'input mono', id, value, placeholder: image ? 'assets/img/… oder https://…' : 'assets/docs/… oder https://…', oninput: (e) => { paint(e.target.value); update(path, e.target.value.trim()); } });
    const setValue = (v) => { input.value = v; paint(v); update(path, v); };
    const fileInput = h('input', {
      type: 'file', accept: accept || (image ? 'image/*' : ''), hidden: true, onchange: async (e) => {
        const f = e.target.files[0];
        e.target.value = '';
        if (!f) return;
        const p = await uploadWithFeedback(f);
        if (p) setValue(p);
      }
    });
    const btns = h('div', { class: 'btns' },
      h('button', { class: 'btn sm', type: 'button', onclick: () => fileInput.click() }, ico('fas fa-upload'), h('span', { class: 'lbl' }, 'Hochladen')),
      h('button', { class: 'btn sm', type: 'button', onclick: async () => { const p = await openMediaLibrary({ pick: true, filter: image ? 'image' : null }); if (p) setValue(p); } }, ico('fas fa-photo-film'), h('span', { class: 'lbl' }, 'Mediathek')),
      h('button', { class: 'btn sm ghost', type: 'button', title: 'Entfernen', onclick: () => setValue('') }, ico('fas fa-xmark')),
      fileInput);
    return h('div', { class: 'asset' }, thumb, h('div', null, input, btns));
  }

  /* ---------- markdown field ---------- */
  function markdownEditor(path, id) {
    const ta = h('textarea', { class: 'input mono', id, spellcheck: 'true', value: getIn(S.data, path) || '' });
    const preview = h('div', { class: 'md-preview' });
    const panes = h('div', { class: 'md-panes' }, ta, preview);
    let t;
    const paint = () => { preview.innerHTML = renderMarkdown(ta.value); };
    ta.addEventListener('input', () => { update(path, ta.value); clearTimeout(t); t = setTimeout(paint, 150); });
    paint();

    const wrapSel = (before, after = before, placeholder = 'Text') => {
      const { selectionStart: s, selectionEnd: e, value } = ta;
      const sel = value.slice(s, e) || placeholder;
      ta.setRangeText(before + sel + after, s, e, 'end');
      ta.focus(); ta.dispatchEvent(new Event('input'));
    };
    const linePrefix = (prefix) => {
      const { selectionStart: s, selectionEnd: e, value } = ta;
      const start = value.lastIndexOf('\n', s - 1) + 1;
      const block = value.slice(start, e) || 'Text';
      ta.setRangeText(block.split('\n').map((l) => prefix + l.replace(/^(#{1,6} |- )/, '')).join('\n'), start, Math.max(e, start), 'end');
      ta.focus(); ta.dispatchEvent(new Event('input'));
    };
    const insert = (text) => { ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end'); ta.focus(); ta.dispatchEvent(new Event('input')); };
    const tb = (icon, title, fn) => h('button', { class: 'btn ghost icon sm', type: 'button', title, onclick: fn }, ico(icon));
    const imgInput = h('input', {
      type: 'file', accept: 'image/*', hidden: true, onchange: async (e) => {
        const f = e.target.files[0]; e.target.value = '';
        if (!f) return;
        const p = await uploadWithFeedback(f);
        if (p) { insert(`\n![${f.name.replace(/\.[^.]+$/, '')}](${p})\n`); paint(); }
      }
    });
    const setMode = (m) => {
      panes.className = 'md-panes' + (m === 'split' ? '' : ' ' + m);
      modes.querySelectorAll('.btn').forEach((b) => b.classList.toggle('on', b.dataset.m === m));
      if (m !== 'edit') paint();
    };
    const modes = h('div', { class: 'modes' },
      [['edit', 'fas fa-pen', 'Nur Editor'], ['split', 'fas fa-table-columns', 'Geteilt'], ['preview', 'fas fa-eye', 'Nur Vorschau']]
        .map(([m, i, t2]) => h('button', { class: 'btn ghost icon sm', type: 'button', title: t2, 'data-m': m, onclick: () => setMode(m) }, ico(i))));
    const toolbar = h('div', { class: 'md-toolbar' },
      tb('fas fa-heading', 'Überschrift (H2)', () => linePrefix('## ')),
      h('button', { class: 'btn ghost sm', type: 'button', title: 'Unterüberschrift (H3)', onclick: () => linePrefix('### ') }, 'H3'),
      tb('fas fa-bold', 'Fett', () => wrapSel('**')),
      tb('fas fa-italic', 'Kursiv', () => wrapSel('*')),
      tb('fas fa-code', 'Code', () => wrapSel('`')),
      h('span', { class: 'sep' }),
      tb('fas fa-list-ul', 'Liste', () => linePrefix('- ')),
      tb('fas fa-link', 'Link', () => wrapSel('[', '](https://)', 'Linktext')),
      tb('far fa-image', 'Bild hochladen & einfügen', () => imgInput.click()),
      tb('fas fa-icons', 'Icon einfügen (z. B. vor H3)', async () => {
        const grid = h('div', { class: 'icon-grid' });
        const p = modal({ title: 'Icon einfügen', body: grid });
        ICONS.forEach((c) => grid.append(h('button', { type: 'button', title: c, onclick: () => closeTopModal(c) }, ico(c))));
        const c = await p;
        if (c) insert(`<i class="${c}"></i> `);
      }),
      imgInput, modes);
    setMode(window.innerWidth < 900 ? 'edit' : 'split');
    return h('div', { class: 'md' }, toolbar, panes,
      h('div', { class: 'md-help' }, '## Überschrift · ### Unterüberschrift · **fett** · - Listenpunkt · `code` · [Link](https://…) · Icons: <i class="fas fa-server"></i>'));
  }

  /* =========================================================
     Uploads & media library
     ========================================================= */
  function optimizeEnabled() { try { return localStorage.getItem(OPTIMIZE_KEY) !== '0'; } catch (e) { return true; } }

  async function optimizeImage(file) {
    if (!optimizeEnabled() || !/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
    try {
      const bmp = await createImageBitmap(file);
      const max = 2000;
      const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
      if (scale === 1 && file.size < 1.5e6) return file;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bmp.width * scale);
      canvas.height = Math.round(bmp.height * scale);
      canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((r) => canvas.toBlob(r, file.type, 0.85));
      return blob && blob.size < file.size ? new File([blob], file.name, { type: file.type }) : file;
    } catch (e) { return file; }
  }

  function safeFileName(name) {
    const m = String(name).match(/^(.*?)(\.[a-z0-9]+)?$/i);
    return (slugify(m[1]) || 'datei') + (m[2] || '').toLowerCase();
  }

  async function uploadFile(file) {
    if (!S.auth) throw new Error('Zum Hochladen bitte mit GitHub-Token anmelden.');
    const blob = file.type.startsWith('image/') ? await optimizeImage(file) : file;
    if (blob.size > 95 * 1048576) throw new Error(`Datei zu groß (${fmtSize(blob.size)}). Maximal ca. 95 MB.`);
    const path = `${UPLOAD_DIR}/${Date.now().toString(36)}-${safeFileName(file.name)}`;
    await putFile(path, await fileToBase64(blob), `Upload ${file.name} via admin panel`);
    S.blobs.set(path, URL.createObjectURL(blob));
    S.tree = null;
    return { path, size: blob.size, original: file.size };
  }

  async function uploadWithFeedback(file) {
    const t = h('div', { class: 'toast' }, h('i', { class: 'fas fa-circle-notch spin' }), h('div', null, `Lade „${file.name}“ hoch …`));
    $('#toasts').append(t);
    try {
      const r = await uploadFile(file);
      toast(r.size < r.original ? `Hochgeladen (optimiert: ${fmtSize(r.original)} → ${fmtSize(r.size)})` : `Hochgeladen (${fmtSize(r.size)})`);
      return r.path;
    } catch (e) {
      toast(e.message, 'err', 7000);
      return null;
    } finally { t.remove(); }
  }

  async function loadTree(force) {
    if (S.tree && !force) return S.tree;
    const t = await gh(`${repoPath()}/git/trees/${encodeURIComponent(S.auth.branch)}?recursive=1`);
    S.tree = t.tree.filter((x) => x.type === 'blob' && x.path.startsWith('assets/') && !x.path.endsWith('.gitkeep'))
      .map((x) => ({ path: x.path, sha: x.sha, size: x.size }));
    return S.tree;
  }

  function mediaGrid(items, { pick, onPick, onChanged }) {
    const used = JSON.stringify(S.data);
    return h('div', { class: 'media-grid' }, items.map((it) => {
      const name = it.path.split('/').pop();
      const inUse = used.includes(it.path);
      const card = h('div', { class: `media-item${pick ? ' pickable' : ''}`, title: it.path, onclick: pick ? () => onPick(it.path) : null },
        h('div', { class: 'preview' }, isImage(it.path) ? h('img', { src: siteUrl(it.path), alt: '', loading: 'lazy' }) : ico(isVideo(it.path) ? 'fas fa-film' : /\.pdf$/i.test(it.path) ? 'far fa-file-pdf' : 'far fa-file')),
        h('div', { class: 'info' }, h('div', { class: 'name' }, name),
          h('div', { class: 'meta' }, h('span', null, it.path.split('/')[1]), h('span', null, it.size != null ? fmtSize(it.size) : ''), inUse ? h('span', { style: 'color:var(--accent)' }, 'in Verwendung') : null)));
      if (!pick) {
        card.append(h('div', { class: 'tools' },
          h('button', { class: 'btn sm', type: 'button', title: 'Pfad kopieren', onclick: () => { navigator.clipboard?.writeText(it.path); toast('Pfad kopiert: ' + it.path); } }, ico('far fa-copy')),
          h('a', { class: 'btn sm', href: siteUrl(it.path), target: '_blank', rel: 'noopener', title: 'Öffnen' }, ico('fas fa-up-right-from-square')),
          h('button', {
            class: 'btn sm danger', type: 'button', title: 'Löschen', onclick: async () => {
              const warn = inUse ? ' Achtung: Die Datei wird noch im Inhalt verwendet!' : '';
              if (!(await confirmBox('Datei löschen?', `„${it.path}“ wird sofort aus dem Repository gelöscht.${warn}`, 'Endgültig löschen', true))) return;
              try {
                await gh(`${repoPath()}/contents/${encPath(it.path)}`, { method: 'DELETE', body: JSON.stringify({ message: `Delete ${it.path} via admin panel`, sha: it.sha, branch: S.auth.branch }) });
                S.tree = S.tree.filter((x) => x.path !== it.path);
                toast('Gelöscht.');
                onChanged?.();
              } catch (e) { toast(e.message, 'err', 7000); }
            }
          }, ico('far fa-trash-can'))));
      }
      return card;
    }));
  }

  function mediaBrowser({ pick = false, filter = null, onPick }) {
    const root = h('div');
    const search = h('input', { class: 'input', placeholder: 'Suchen …', oninput: () => paint() });
    const typeSel = h('select', { class: 'input', style: 'max-width:170px', onchange: () => paint() },
      [['', 'Alle Dateien'], ['image', 'Bilder'], ['video', 'Videos'], ['doc', 'Dokumente']].map(([v, l]) => h('option', { value: v, selected: v === (filter || '') }, l)));
    const list = h('div', null, h('div', { class: 'loading', style: 'height:160px' }, h('i', { class: 'fas fa-circle-notch spin' })));
    const fileIn = h('input', {
      type: 'file', multiple: true, hidden: true, onchange: async (e) => {
        const files = [...e.target.files]; e.target.value = '';
        await uploadMany(files);
      }
    });
    const uploadMany = async (files) => {
      let last = null;
      for (const f of files) last = (await uploadWithFeedback(f)) || last;
      await refresh(true);
      if (pick && last && files.length === 1) onPick(last);
    };
    const drop = h('div', { class: 'dropzone' }, ico('fas fa-cloud-arrow-up'), ' Dateien hierher ziehen oder ',
      h('button', { class: 'btn sm', type: 'button', onclick: () => fileIn.click() }, 'auswählen'), fileIn,
      h('div', { class: 'help', style: 'margin-top:8px' },
        h('label', { class: 'check', style: 'font-size:.82rem' }, h('input', { type: 'checkbox', checked: optimizeEnabled(), onchange: (e) => { try { localStorage.setItem(OPTIMIZE_KEY, e.target.checked ? '1' : '0'); } catch (x) { /* ignore */ } } }),
          'Bilder automatisch optimieren (max. 2000 px, spart Ladezeit)')));
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', (e) => uploadMany([...e.dataTransfer.files]));

    let items = [];
    const paint = () => {
      const q = search.value.toLowerCase();
      const t = typeSel.value;
      const shown = items.filter((it) => (!q || it.path.toLowerCase().includes(q)) &&
        (!t || (t === 'image' && isImage(it.path)) || (t === 'video' && isVideo(it.path)) || (t === 'doc' && !isImage(it.path) && !isVideo(it.path))));
      list.innerHTML = '';
      list.append(shown.length ? mediaGrid(shown, { pick, onPick, onChanged: () => refresh() }) : h('div', { class: 'list-empty' }, 'Keine Dateien gefunden.'));
    };
    const refresh = async (force) => {
      try { items = (await loadTree(force)).slice().sort((a, b) => a.path.localeCompare(b.path)); paint(); }
      catch (e) { list.innerHTML = ''; list.append(h('div', { class: 'error-msg' }, e.message)); }
    };
    if (!S.auth) {
      root.append(h('div', { class: 'banner' }, ico('fas fa-plug-circle-xmark'), h('span', { class: 'grow' }, 'Die Mediathek braucht eine Verbindung zu GitHub. Bitte mit Token anmelden.')));
      return root;
    }
    root.append(drop, h('div', { class: 'media-toolbar' }, search, typeSel,
      h('button', { class: 'btn', type: 'button', title: 'Neu laden', onclick: () => refresh(true) }, ico('fas fa-rotate'))), list);
    refresh();
    return root;
  }

  function openMediaLibrary({ pick, filter }) {
    let resolveFn;
    const body = mediaBrowser({ pick, filter, onPick: (p) => resolveFn(p) });
    const p = modal({ title: pick ? 'Datei auswählen' : 'Mediathek', body, wide: true });
    resolveFn = (v) => closeTopModal(v);
    return p;
  }

  function renderMediaSection() {
    return h('div', { class: 'panel' }, h('div', { class: 'panel-body' },
      h('p', { class: 'intro', style: 'margin-bottom:16px' }, 'Alle Bilder, Videos und Dokumente unter ', h('code', null, 'assets/'),
        '. Neue Uploads landen in ', h('code', null, UPLOAD_DIR), ' und werden sofort ins Repository committet.'),
      mediaBrowser({})));
  }

  /* =========================================================
     JSON / backup section
     ========================================================= */
  function download(name, text) {
    const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'application/json' })), download: name });
    document.body.append(a); a.click(); a.remove();
  }
  function renderJsonSection() {
    const ta = h('textarea', { class: 'input mono', rows: 28, spellcheck: 'false', value: JSON.stringify(S.data, null, 2) });
    const err = h('div');
    const apply = (text) => {
      try {
        const d = JSON.parse(text);
        if (!d || typeof d !== 'object' || !d.site) throw new Error('Das sieht nicht nach einer gültigen site.json aus (Feld „site“ fehlt).');
        S.data = d; markDirty(); err.innerHTML = ''; renderSidebar();
        toast('JSON übernommen – zum Speichern „Veröffentlichen“ klicken.');
        return true;
      } catch (e) { err.innerHTML = ''; err.append(h('div', { class: 'error-msg' }, e.message)); return false; }
    };
    const imp = h('input', {
      type: 'file', accept: '.json,application/json', hidden: true, onchange: async (e) => {
        const f = e.target.files[0]; e.target.value = '';
        if (f) { const text = await f.text(); if (apply(text)) ta.value = JSON.stringify(S.data, null, 2); }
      }
    });
    return h('div', { class: 'panel' },
      h('div', { class: 'panel-head' }, h('h2', null, 'Rohdaten (content/site.json)'),
        h('span', { style: 'margin-left:auto;display:flex;gap:8px;flex-wrap:wrap' },
          h('button', { class: 'btn sm', type: 'button', onclick: () => download(`site-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(S.data, null, 2) + '\n') }, ico('fas fa-download'), 'Backup herunterladen'),
          h('button', { class: 'btn sm', type: 'button', onclick: () => imp.click() }, ico('fas fa-file-import'), 'Datei importieren'), imp,
          h('button', { class: 'btn sm primary', type: 'button', onclick: () => apply(ta.value) }, ico('fas fa-check'), 'Übernehmen'))),
      h('div', { class: 'panel-body', style: 'display:grid;gap:12px' },
        h('p', { class: 'intro' }, 'Für Profis: Hier kannst du den gesamten Inhalt direkt bearbeiten, sichern oder wiederherstellen.'), err, ta));
  }

  /* =========================================================
     Publishing
     ========================================================= */
  function validate() {
    const problems = [];
    const ids = new Set();
    (S.data.projects || []).forEach((p, i) => {
      if (!p.id) problems.push(`Projekt ${i + 1} („${p.title}“) hat kein URL-Kürzel.`);
      else if (ids.has(p.id)) problems.push(`URL-Kürzel „${p.id}“ ist doppelt vergeben.`);
      ids.add(p.id);
    });
    const cats = new Set();
    (S.data.categories || []).forEach((c) => { if (!c.id) problems.push(`Kategorie „${c.label}“ hat keine ID.`); if (cats.has(c.id)) problems.push(`Kategorie-ID „${c.id}“ doppelt.`); cats.add(c.id); });
    return problems;
  }

  async function publish() {
    if (!S.auth) { download('site.json', JSON.stringify(S.data, null, 2) + '\n'); toast('Offline-Modus: site.json heruntergeladen. Datei in content/ ersetzen.'); return; }
    const problems = validate();
    if (problems.length) {
      await modal({ title: 'Bitte zuerst korrigieren', body: h('ul', null, problems.map((p) => h('li', null, p))), actions: [{ label: 'OK', value: true, class: 'primary' }] });
      return;
    }
    const msgInput = h('input', { class: 'input', value: 'Update content via admin panel' });
    const ok = await modal({
      title: 'Änderungen veröffentlichen',
      body: h('div', { style: 'display:grid;gap:10px' }, h('p', null, 'Die Änderungen werden als Commit in ', h('code', null, `${S.auth.owner}/${S.auth.repo}@${S.auth.branch}`), ' gespeichert. GitHub Pages aktualisiert die Webseite danach in ca. 1 Minute.'),
        h('label', { class: 'help' }, 'Commit-Nachricht'), msgInput),
      actions: [{ label: 'Abbrechen', value: null }, { label: 'Veröffentlichen', value: () => msgInput.value || 'Update content via admin panel', class: 'primary', icon: 'fas fa-cloud-arrow-up' }]
    });
    if (!ok) return;
    const btn = $('#publish-btn');
    btn.disabled = true; btn.firstChild.className = 'fas fa-circle-notch spin';
    try {
      const remote = await gh(`${repoPath()}/contents/${encPath(CONTENT_PATH)}?ref=${encodeURIComponent(S.auth.branch)}`);
      if (remote.sha !== S.sha) {
        const go = await confirmBox('Inhalt wurde zwischenzeitlich geändert',
          'Seit dem Laden wurde content/site.json im Repository geändert (z. B. aus einem anderen Tab oder per Git). Wenn du fortfährst, werden diese Änderungen mit deiner Version überschrieben.', 'Trotzdem überschreiben', true);
        if (!go) return;
      }
      const res = await putFile(CONTENT_PATH, b64encode(JSON.stringify(S.data, null, 2) + '\n'), ok, remote.sha);
      S.sha = res.content.sha;
      S.dirty = false;
      clearDraftFlag();
      renderStatus();
      toast('Veröffentlicht! Die Webseite ist in ca. 1 Minute aktuell.', 'ok', 6000);
    } catch (e) {
      toast(e.message, 'err', 8000);
    } finally {
      btn.disabled = false; btn.firstChild.className = 'fas fa-cloud-arrow-up';
    }
  }

  async function discard() {
    if (!(await confirmBox('Änderungen verwerfen?', 'Alle nicht veröffentlichten Änderungen gehen verloren und der veröffentlichte Stand wird neu geladen.', 'Verwerfen', true))) return;
    await loadData();
    S.dirty = false;
    clearDraftFlag();
    saveDraft(true);
    renderApp();
    toast('Veröffentlichter Stand geladen.');
  }

  function openPreview() {
    saveDraft(true);
    const sec = sectionById(S.section);
    let target = sec?.page || 'index.html';
    if (S.section === 'projects') {
      const openIdx = [...S.open].map((k) => k.match(/^projects\.(\d+)$/)).filter(Boolean).map((m) => +m[1]).pop();
      const p = openIdx != null ? S.data.projects[openIdx] : null;
      if (p?.id) target = `project.html?id=${encodeURIComponent(p.id)}`;
    }
    window.open(`../${target}${target.includes('?') ? '&' : '?'}preview=1`, 'portfolio-preview');
  }

  /* =========================================================
     App shell
     ========================================================= */
  const root = $('#root');

  function renderStatus() {
    const st = $('#status');
    if (!st) return;
    st.className = 'status' + (S.dirty ? ' dirty' : '');
    st.textContent = S.dirty ? 'Ungespeicherte Änderungen' : (S.auth ? 'Alles veröffentlicht' : 'Offline-Modus');
    const d = $('#discard-btn');
    if (d) d.hidden = !S.dirty || !S.auth;
  }

  function renderSidebar() {
    const sb = $('.sidebar');
    if (!sb) return;
    sb.innerHTML = '';
    sb.append(h('div', { class: 'brand' }, h('span', { class: 'mark' }, 'SK'), h('div', null, 'Portfolio Admin', h('small', null, S.data.site?.name || ''))));
    for (const s of SECTIONS) {
      if (s.group) { sb.append(h('div', { class: 'group-label' }, s.group)); continue; }
      sb.append(h('button', { class: `nav-item${S.section === s.id ? ' active' : ''}`, type: 'button', onclick: () => { S.section = s.id; renderApp(); } },
        ico(s.icon), s.label, s.count ? h('span', { class: 'badge' }, s.count(S.data)) : null));
    }
    sb.append(h('div', { class: 'spacer' }));
    sb.append(h('button', { class: 'nav-item', type: 'button', onclick: () => window.open('../index.html', '_blank') }, ico('fas fa-arrow-up-right-from-square'), 'Live-Seite öffnen'));
    sb.append(h('button', {
      class: 'nav-item', type: 'button', onclick: () => {
        const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
        document.documentElement.dataset.theme = next;
        try { localStorage.setItem('theme', next); } catch (e) { /* ignore */ }
      }
    }, ico('fas fa-circle-half-stroke'), 'Hell / Dunkel'));
    sb.append(h('button', { class: 'nav-item', type: 'button', onclick: logout }, ico('fas fa-right-from-bracket'), S.auth ? 'Abmelden' : 'Beenden'));
    sb.append(h('div', { class: 'repo' }, S.auth ? ['Verbunden mit ', h('strong', null, `${S.auth.owner}/${S.auth.repo}`), ` (${S.auth.branch})`] : 'Nicht mit GitHub verbunden – Änderungen können nur als Datei exportiert werden.'));
  }

  function renderApp() {
    S.titleRefs = [];
    const sec = sectionById(S.section) || sectionById('home');
    const content = h('div', { class: 'content-inner' });
    if (sec.intro) content.append(h('p', { class: 'intro' }, sec.intro));
    if (!S.auth) content.append(h('div', { class: 'banner' }, ico('fas fa-plug-circle-xmark'),
      h('span', { class: 'grow' }, 'Offline-Modus: Du kannst alles bearbeiten und in der Vorschau ansehen. „Exportieren“ lädt die fertige site.json herunter.')));
    if (sec.custom) content.append(sec.custom());
    else {
      const body = renderNode(sec.schema, sec.path);
      content.append(sec.schema.type === 'list' ? body : h('div', { class: 'panel' }, h('div', { class: 'panel-body' }, body)));
    }

    root.innerHTML = '';
    root.append(h('div', { class: 'layout' },
      h('aside', { class: 'sidebar' }),
      h('div', { class: 'main' },
        h('header', { class: 'topbar' },
          h('h1', null, sec.label), h('span', { id: 'status', class: 'status' }),
          h('div', { class: 'actions' },
            h('button', { id: 'discard-btn', class: 'btn ghost', type: 'button', onclick: discard, hidden: true }, ico('fas fa-rotate-left'), h('span', { class: 'lbl' }, 'Verwerfen')),
            h('button', { class: 'btn', type: 'button', onclick: openPreview, title: 'Vorschau mit ungespeicherten Änderungen' }, ico('fas fa-eye'), h('span', { class: 'lbl' }, 'Vorschau')),
            h('button', { id: 'publish-btn', class: 'btn primary', type: 'button', onclick: publish, title: 'Strg+S' },
              ico(S.auth ? 'fas fa-cloud-arrow-up' : 'fas fa-download'), h('span', { class: 'lbl' }, S.auth ? 'Veröffentlichen' : 'Exportieren')))),
        h('div', { class: 'content' }, content))));
    renderSidebar();
    renderStatus();
  }

  /* =========================================================
     Login / boot
     ========================================================= */
  function readAuth() {
    try { return JSON.parse(sessionStorage.getItem(AUTH_KEY) || localStorage.getItem(AUTH_KEY) || 'null'); } catch (e) { return null; }
  }
  function logout() {
    if (S.dirty && !confirm('Es gibt nicht veröffentlichte Änderungen. Sie bleiben als Entwurf in diesem Browser gespeichert. Trotzdem abmelden?')) return;
    try { sessionStorage.removeItem(AUTH_KEY); localStorage.removeItem(AUTH_KEY); } catch (e) { /* ignore */ }
    S.auth = null; S.data = null; S.dirty = false;
    renderLogin();
  }

  async function loadData() {
    if (S.auth) {
      const r = await fetchRemoteContent();
      S.data = r.data; S.sha = r.sha;
    } else {
      const res = await fetch('../content/site.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error(`content/site.json konnte nicht geladen werden (HTTP ${res.status}).`);
      S.data = await res.json(); S.sha = null;
    }
  }

  async function start() {
    root.innerHTML = '';
    root.append(h('div', { class: 'loading' }, h('i', { class: 'fas fa-circle-notch spin', style: 'font-size:1.6rem' }), 'Lade Inhalte …'));
    await loadData();

    // offer to restore an unpublished draft from a previous session
    let meta = null, draft = null;
    try { meta = JSON.parse(localStorage.getItem(DRAFT_META_KEY) || 'null'); draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch (e) { /* ignore */ }
    S.dirty = false;
    renderApp();
    if (meta?.dirty && draft && JSON.stringify(draft) !== JSON.stringify(S.data)) {
      const outdated = S.auth && meta.baseSha && meta.baseSha !== S.sha;
      const when = new Date(meta.savedAt).toLocaleString('de-DE');
      const restore = await modal({
        title: 'Entwurf gefunden',
        body: h('div', null, h('p', null, `Es gibt nicht veröffentlichte Änderungen vom ${when}. Möchtest du daran weiterarbeiten?`),
          outdated ? h('div', { class: 'error-msg' }, 'Achtung: Der veröffentlichte Inhalt wurde seitdem geändert. Beim Veröffentlichen des Entwurfs würden diese neueren Änderungen überschrieben.') : null),
        actions: [{ label: 'Verwerfen', value: false, class: 'danger' }, { label: 'Entwurf wiederherstellen', value: true, class: 'primary' }]
      });
      if (restore) { S.data = draft; S.dirty = true; renderApp(); toast('Entwurf wiederhergestellt.'); }
    }
    saveDraft(true);
  }

  function renderLogin(error) {
    const saved = readAuth();
    const token = h('input', { class: 'input mono', type: 'password', placeholder: 'github_pat_…', autocomplete: 'off', required: true });
    const repo = h('input', { class: 'input mono', value: saved ? `${saved.owner}/${saved.repo}` : DEFAULT_REPO, required: true });
    const branch = h('input', { class: 'input mono', value: saved?.branch || DEFAULT_BRANCH, required: true });
    const remember = h('input', { type: 'checkbox' });
    const errBox = h('div', null, error ? h('div', { class: 'error-msg' }, error) : null);
    const submit = h('button', { class: 'btn primary', type: 'submit' }, ico('fab fa-github'), 'Anmelden');

    const onSubmit = async (e) => {
      e.preventDefault();
      const [owner, name] = repo.value.trim().split('/');
      if (!owner || !name) { errBox.innerHTML = ''; errBox.append(h('div', { class: 'error-msg' }, 'Repository im Format „besitzer/name“ angeben.')); return; }
      S.auth = { token: token.value.trim(), owner, repo: name, branch: branch.value.trim() || DEFAULT_BRANCH };
      submit.disabled = true; submit.firstChild.className = 'fas fa-circle-notch spin';
      try {
        await gh(repoPath());
        const store = remember.checked ? localStorage : sessionStorage;
        store.setItem(AUTH_KEY, JSON.stringify(S.auth));
        await start();
      } catch (err) {
        S.auth = null;
        renderLogin(err.message);
      }
    };

    root.innerHTML = '';
    root.append(h('div', { class: 'login' }, h('div', { class: 'login-card' },
      h('div', { class: 'logo' }, 'SK'),
      h('h1', null, 'Portfolio Admin'),
      h('p', null, 'Inhalte bearbeiten und direkt auf GitHub veröffentlichen.'),
      h('form', { onsubmit: onSubmit },
        errBox,
        h('div', { class: 'field' }, h('label', null, 'GitHub Access Token'), token),
        h('div', { class: 'row' },
          h('div', { class: 'field' }, h('label', null, 'Repository'), repo),
          h('div', { class: 'field' }, h('label', null, 'Branch'), branch)),
        h('label', { class: 'check' }, remember, 'Auf diesem Gerät angemeldet bleiben'),
        submit,
        h('div', { class: 'or' }, 'oder'),
        h('button', {
          class: 'btn', type: 'button', onclick: async () => {
            S.auth = null;
            try { await start(); } catch (err) { renderLogin(err.message); }
          }
        }, ico('fas fa-laptop'), 'Ohne Anmeldung (nur Vorschau & Export)')),
      h('details', null,
        h('summary', null, 'Wie bekomme ich einen Token?'),
        h('ol', null,
          h('li', null, 'Öffne ', h('a', { href: 'https://github.com/settings/personal-access-tokens/new', target: '_blank', rel: 'noopener' }, 'GitHub → Fine-grained token erstellen'), '.'),
          h('li', null, 'Repository access: „Only select repositories“ → ', h('code', null, DEFAULT_REPO.split('/')[1]), '.'),
          h('li', null, 'Permissions → Repository permissions → ', h('strong', null, 'Contents: Read and write'), '.'),
          h('li', null, 'Token generieren, kopieren und hier einfügen.')),
        h('p', { style: 'margin:10px 0 0' }, 'Der Token wird nur in deinem Browser gespeichert und ausschließlich an api.github.com gesendet. Ohne „angemeldet bleiben“ wird er beim Schließen des Tabs gelöscht.')))));
    token.focus();
  }

  // unsaved changes guard + Ctrl/Cmd+S
  window.addEventListener('beforeunload', (e) => { if (S.dirty && S.auth) { e.preventDefault(); e.returnValue = ''; } });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && S.data) { e.preventDefault(); publish(); }
  });

  // boot
  const saved = readAuth();
  if (saved?.token) {
    S.auth = saved;
    start().catch((err) => { S.auth = null; renderLogin(err.message); });
  } else renderLogin();
})();
