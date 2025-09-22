(function () {
  // Format numeric input with dot as thousands separator while typing
  function formatNumber(n) {
    if (n === null || n === undefined) return '';
    const s = String(n).replace(/\D/g, '');
    if (s.length === 0) return '';
    return s.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }

  function attachMoney(el) {
    if (!el) return;
    // store raw value separately if needed
    function updateDisplay() {
      const raw = (el.value || '').replace(/\D/g, '');
      el.value = formatNumber(raw);
    }
    el.addEventListener('input', (e) => {
      const caret = el.selectionStart || el.value.length;
      const raw = (el.value || '').replace(/\D/g, '');
      const formatted = formatNumber(raw);
      el.value = formatted;
      // move caret to end (simple caret handling)
      try {
        el.selectionStart = el.selectionEnd = el.value.length;
      } catch (e) {}
    });
    el.addEventListener('blur', () => {
      updateDisplay();
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    const els = document.querySelectorAll('[data-money]');
    els.forEach(attachMoney);
    // strip formatting before form submit for any parent form
    const forms = new Set();
    els.forEach((el) => {
      const f = el.closest('form');
      if (f) forms.add(f);
    });
    forms.forEach((f) => {
      f.addEventListener('submit', () => {
        const mm = f.querySelectorAll('[data-money]');
        mm.forEach((i) => {
          i.value = (i.value || '').replace(/\./g, '');
        });
      });
    });
  });
})();
