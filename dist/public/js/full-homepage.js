// full-homepage.js
var track = document.querySelector(".carousel-track");
var slides = Array.from(document.querySelectorAll(".slide"));
var prevBtn = document.querySelector(".carousel-control.prev");
var nextBtn = document.querySelector(".carousel-control.next");
var dotsContainer = document.querySelector(".carousel-dots");
var progressBar = document.querySelector(".carousel-progress .bar");
var currentIndex = 0;
var autoTimer;
var INTERVAL = 5e3;
var fadeMode = true;
var paused = false;
function buildDots() {
  slides.forEach((_, i) => {
    const b = document.createElement("button");
    b.setAttribute("aria-label", "Chuy\u1EC3n t\u1EDBi slide " + (i + 1));
    b.setAttribute("role", "tab");
    b.setAttribute("tabindex", i === 0 ? "0" : "-1");
    if (i === 0) b.classList.add("active");
    b.addEventListener("click", () => goToSlide(i, true));
    dotsContainer.appendChild(b);
  });
}
function updateDots() {
  [...dotsContainer.children].forEach((d, i) => {
    d.classList.toggle("active", i === currentIndex);
    d.setAttribute("tabindex", i === currentIndex ? "0" : "-1");
  });
}
function goToSlide(index, manual = false) {
  if (index < 0) index = slides.length - 1;
  if (index >= slides.length) index = 0;
  currentIndex = index;
  if (fadeMode) {
    slides.forEach((sl, i) => sl.classList.toggle("active", i === currentIndex));
  } else {
    const offset = -index * 100;
    track.style.transform = `translateX(${offset}%)`;
  }
  updateDots();
  restartProgress();
  if (manual) {
    resetAuto();
  }
  announceSlide();
}
function next() {
  goToSlide(currentIndex + 1);
}
function prev() {
  goToSlide(currentIndex - 1);
}
function startAuto() {
  clearInterval(autoTimer);
  autoTimer = setInterval(() => {
    if (!paused) next();
  }, INTERVAL);
  restartProgress();
}
function resetAuto() {
  startAuto();
}
function restartProgress() {
  if (!progressBar) return;
  progressBar.style.transition = "none";
  progressBar.style.width = "0%";
  void progressBar.offsetWidth;
  progressBar.style.transition = `width ${INTERVAL}ms linear`;
  requestAnimationFrame(() => {
    progressBar.style.width = "100%";
  });
}
function pauseCarousel(temp = false) {
  paused = true;
  if (temp) {
    progressBar?.style.setProperty("animation-play-state", "paused");
  }
}
function resumeCarousel() {
  paused = false;
}
function announceSlide() {
  const region = document.querySelector("[data-carousel]");
  if (!region) return;
  region.setAttribute("aria-live", "polite");
  region.dataset.current = currentIndex + 1;
}
if (slides.length) {
  const hasActive = slides.some((sl) => sl.classList.contains("active"));
  if (!hasActive) {
    slides[0].classList.add("active");
    currentIndex = 0;
  } else {
    currentIndex = slides.findIndex((sl) => sl.classList.contains("active"));
  }
}
slides.forEach((sl) => {
  const bg = sl.getAttribute("style");
  if (bg && /url\('(.*?)'\)/.test(bg)) {
    const src = bg.match(/url\('(.*?)'\)/)[1];
    const img = new Image();
    img.onload = () => {
    };
    img.onerror = () => {
      console.warn("Kh\xF4ng t\u1EA3i \u0111\u01B0\u1EE3c \u1EA3nh banner:", src);
      sl.classList.add("bg-error");
    };
    img.src = src;
  }
});
buildDots();
var carouselRoot = document.querySelector(".carousel");
carouselRoot?.classList.add("fade");
carouselRoot?.setAttribute("role", "region");
carouselRoot?.setAttribute("aria-label", "Tr\xECnh chi\u1EBFu n\u1ED9i dung n\u1ED5i b\u1EADt");
startAuto();
nextBtn?.addEventListener("click", () => next());
prevBtn?.addEventListener("click", () => prev());
carouselRoot?.addEventListener("mouseenter", () => pauseCarousel(true));
carouselRoot?.addEventListener("mouseleave", () => resumeCarousel());
carouselRoot?.addEventListener("focusin", () => pauseCarousel(true));
carouselRoot?.addEventListener("focusout", () => resumeCarousel());
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    pauseCarousel();
  } else {
    resumeCarousel();
  }
});
var touchStartX = 0;
var touchDeltaX = 0;
var SWIPE_THRESHOLD = 40;
carouselRoot?.addEventListener("touchstart", (e) => {
  if (e.touches.length !== 1) return;
  touchStartX = e.touches[0].clientX;
  touchDeltaX = 0;
  pauseCarousel(true);
}, { passive: true });
carouselRoot?.addEventListener("touchmove", (e) => {
  if (e.touches.length !== 1) return;
  touchDeltaX = e.touches[0].clientX - touchStartX;
}, { passive: true });
carouselRoot?.addEventListener("touchend", () => {
  if (Math.abs(touchDeltaX) > SWIPE_THRESHOLD) {
    if (touchDeltaX < 0) next();
    else prev();
  }
  resumeCarousel();
});
var tabButtons = document.querySelectorAll(".tab");
var panels = document.querySelectorAll(".panel");
tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const target = btn.dataset.tab;
    tabButtons.forEach((b) => {
      b.classList.toggle("active", b === btn);
      b.setAttribute("aria-selected", b === btn);
    });
    panels.forEach((p) => p.classList.toggle("active", p.dataset.panel === target));
  });
});
var searchBtn = document.querySelector(".search-btn");
var searchOverlay = document.querySelector(".search-overlay");
var closeSearch = document.querySelector(".close-search");
if (searchBtn) {
  searchBtn.addEventListener("click", () => {
    searchOverlay.hidden = false;
    const input = searchOverlay.querySelector("input");
    setTimeout(() => input.focus(), 50);
  });
}
if (closeSearch) {
  closeSearch.addEventListener("click", () => {
    searchOverlay.hidden = true;
  });
}
searchOverlay?.addEventListener("click", (e) => {
  if (e.target === searchOverlay) {
    searchOverlay.hidden = true;
  }
});
var hamburger = document.querySelector(".hamburger");
var primaryNav = document.querySelector(".primary-nav");
if (hamburger) {
  hamburger.addEventListener("click", () => {
    const expanded = hamburger.getAttribute("aria-expanded") === "true";
    hamburger.setAttribute("aria-expanded", String(!expanded));
    primaryNav.classList.toggle("open");
  });
}
function isMobile() {
  return window.matchMedia("(max-width:960px)").matches;
}
primaryNav?.querySelectorAll("li.has-mega > a").forEach((anchor) => {
  anchor.addEventListener("click", (e) => {
    if (!isMobile()) return;
    e.preventDefault();
    const li = anchor.parentElement;
    const open = li.classList.contains("open");
    primaryNav.querySelectorAll("li.has-mega").forEach((x) => x.classList.remove("open"));
    if (!open) li.classList.add("open");
  });
});
var backTop = document.querySelector(".back-to-top");
window.addEventListener("scroll", () => {
  if (window.scrollY > 500) {
    backTop.hidden = false;
  } else {
    backTop.hidden = true;
  }
});
backTop?.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
track?.addEventListener("keydown", (e) => {
  if (e.key === "ArrowRight") {
    next();
  }
  if (e.key === "ArrowLeft") {
    prev();
  }
});
slides.forEach((sl) => sl.setAttribute("tabindex", "0"));
function applyResponsiveBannerImages() {
  const isSmall = window.matchMedia("(max-width:600px)").matches;
  slides.forEach((sl) => {
    const desk = sl.dataset.bgDesktop;
    const mob = sl.dataset.bgMobile;
    let target = desk;
    if (isSmall && mob) {
      const img = new Image();
      img.onload = () => {
        sl.style.setProperty("--bg", `url('${mob}')`);
      };
      img.onerror = () => {
        if (!sl.__warnedMissingMobile) {
          console.warn("[banner] Mobile image missing, fallback to desktop:", mob);
          sl.__warnedMissingMobile = true;
        }
        sl.style.setProperty("--bg", `url('${desk}')`);
      };
      img.src = mob;
      return;
    }
    if (target) {
      sl.style.setProperty("--bg", `url('${target}')`);
    }
  });
}
applyResponsiveBannerImages();
window.addEventListener("resize", () => {
  clearTimeout(window.__bannerSwapTimer);
  window.__bannerSwapTimer = setTimeout(applyResponsiveBannerImages, 120);
});
document.querySelectorAll('.quick-menu .quick-link[href^="#"]').forEach((a) => {
  a.addEventListener("click", (e) => {
    const id = a.getAttribute("href");
    if (!id || id === "#") return;
    const el = document.querySelector(id);
    if (el) {
      e.preventDefault();
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
});
(function() {
  const order = ["default", "theme-dark", "theme-alt"];
  let idx = 0;
  const btn = document.querySelector("[data-theme-toggle]");
  if (!btn) return;
  function apply() {
    const root = document.documentElement;
    order.forEach((c) => {
      if (c !== "default") root.classList.remove(c);
    });
    const next2 = order[idx];
    if (next2 !== "default") root.classList.add(next2);
    btn.textContent = next2 === "default" ? "Theme: Default" : next2 === "theme-dark" ? "Theme: Dark" : "Theme: Alt";
  }
  btn.addEventListener("click", () => {
    idx = (idx + 1) % order.length;
    apply();
  });
  apply();
})();
//# sourceMappingURL=full-homepage.js.map
