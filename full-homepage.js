// ====== CAROUSEL ======
const track = document.querySelector('.carousel-track');
const slides = Array.from(document.querySelectorAll('.slide'));
const prevBtn = document.querySelector('.carousel-control.prev');
const nextBtn = document.querySelector('.carousel-control.next');
const dotsContainer = document.querySelector('.carousel-dots');
const progressBar = document.querySelector('.carousel-progress .bar');
let currentIndex = 0;
let autoTimer; let progressTimer; const INTERVAL = 5000; let fadeMode = true; // bật fade
let paused = false;

function buildDots() {
    slides.forEach((_, i) => {
        const b = document.createElement('button');
        b.setAttribute('aria-label', 'Chuyển tới slide ' + (i + 1));
        b.setAttribute('role', 'tab');
        b.setAttribute('tabindex', i === 0 ? '0' : '-1');
        if (i === 0) b.classList.add('active');
        b.addEventListener('click', () => goToSlide(i, true));
        dotsContainer.appendChild(b);
    })
}

function updateDots() {
    [...dotsContainer.children].forEach((d, i) => {
        d.classList.toggle('active', i === currentIndex);
        d.setAttribute('tabindex', i === currentIndex ? '0' : '-1');
    });
}

function goToSlide(index, manual = false) {
    if (index < 0) index = slides.length - 1;
    if (index >= slides.length) index = 0;
    currentIndex = index;
    if (fadeMode) {
        slides.forEach((sl, i) => sl.classList.toggle('active', i === currentIndex));
    } else {
        const offset = -index * 100;
        track.style.transform = `translateX(${offset}%)`;
    }
    updateDots();
    restartProgress();
    if (manual) { resetAuto(); }
    announceSlide();
}

function next() { goToSlide(currentIndex + 1); }
function prev() { goToSlide(currentIndex - 1); }
function startAuto() { clearInterval(autoTimer); autoTimer = setInterval(() => { if (!paused) next(); }, INTERVAL); restartProgress(); }
function resetAuto() { startAuto(); }
function restartProgress() { if (!progressBar) return; progressBar.style.transition = 'none'; progressBar.style.width = '0%'; void progressBar.offsetWidth; progressBar.style.transition = `width ${INTERVAL}ms linear`; requestAnimationFrame(() => { progressBar.style.width = '100%'; }); }

function pauseCarousel(temp = false) { paused = true; if (temp) { progressBar?.style.setProperty('animation-play-state', 'paused'); } }
function resumeCarousel() { paused = false; }

function announceSlide() { const region = document.querySelector('[data-carousel]'); if (!region) return; region.setAttribute('aria-live', 'polite'); region.dataset.current = currentIndex + 1; }

// Defensive: đảm bảo luôn có 1 slide active nếu vì lý do nào đó markup thiếu
if (slides.length) {
    const hasActive = slides.some(sl => sl.classList.contains('active'));
    if (!hasActive) {
        slides[0].classList.add('active');
        currentIndex = 0;
    } else {
        currentIndex = slides.findIndex(sl => sl.classList.contains('active'));
    }
}

// Gắn fallback nếu ảnh không tải được (thêm lớp để kiểm tra bằng CSS hoặc log)
slides.forEach(sl => {
    const bg = sl.getAttribute('style');
    if (bg && /url\('(.*?)'\)/.test(bg)) {
        const src = bg.match(/url\('(.*?)'\)/)[1];
        const img = new Image();
        img.onload = () => { /* ok */ };
        img.onerror = () => { console.warn('Không tải được ảnh banner:', src); sl.classList.add('bg-error'); };
        img.src = src;
    }
});

buildDots();
// Thêm class fade vào carousel nếu muốn
const carouselRoot = document.querySelector('.carousel');
carouselRoot?.classList.add('fade');
// ARIA roles
carouselRoot?.setAttribute('role', 'region');
carouselRoot?.setAttribute('aria-label', 'Trình chiếu nội dung nổi bật');
startAuto();

nextBtn?.addEventListener('click', () => next());
prevBtn?.addEventListener('click', () => prev());

// Pause/resume on hover & focus within
carouselRoot?.addEventListener('mouseenter', () => pauseCarousel(true));
carouselRoot?.addEventListener('mouseleave', () => resumeCarousel());
carouselRoot?.addEventListener('focusin', () => pauseCarousel(true));
carouselRoot?.addEventListener('focusout', () => resumeCarousel());

document.addEventListener('visibilitychange', () => { if (document.hidden) { pauseCarousel(); } else { resumeCarousel(); } });

// Touch swipe support
let touchStartX = 0; let touchDeltaX = 0; const SWIPE_THRESHOLD = 40;
carouselRoot?.addEventListener('touchstart', e => { if (e.touches.length !== 1) return; touchStartX = e.touches[0].clientX; touchDeltaX = 0; pauseCarousel(true); }, { passive: true });
carouselRoot?.addEventListener('touchmove', e => { if (e.touches.length !== 1) return; touchDeltaX = e.touches[0].clientX - touchStartX; }, { passive: true });
carouselRoot?.addEventListener('touchend', () => { if (Math.abs(touchDeltaX) > SWIPE_THRESHOLD) { if (touchDeltaX < 0) next(); else prev(); } resumeCarousel(); });

// ====== TABS ======
const tabButtons = document.querySelectorAll('.tab');
const panels = document.querySelectorAll('.panel');

tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        const target = btn.dataset.tab;
        tabButtons.forEach(b => { b.classList.toggle('active', b === btn); b.setAttribute('aria-selected', b === btn); });
        panels.forEach(p => p.classList.toggle('active', p.dataset.panel === target));
    });
});

// ====== SEARCH OVERLAY ======
const searchBtn = document.querySelector('.search-btn');
const searchOverlay = document.querySelector('.search-overlay');
const closeSearch = document.querySelector('.close-search');

if (searchBtn) {
    searchBtn.addEventListener('click', () => {
        searchOverlay.hidden = false;
        const input = searchOverlay.querySelector('input');
        setTimeout(() => input.focus(), 50);
    });
}
if (closeSearch) {
    closeSearch.addEventListener('click', () => { searchOverlay.hidden = true; });
}
searchOverlay?.addEventListener('click', e => { if (e.target === searchOverlay) { searchOverlay.hidden = true; } });

// ====== MOBILE MENU ======
const hamburger = document.querySelector('.hamburger');
const primaryNav = document.querySelector('.primary-nav');
if (hamburger) {
    hamburger.addEventListener('click', () => {
        const expanded = hamburger.getAttribute('aria-expanded') === 'true';
        hamburger.setAttribute('aria-expanded', String(!expanded));
        primaryNav.classList.toggle('open');
    });
}

// Mega menu mobile toggle
function isMobile() { return window.matchMedia('(max-width:960px)').matches; }
primaryNav?.querySelectorAll('li.has-mega > a').forEach(anchor => {
    anchor.addEventListener('click', (e) => {
        if (!isMobile()) return; // desktop dùng hover
        e.preventDefault();
        const li = anchor.parentElement;
        const open = li.classList.contains('open');
        primaryNav.querySelectorAll('li.has-mega').forEach(x => x.classList.remove('open'));
        if (!open) li.classList.add('open');
    });
});

// ====== BACK TO TOP ======
const backTop = document.querySelector('.back-to-top');
window.addEventListener('scroll', () => {
    if (window.scrollY > 500) { backTop.hidden = false; } else { backTop.hidden = true; }
});
backTop?.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

// Keyboard nav for carousel
track?.addEventListener('keydown', e => { if (e.key === 'ArrowRight') { next(); } if (e.key === 'ArrowLeft') { prev(); } });
slides.forEach(sl => sl.setAttribute('tabindex', '0'));

// ====== RESPONSIVE BANNER BACKGROUNDS (Mobile/Desktop swap) ======
function applyResponsiveBannerImages() {
    const isSmall = window.matchMedia('(max-width:600px)').matches;
    slides.forEach(sl => {
        const desk = sl.dataset.bgDesktop;
        const mob = sl.dataset.bgMobile;
        let target = desk;
        if (isSmall && mob) {
            // Preload mobile image to ensure it exists before swapping
            const img = new Image();
            img.onload = () => {
                sl.style.setProperty('--bg', `url('${mob}')`);
            };
            img.onerror = () => {
                if (!sl.__warnedMissingMobile) {
                    console.warn('[banner] Mobile image missing, fallback to desktop:', mob);
                    sl.__warnedMissingMobile = true;
                }
                sl.style.setProperty('--bg', `url('${desk}')`);
            };
            img.src = mob;
            return; // will set asynchronously
        }
        if (target) {
            sl.style.setProperty('--bg', `url('${target}')`);
        }
    });
}
applyResponsiveBannerImages();
window.addEventListener('resize', () => {
    // debounce nhẹ
    clearTimeout(window.__bannerSwapTimer);
    window.__bannerSwapTimer = setTimeout(applyResponsiveBannerImages, 120);
});

// ====== QUICK MENU Smooth scroll ======
document.querySelectorAll('.quick-menu .quick-link[href^="#"]').forEach(a => {
    a.addEventListener('click', e => {
        const id = a.getAttribute('href');
        if (!id || id === '#') return;
        const el = document.querySelector(id);
        if (el) {
            e.preventDefault();
            el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    });
});

// THEME TOGGLE
(function () {
    const order = ['default', 'theme-dark', 'theme-alt'];
    let idx = 0;
    const btn = document.querySelector('[data-theme-toggle]');
    if (!btn) return;
    function apply() {
        const root = document.documentElement; // we add class to <html>
        order.forEach(c => { if (c !== 'default') root.classList.remove(c); });
        const next = order[idx];
        if (next !== 'default') root.classList.add(next);
        btn.textContent = next === 'default' ? 'Theme: Default' : (next === 'theme-dark' ? 'Theme: Dark' : 'Theme: Alt');
    }
    btn.addEventListener('click', () => { idx = (idx + 1) % order.length; apply(); });
    apply();
})();
