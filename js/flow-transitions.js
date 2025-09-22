// Lightweight page transition helper
(function () {
  const DURATION = 360; // ms
  let popstateInstalled = false;

  function supportsMotion() {
    try {
      return window.matchMedia && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (e) {
      return true;
    }
  }

  // Create or return overlay element; it contains a spinner element
  function ensureOverlay() {
    let overlay = document.querySelector('.ft-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'ft-overlay';
      const spinner = document.createElement('div');
      spinner.className = 'ft-spinner';
      overlay.appendChild(spinner);
      document.body.appendChild(overlay);
      // force style recompute
      void overlay.offsetHeight;
    }
    return overlay;
  }

  // Try to prefetch the target URL (GET). Return { ok, text }.
  async function prefetchUrl(url) {
    try {
      const res = await fetch(url, { method: 'GET', credentials: 'same-origin' });
      const text = await res.text().catch(() => null);
      return { ok: !!(res && res.ok), text };
    } catch (e) {
      return { ok: false, text: null };
    }
  }

  async function animateNavigate(targetHref) {
    if (!supportsMotion()) {
      window.location.href = targetHref;
      return;
    }

    const root = document.documentElement;
    root.classList.add('ft-leave');

    const overlay = ensureOverlay();
    overlay.classList.add('show');

    // Attempt to prefetch HTML
    const prefetchPromise = prefetchUrl(targetHref);
    // Wait up to a short grace window for prefetch to complete
    const graceMs = Math.max(DURATION, 300);
    let prefetch = { ok: false, text: null };
    try {
      prefetch = await Promise.race([
        prefetchPromise,
        new Promise((r) => setTimeout(() => r({ ok: false, text: null }), graceMs)),
      ]);
    } catch (e) {
      prefetch = { ok: false, text: null };
    }

    // Allow animation to finish
    await new Promise((r) => setTimeout(r, 40));

    // If prefetch returned HTML that contains a <main>, perform in-place swap (PJAX-like)
    if (prefetch && prefetch.ok && prefetch.text && typeof document !== 'undefined') {
      try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(prefetch.text, 'text/html');
        const newMain = doc.querySelector('main');
        const curMain = document.querySelector('main');
        const newTitle = doc.querySelector('title') ? doc.querySelector('title').textContent : null;

        if (newMain && curMain) {
          // Replace main content
          curMain.innerHTML = newMain.innerHTML;

          // Update title if present
          if (newTitle) document.title = newTitle;

          // Execute inline scripts from the new main
          const scripts = Array.from(newMain.querySelectorAll('script'));
          scripts.forEach((s) => {
            if (!s.src) {
              try {
                const inline = document.createElement('script');
                inline.text = s.textContent || s.innerText || '';
                document.body.appendChild(inline);
                // remove immediately to avoid duplication
                document.body.removeChild(inline);
              } catch (e) {
                // ignore script execution errors
              }
            } else {
              // For external scripts, append to body to ensure they load (best-effort)
              const ext = document.createElement('script');
              ext.src = s.src;
              ext.async = false;
              document.body.appendChild(ext);
            }
          });

          // Push state so back/forward works
          try {
            history.pushState(
              { pjax: true, url: targetHref },
              newTitle || document.title,
              targetHref
            );
          } catch (e) {
            // ignore
          }

          // Dispatch custom event so other scripts can re-initialize
          try {
            window.dispatchEvent(new CustomEvent('pjax:load', { detail: { url: targetHref } }));
          } catch (e) {}

          // Hide overlay and remove leave class
          overlay.classList.remove('show');
          root.classList.remove('ft-leave');
          return;
        }
      } catch (e) {
        // fallback to full navigation
      }
    }

    // Hide overlay (keeps a small fade out), then navigate full page
    overlay.classList.remove('show');
    root.classList.remove('ft-leave');
    window.location.href = targetHref;
  }

  // Handle popstate to re-fetch content when navigating back/forward
  function ensurePopstate() {
    if (popstateInstalled) return;
    popstateInstalled = true;
    window.addEventListener('popstate', async (ev) => {
      if (ev.state && ev.state.pjax && ev.state.url) {
        const url = ev.state.url;
        const pref = await prefetchUrl(url);
        if (pref && pref.ok && pref.text) {
          try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(pref.text, 'text/html');
            const newMain = doc.querySelector('main');
            const curMain = document.querySelector('main');
            const newTitle = doc.querySelector('title')
              ? doc.querySelector('title').textContent
              : null;
            if (newMain && curMain) {
              curMain.innerHTML = newMain.innerHTML;
              if (newTitle) document.title = newTitle;
              window.dispatchEvent(new CustomEvent('pjax:load', { detail: { url } }));
              return;
            }
          } catch (e) {
            // fallthrough to reload
          }
        }
        window.location.href = url;
      }
    });
  }

  // Expose helper globally
  window.flowNavigate = animateNavigate;

  // Ensure popstate handler is installed
  ensurePopstate();

  // On page load, play enter animation
  document.addEventListener('DOMContentLoaded', () => {
    const root = document.documentElement;
    if (!supportsMotion()) return;
    root.classList.add('ft-enter');
    // force style recalc
    void root.offsetHeight;
    root.classList.add('ft-visible');
    // cleanup enter class after animation
    setTimeout(() => {
      root.classList.remove('ft-enter');
    }, DURATION + 30);
  });
})();
