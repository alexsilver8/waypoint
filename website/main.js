// Waypoint landing page: the hero replay, scroll reveals, the section rail and
// download links that point at the right installer from the latest release.

const REPO = 'alexsilver8/waypoint';
const LATEST = `https://github.com/${REPO}/releases/latest`;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ── Which computer is this? ──────────────────────────────

function detectOS() {
  const ua = navigator.userAgent;
  const platform = (navigator.userAgentData?.platform || navigator.platform || '').toLowerCase();
  if (/android|iphone|ipad|ipod/i.test(ua)) return 'mobile';
  if (platform.includes('mac') || /mac os x/i.test(ua)) {
    // iPadOS asks for the desktop site and reports itself as a Mac.
    return navigator.maxTouchPoints > 1 ? 'mobile' : 'mac';
  }
  if (platform.includes('win') || /windows/i.test(ua)) return 'windows';
  if (platform.includes('linux') || /x11|linux/i.test(ua)) return 'linux';
  return 'unknown';
}

async function detectMacArch() {
  try {
    const values = await navigator.userAgentData?.getHighEntropyValues?.(['architecture']);
    if (values?.architecture === 'x86') return 'x64';
  } catch {
    // Not available outside Chromium; assume Apple silicon.
  }
  return 'arm64';
}

const os = detectOS();

// Windows and Linux use Alt, Ctrl and Enter where macOS uses ⌥, ⌘ and ↵, as the app does.
if (os === 'windows' || os === 'linux') {
  for (const el of document.querySelectorAll('[data-key-open]')) el.textContent = 'Alt Space';
  for (const el of document.querySelectorAll('[data-key-alt]')) el.textContent = 'Alt';
  for (const el of document.querySelectorAll('[data-key-mod]')) el.textContent = 'Ctrl';
  for (const el of document.querySelectorAll('[data-key-tab]')) el.textContent = 'Tab';
  for (const el of document.querySelectorAll('[data-key-enter]')) el.textContent = 'Enter';
  for (const el of document.querySelectorAll('[data-key-backspace]')) el.textContent = 'Backspace';
  // The note action that shows the file, named for the system's file manager.
  for (const el of document.querySelectorAll('[data-reveal]')) {
    el.textContent = os === 'windows' ? 'Show in Explorer' : 'Show in Folder';
  }
}

// ── Download links ───────────────────────────────────────

// The release is kept for a few minutes, so moving around the page doesn't ask GitHub again, but a new
// release shows up on the next visit after it's out.
const RELEASE_CACHE_MS = 10 * 60 * 1000;

async function latestRelease() {
  const cacheKey = 'waypoint:latest-release';
  try {
    const cached = JSON.parse(sessionStorage.getItem(cacheKey) || 'null');
    if (cached?.at && Date.now() - cached.at < RELEASE_CACHE_MS) return cached;
  } catch {
    // Storage can be blocked; fetch instead.
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const release = await response.json();
    const slim = {
      at: Date.now(),
      tag: release.tag_name,
      assets: (release.assets || []).map((asset) => ({ name: asset.name, url: asset.browser_download_url })),
    };
    try {
      sessionStorage.setItem(cacheKey, JSON.stringify(slim));
    } catch {
      // Fine without the cache.
    }
    return slim;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function link(label, href) {
  const a = document.createElement('a');
  a.href = href;
  a.textContent = label;
  return a;
}

async function setUpDownloads() {
  const [release, macArch] = await Promise.all([latestRelease(), os === 'mac' ? detectMacArch() : 'arm64']);
  const assets = release?.assets || [];
  const find = (pattern) => assets.find((asset) => pattern.test(asset.name))?.url || LATEST;

  const builds = {
    macArm: { label: 'macOS', href: find(/mac-arm64\.dmg$/) },
    macIntel: { label: 'Intel Mac', href: find(/mac-x64\.dmg$/) },
    windows: { label: 'Windows', href: find(/\.exe$/) },
    appImage: { label: 'Linux', href: find(/\.AppImage$/) },
    deb: { label: '.deb', href: find(/\.deb$/) },
  };

  let primary = { label: 'Download', href: LATEST };
  let others = [builds.macArm, builds.windows, builds.appImage];
  if (os === 'mac') {
    const mac = macArch === 'x64' ? builds.macIntel : builds.macArm;
    primary = { label: 'Download for macOS', href: mac.href };
    others = [
      macArch === 'x64' ? { label: 'Apple silicon', href: builds.macArm.href } : builds.macIntel,
      builds.windows,
      builds.appImage,
    ];
  } else if (os === 'windows') {
    primary = { label: 'Download for Windows', href: builds.windows.href };
    others = [builds.macArm, builds.appImage];
  } else if (os === 'linux') {
    primary = { label: 'Download for Linux', href: builds.appImage.href };
    others = [builds.deb, builds.macArm, builds.windows];
  }

  for (const button of document.querySelectorAll('[data-download]')) {
    button.href = primary.href;
    const label = button.querySelector('[data-download-label]');
    if (label) label.textContent = primary.label;
  }

  for (const list of document.querySelectorAll('[data-alt-links]')) {
    list.replaceChildren(...others.map((build) => link(build.label, build.href)), link('All releases', LATEST));
  }

  // `pnpm release` writes the new version into the page, so GitHub's answer only replaces it when it's newer:
  // while a release's installers are still building, GitHub's latest is the one before.
  if (release?.tag) {
    for (const el of document.querySelectorAll('[data-version]')) {
      if (isNewer(release.tag, el.textContent)) el.textContent = release.tag;
    }
  }
}

/** Whether version tag `a` (v1.9.0) comes after `b`. */
function isNewer(a, b) {
  const parts = (tag) => (/(\d+)\.(\d+)\.(\d+)/.exec(tag) || []).slice(1).map(Number);
  const [x, y] = [parts(a), parts(b)];
  if (x.length !== 3) return false;
  if (y.length !== 3) return true;
  for (let i = 0; i < 3; i++) {
    if (x[i] !== y[i]) return x[i] > y[i];
  }
  return false;
}

setUpDownloads();

// ── Hero: ⌥ Space plays the intro again ──────────────────

const stage = document.querySelector('.stage');

function replay() {
  if (!stage || reduceMotion) return;
  stage.classList.remove('is-playing');
  void stage.offsetWidth; // Restart the CSS animations.
  stage.classList.add('is-playing');
}

document.addEventListener('keydown', (event) => {
  if (!event.altKey || event.metaKey || event.ctrlKey || event.code !== 'Space') return;
  event.preventDefault();
  if (window.scrollY > 120) {
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
    setTimeout(replay, 450);
  } else {
    replay();
  }
});

// ── Scroll reveals ───────────────────────────────────────

const revealables = document.querySelectorAll('.reveal, .counter');

if ('IntersectionObserver' in window && !reduceMotion) {
  const revealer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-in');
        revealer.unobserve(entry.target);
      }
    },
    { rootMargin: '0px 0px -10% 0px', threshold: 0.15 },
  );
  for (const el of revealables) revealer.observe(el);
} else {
  for (const el of revealables) el.classList.add('is-in');
}

// ── Section rail: lights the dot of the chapter in view ──

const rail = document.querySelector('.rail');
const chapters = ['find', 'write', 'extend'].map((id) => document.getElementById(id)).filter(Boolean);

if (rail && chapters.length && 'IntersectionObserver' in window) {
  const railLinks = [...rail.querySelectorAll('a')];
  const inView = new Set();
  const spotter = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) inView.add(entry.target.id);
        else inView.delete(entry.target.id);
      }
      const current = chapters.find((chapter) => inView.has(chapter.id));
      rail.classList.toggle('is-on', Boolean(current));
      for (const a of railLinks) {
        if (current && a.hash === `#${current.id}`) a.setAttribute('aria-current', 'true');
        else a.removeAttribute('aria-current');
      }
    },
    { rootMargin: '-45% 0px -45% 0px' },
  );
  for (const chapter of chapters) spotter.observe(chapter);
}
