/* =========================================================
   Portfolio renderer
   Every page is a thin HTML shell (<body data-page="…">);
   the content comes from content/site.json, which is edited
   through the admin panel in /admin/.
   ========================================================= */
(() => {
  'use strict';

  const CONTENT_URL = 'content/site.json';
  const DRAFT_KEY = 'portfolio-draft';
  const PREVIEW_FLAG = 'portfolio-preview';

  const page = document.body.dataset.page || 'home';
  const app = document.getElementById('app');
  const params = new URLSearchParams(location.search);

  /* ---------- helpers ---------- */
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Only allow safe URL schemes; everything else becomes "#".
  const url = (v) => {
    const s = String(v ?? '').trim();
    if (!s) return '#';
    if (/^(https?:|mailto:|tel:|#|\/|\.\/|\.\.\/)/i.test(s) || !/^[a-z][a-z0-9+.-]*:/i.test(s)) return esc(s);
    return '#';
  };
  const isExternal = (v) => /^https?:\/\//i.test(String(v || ''));
  const linkAttrs = (href, download) =>
    `href="${url(href)}"${isExternal(href) ? ' target="_blank" rel="noopener"' : ''}${download ? ' download' : ''}`;
  const icon = (cls, extra = '') => (cls ? `<i class="${esc(cls)}${extra ? ' ' + extra : ''}" aria-hidden="true"></i>` : '');

  const PURIFY = { ADD_TAGS: ['video', 'source'], ADD_ATTR: ['controls', 'preload', 'target', 'poster', 'playsinline'] };
  const sanitize = (html) => (window.DOMPurify ? DOMPurify.sanitize(html, PURIFY) : esc(html));
  const md = (text) => {
    if (!text) return '';
    const html = window.marked ? marked.parse(String(text), { gfm: true, breaks: false }) : `<p>${esc(text)}</p>`;
    return externalLinks(sanitize(html));
  };
  const mdInline = (text) => {
    if (!text) return '';
    const html = window.marked ? marked.parseInline(String(text), { gfm: true }) : esc(text);
    return externalLinks(sanitize(html));
  };
  const externalLinks = (html) => html.replace(/<a href="(https?:[^"]+)"/g, '<a href="$1" target="_blank" rel="noopener"');
  const slug = (s) => String(s).toLowerCase().replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const initials = (name) => String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

  /* ---------- content loading (with admin preview support) ---------- */
  if (params.has('preview')) sessionStorage.setItem(PREVIEW_FLAG, '1');
  const previewMode = sessionStorage.getItem(PREVIEW_FLAG) === '1';

  async function loadContent() {
    if (previewMode) {
      try {
        const draft = localStorage.getItem(DRAFT_KEY);
        if (draft) return JSON.parse(draft);
      } catch (e) { /* fall through to published content */ }
    }
    const res = await fetch(CONTENT_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  /* ---------- theme ---------- */
  function toggleTheme() {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('theme', next); } catch (e) { /* ignore */ }
  }

  /* ---------- layout: nav + footer ---------- */
  function currentFile() {
    const f = location.pathname.split('/').pop();
    return f || 'index.html';
  }

  function renderNav(c) {
    const here = page === 'project' ? 'projects.html' : currentFile();
    const links = (c.site.nav || []).map((n) =>
      `<li><a ${linkAttrs(n.href)}${n.href === here ? ' aria-current="page"' : ''}>${esc(n.label)}</a></li>`).join('');
    return `
      <nav class="nav" aria-label="Main">
        <div class="nav-inner">
          <a class="nav-brand" href="index.html">
            <span class="nav-logo">${esc(initials(c.site.name))}</span>
            <span class="brand-text">${esc(c.site.brand || c.site.name)}</span>
          </a>
          <ul class="nav-links" id="nav-links">${links}</ul>
          <div class="nav-actions">
            <button class="icon-btn theme-toggle" type="button" aria-label="Toggle color theme">
              <i class="fas fa-moon"></i><i class="fas fa-sun"></i>
            </button>
            <button class="icon-btn nav-toggle" type="button" aria-label="Menu" aria-expanded="false" aria-controls="nav-links">
              <i class="fas fa-bars"></i>
            </button>
          </div>
        </div>
      </nav>`;
  }

  function renderSocials(c) {
    return (c.site.socials || []).map((s) =>
      `<a class="icon-btn" ${linkAttrs(s.url)} aria-label="${esc(s.label)}" title="${esc(s.label)}">${icon(s.icon)}</a>`).join('');
  }

  function renderFooter(c) {
    return `
      <footer class="footer">
        <div class="container footer-inner">
          <p>${esc(c.site.footer)}</p>
          <div class="socials">${renderSocials(c)}</div>
        </div>
      </footer>`;
  }

  function pageHeader(p, extra = '') {
    if (!p) return '';
    return `
      <header class="page-header">
        <div class="container">
          <h1 class="reveal">${p.icon ? `<span class="icon-tile">${icon(p.icon)}</span>` : ''}${esc(p.title)}</h1>
          ${p.subtitle ? `<p class="lead reveal" style="--d:.08s">${mdInline(p.subtitle)}</p>` : ''}
          ${p.note ? `<p class="note reveal" style="--d:.12s">${mdInline(p.note)}</p>` : ''}
          ${extra}
        </div>
      </header>`;
  }

  const tagLabel = (c, id) => (c.categories || []).find((x) => x.id === id)?.label || id;
  const tagsHtml = (c, tags) => `<div class="tags">${(tags || []).map((t) => `<span class="tag" data-tag="${esc(t)}">${esc(tagLabel(c, t))}</span>`).join('')}</div>`;
  const visibleProjects = (c) => (c.projects || []).filter((p) => previewMode || !p.hidden);
  const projectHref = (p) => `project.html?id=${encodeURIComponent(p.id)}`;

  function projectCard(c, p, i = 0) {
    let media;
    if (p.banner) media = `<img class="cover" src="${url(p.banner)}" alt="" loading="lazy" decoding="async">`;
    else if (p.logo) media = `<img class="logo" src="${url(p.logo)}" alt="" loading="lazy" decoding="async">`;
    else media = `<div class="placeholder">${p.icon ? icon(p.icon) : `<span>${esc(initials(p.title))}</span>`}</div>`;
    return `
      <a class="card project-card reveal" style="--d:${(i % 3) * 0.06}s" href="${projectHref(p)}" data-tags="${esc((p.tags || []).join(' '))}">
        <div class="project-media">${media}</div>
        <div class="project-body">
          <h3>${esc(p.title)}</h3>
          <p>${mdInline(p.summary)}</p>
          <div class="project-foot">${tagsHtml(c, p.tags)}<span class="go"><i class="fas fa-arrow-right"></i></span></div>
        </div>
      </a>`;
  }

  function button(b) {
    return `<a class="btn ${b.style === 'primary' ? 'btn-primary' : ''}" ${linkAttrs(b.url, b.download)}>${icon(b.icon)} ${esc(b.label)}</a>`;
  }

  /* ---------- pages ---------- */
  const pages = {
    home(c) {
      const h = c.home;
      const L = c.labels || {};
      const projects = visibleProjects(c);
      const skillCount = (c.skills || []).reduce((n, s) => n + (s.items || []).length, 0);
      const cv = h.cv && (h.cv.files || []).length ? `
        <div class="dropdown" id="cv-dropdown">
          <button class="btn" type="button" aria-haspopup="true" aria-expanded="false">
            ${icon(h.cv.icon || 'fas fa-download')} ${esc(h.cv.label)} <i class="fas fa-chevron-down"></i>
          </button>
          <div class="dropdown-menu" role="menu">
            ${h.cv.files.map((f) => `<a role="menuitem" href="${url(f.file)}" download><i class="fas fa-file-pdf"></i> ${esc(f.label)}</a>`).join('')}
          </div>
        </div>` : '';
      const featured = projects.slice(0, Math.max(0, Number(h.featuredCount) || 0));

      document.title = `${h.title || c.site.name}`;
      return `
        <section class="hero">
          <div class="container hero-grid">
            <div>
              <span class="eyebrow reveal"><span class="dot"></span>${esc(c.site.brand)}</span>
              <h1 class="reveal" style="--d:.05s"><span class="gradient-text">${esc(h.title)}</span></h1>
              <p class="hero-subtitle reveal" style="--d:.1s">${mdInline(h.subtitle)}</p>
              <div class="btn-row reveal" style="--d:.15s">${(h.buttons || []).map(button).join('')}${cv}</div>
              <div class="hero-stats reveal" style="--d:.2s">
                <div><div class="stat-value">${projects.length}</div><div class="stat-label">${esc(L.statProjects)}</div></div>
                <div><div class="stat-value">${skillCount}</div><div class="stat-label">${esc(L.statSkills)}</div></div>
                <div><div class="stat-value">${(c.certificates || []).length}</div><div class="stat-label">${esc(L.statCertificates)}</div></div>
              </div>
            </div>
            ${h.profileImage ? `
            <div class="portrait reveal" style="--d:.1s">
              <img src="${url(h.profileImage)}" alt="${esc(c.site.name)}" decoding="async" fetchpriority="high">
              <div class="portrait-tag"><i class="fas fa-terminal"></i> ${esc(c.site.name.split(' ')[0].toLowerCase())}@portfolio</div>
            </div>` : ''}
          </div>
        </section>

        <section class="section" id="about">
          <div class="container about-grid">
            <article class="card about-card primary reveal">
              <h2><span class="icon-tile"><i class="fas fa-user"></i></span>${esc(h.aboutTitle)}</h2>
              <p>${mdInline(h.about)}</p>
            </article>
            <article class="card about-card reveal" style="--d:.08s">
              <h3><span class="icon-tile"><i class="fas fa-seedling"></i></span>${esc(h.developmentTitle)}</h3>
              <p>${mdInline(h.development)}</p>
            </article>
          </div>
        </section>

        ${featured.length ? `
        <section class="section">
          <div class="container">
            <div class="section-head reveal">
              <h2 class="section-title">${esc(h.featuredTitle)}</h2>
              <a class="link-arrow" href="projects.html">${esc(L.viewAllProjects)} <i class="fas fa-arrow-right"></i></a>
            </div>
            <div class="projects-grid">${featured.map((p, i) => projectCard(c, p, i)).join('')}</div>
          </div>
        </section>` : ''}

        <section class="section">
          <div class="container">
            <div class="section-head reveal"><h2 class="section-title">${esc(h.overviewTitle)}</h2></div>
            <div class="overview-grid">
              ${(h.overview || []).map((o, i) => `
                <a class="card overview-card reveal" style="--d:${i * 0.06}s" ${linkAttrs(o.url)}>
                  <span class="icon-tile">${icon(o.icon)}</span>
                  <h3>${esc(o.title)}</h3>
                  <p>${mdInline(o.text)}</p>
                  <span class="link-arrow">${esc(o.linkLabel)} <i class="fas fa-arrow-right"></i></span>
                </a>`).join('')}
            </div>
          </div>
        </section>`;
    },

    projects(c) {
      const projects = visibleProjects(c);
      const count = (id) => projects.filter((p) => (p.tags || []).includes(id)).length;
      const filters = [`<button class="filter-btn" type="button" data-filter="all" aria-pressed="true">${esc(c.labels?.filterAll || 'All')}<span class="count">${projects.length}</span></button>`]
        .concat((c.categories || []).map((cat) => `<button class="filter-btn" type="button" data-filter="${esc(cat.id)}" aria-pressed="false">${esc(cat.label)}<span class="count">${count(cat.id)}</span></button>`));
      return `
        ${pageHeader(c.pages.projects)}
        <section class="section" style="padding-top:0">
          <div class="container">
            <div class="filters reveal" role="group" aria-label="Filter">${filters.join('')}</div>
            <div class="projects-grid">${projects.map((p, i) => projectCard(c, p, i)).join('')}</div>
            ${projects.length ? '' : '<p class="empty">—</p>'}
          </div>
        </section>`;
    },

    project(c) {
      const list = visibleProjects(c);
      const id = params.get('id');
      const idx = list.findIndex((p) => p.id === id);
      const p = idx >= 0 ? list[idx] : null;
      if (!p) return pages.notFound(c);
      document.title = `${p.title} – ${c.site.name}`;

      const body = md(p.body);
      const headings = [...body.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)].map((m) => m[1].replace(/<[^>]+>/g, '').trim());
      const bodyWithIds = body.replace(/<h2([^>]*)>([\s\S]*?)<\/h2>/g, (m, a, t) => `<h2${a} id="${slug(t)}">${t}</h2>`);
      const videosTitle = p.videosTitle || c.labels?.videosTitle || 'Videos';
      const videos = (p.videos || []).filter((v) => v.src);
      const back = c.labels?.backToProjects || 'Back to Projects';
      const prev = idx > 0 ? list[idx - 1] : null;
      const next = idx >= 0 && idx < list.length - 1 ? list[idx + 1] : null;

      return `
        <header class="page-header${p.banner ? ' has-banner' : ''}">
          ${p.banner ? `<div class="banner-bg"><img src="${url(p.banner)}" alt=""></div>` : ''}
          <div class="container">
            <a class="breadcrumb" href="projects.html"><i class="fas fa-arrow-left"></i> ${esc(back)}</a>
            <h1 class="reveal">${p.icon ? `<span class="icon-tile">${icon(p.icon)}</span>` : ''}${esc(p.title)}</h1>
            ${p.subtitle ? `<p class="subtitle-accent reveal" style="--d:.05s">${esc(p.subtitle)}</p>` : ''}
            <div class="reveal" style="--d:.1s">${tagsHtml(c, p.tags)}</div>
          </div>
        </header>
        <section class="section" style="padding-top:8px">
          <div class="container detail-layout">
            <article>
              <div class="prose">${bodyWithIds}</div>
              ${videos.length ? `
                <div class="prose"><h2 id="${slug(videosTitle)}">${esc(videosTitle)}</h2></div>
                <div class="videos">
                  ${videos.map((v) => `
                    <figure class="card video-card" style="margin:0">
                      <video controls preload="metadata" playsinline src="${url(v.src)}"${v.poster ? ` poster="${url(v.poster)}"` : ''}></video>
                      ${v.title ? `<h3><i class="fas fa-play-circle"></i>${esc(v.title)}</h3>` : ''}
                    </figure>`).join('')}
                </div>` : ''}
              ${prev || next ? `
                <nav class="pager" aria-label="Projects">
                  ${prev ? `<a class="card" href="${projectHref(prev)}"><small><i class="fas fa-arrow-left"></i> ${esc(c.labels?.previous || 'Previous')}</small><span>${esc(prev.title)}</span></a>` : ''}
                  ${next ? `<a class="card next" href="${projectHref(next)}"><small>${esc(c.labels?.next || 'Next')} <i class="fas fa-arrow-right"></i></small><span>${esc(next.title)}</span></a>` : ''}
                </nav>` : ''}
            </article>
            <aside class="detail-aside">
              ${p.logo ? `<div class="card aside-card"><img class="logo" src="${url(p.logo)}" alt="${esc(p.title)} Logo"></div>` : ''}
              ${(p.links || []).length ? `<div class="card aside-card">${p.links.map(button).join('')}</div>` : ''}
              ${headings.length > 1 || videos.length ? `
                <div class="card aside-card toc-card">
                  <h4>${esc(c.labels?.contents || 'Contents')}</h4>
                  <ul class="toc">
                    ${headings.map((h) => `<li><a href="#${slug(h)}">${esc(h)}</a></li>`).join('')}
                    ${videos.length ? `<li><a href="#${slug(videosTitle)}">${esc(videosTitle)}</a></li>` : ''}
                  </ul>
                </div>` : ''}
            </aside>
          </div>
        </section>`;
    },

    skills(c) {
      return `
        ${pageHeader(c.pages.skills)}
        <section class="section" style="padding-top:0">
          <div class="container skills-grid">
            ${(c.skills || []).map((s, i) => `
              <article class="card skill-card reveal" style="--d:${(i % 2) * 0.06}s">
                <header><span class="icon-tile">${icon(s.icon)}</span><h2>${esc(s.title)}</h2><span class="count">${(s.items || []).length}</span></header>
                <div class="chips">${(s.items || []).map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</div>
              </article>`).join('')}
          </div>
        </section>`;
    },

    certificates(c) {
      const label = c.labels?.viewBadge || 'View Badge';
      return `
        ${pageHeader(c.pages.certificates)}
        <section class="section" style="padding-top:0">
          <div class="container cert-grid">
            ${(c.certificates || []).map((x, i) => `
              <a class="card cert-card reveal" style="--d:${(i % 3) * 0.06}s" ${linkAttrs(x.url)}>
                ${x.badgeIcon ? `<span class="badge-icon">${icon(x.badgeIcon)}</span>` : ''}
                ${x.image ? `<img src="${url(x.image)}" alt="${esc(x.title)}" loading="lazy" decoding="async">` : ''}
                <span class="issuer">${esc(x.issuer)}</span>
                <h3>${esc(x.title)}</h3>
                ${x.url ? `<span class="link-arrow"><i class="fas fa-external-link-alt"></i> ${esc(x.linkLabel || label)}</span>` : ''}
              </a>`).join('')}
          </div>
        </section>`;
    },

    externals(c) {
      return `
        ${pageHeader(c.pages.externals)}
        <section class="section" style="padding-top:0">
          <div class="container">
            <div class="timeline">
              ${(c.externals || []).map((x) => `
                <div class="timeline-item reveal">
                  <span class="icon-tile">${icon(x.icon)}</span>
                  <article class="card">
                    <h3>${esc(x.name)}</h3>
                    ${x.meta ? `<p class="meta">${esc(x.meta)}</p>` : ''}
                    <p>${mdInline(x.text)}</p>
                  </article>
                </div>`).join('')}
            </div>
          </div>
        </section>`;
    },

    contact(c) {
      const k = c.contact || {};
      return `
        ${pageHeader(c.pages.contact)}
        <section class="section" style="padding-top:0">
          <div class="container">
            <div class="contact-grid">
              ${(k.cards || []).map((x, i) => `
                <a class="card contact-card reveal" style="--d:${i * 0.06}s;${x.color ? `--brand:${esc(x.color)}` : ''}" ${linkAttrs(x.url)}>
                  <span class="icon-tile">${icon(x.icon)}</span>
                  <h3>${esc(x.title)}</h3>
                  <p>${esc(x.text)}</p>
                  <span class="link-arrow">${esc(x.linkLabel)} <i class="fas fa-arrow-right"></i></span>
                </a>`).join('')}
            </div>
            ${k.info ? `<div class="card info-box reveal"><span class="icon-tile"><i class="fas fa-info-circle"></i></span><p>${mdInline(k.info)}</p></div>` : ''}
          </div>
        </section>`;
    },

    notFound(c) {
      return `
        <section class="container error-state">
          <h1 class="gradient-text">404</h1>
          <p>This page doesn't exist (anymore).</p>
          <p><a class="btn btn-primary" href="index.html"><i class="fas fa-house"></i> Home</a></p>
        </section>`;
    }
  };

  /* ---------- behaviour ---------- */
  function bind() {
    const nav = document.querySelector('.nav');
    const navToggle = document.querySelector('.nav-toggle');
    navToggle?.addEventListener('click', () => {
      const open = nav.classList.toggle('open');
      navToggle.setAttribute('aria-expanded', String(open));
      navToggle.innerHTML = `<i class="fas fa-${open ? 'xmark' : 'bars'}"></i>`;
    });
    document.querySelector('.theme-toggle')?.addEventListener('click', toggleTheme);

    // CV dropdown
    const dd = document.getElementById('cv-dropdown');
    if (dd) {
      const btn = dd.querySelector('button');
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        btn.setAttribute('aria-expanded', String(dd.classList.toggle('open')));
      });
      document.addEventListener('click', (e) => { if (!dd.contains(e.target)) { dd.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); } });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') dd.classList.remove('open'); });
    }

    // Project filters
    const buttons = document.querySelectorAll('.filter-btn');
    buttons.forEach((b) => b.addEventListener('click', () => {
      buttons.forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      const f = b.dataset.filter;
      document.querySelectorAll('.project-card').forEach((card) => {
        card.hidden = !(f === 'all' || card.dataset.tags.split(' ').includes(f));
      });
    }));

    // Reveal on scroll
    const els = document.querySelectorAll('.reveal');
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((entries) => entries.forEach((en) => {
        if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
      }), { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });
      els.forEach((el) => io.observe(el));
    } else els.forEach((el) => el.classList.add('in'));

    // Table of contents highlighting
    const toc = document.querySelectorAll('.toc a');
    if (toc.length && 'IntersectionObserver' in window) {
      const map = new Map([...toc].map((a) => [a.getAttribute('href').slice(1), a]));
      const io = new IntersectionObserver((entries) => entries.forEach((en) => {
        if (en.isIntersecting) { toc.forEach((a) => a.classList.remove('active')); map.get(en.target.id)?.classList.add('active'); }
      }), { rootMargin: '-20% 0px -70% 0px' });
      map.forEach((a, id) => { const el = document.getElementById(id); if (el) io.observe(el); });
    }

    if (previewMode) {
      const bar = document.createElement('div');
      bar.className = 'preview-bar';
      bar.innerHTML = '<i class="fas fa-eye"></i> Vorschau (nicht veröffentlicht) <button type="button">Beenden</button>';
      bar.querySelector('button').addEventListener('click', () => {
        sessionStorage.removeItem(PREVIEW_FLAG);
        location.href = location.pathname + location.search.replace(/[?&]preview(=[^&]*)?/, '').replace(/^&/, '?');
      });
      document.body.appendChild(bar);
    }
  }

  /* ---------- boot ---------- */
  loadContent()
    .then((c) => {
      const render = pages[page] || pages.notFound;
      const main = render(c);
      const titles = { projects: 'projects', skills: 'skills', certificates: 'certificates', externals: 'externals', contact: 'contact' };
      if (titles[page]) document.title = `${c.pages[titles[page]]?.title || page} – ${c.site.name}`;
      if (page === 'notFound') document.title = `404 – ${c.site.name}`;
      const desc = document.querySelector('meta[name="description"]');
      if (desc && c.site.description) desc.content = c.site.description;
      app.outerHTML = `${renderNav(c)}<main id="main">${main}</main>${renderFooter(c)}`;
      bind();
    })
    .catch((err) => {
      console.error(err);
      app.innerHTML = `
        <section class="container error-state">
          <h1>:(</h1>
          <p>Content could not be loaded (${esc(err.message)}).</p>
          <p style="font-size:.9rem">Opening the files directly from disk (file://) does not work — start a local web server, e.g. <code>python -m http.server</code>.</p>
        </section>`;
    });

  console.log('%cHallo! 👋', 'color:#34d399;font-size:22px;font-weight:bold');
  console.log('%cWenn du das siehst, bist du wohl technikaffin! 🚀', 'color:#60a5fa;font-size:14px');
})();
