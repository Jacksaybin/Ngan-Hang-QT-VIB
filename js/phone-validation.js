/*
 Self-managed phone validator
 - DOES NOT rely on HTML5 `pattern`/`required` attributes
 - Manages exactly two states for each field: `isValid` (boolean) and `errorMsg` (string)
 - Clears `errorMsg` immediately when the value becomes valid
 - Exposes `attachPhoneField(inputEl, opts)` for reuse
*/
(function () {
  function normalizeDigits(value) {
    return (value || '').match(/\d/g)?.join('') || '';
  }

  function validatePhoneDigits(digits) {
    if (!digits) return { isValid: false, errorMsg: '' };
    if (!/^(0\d{9}|84\d{9})$/.test(digits)) {
      if (digits.length < 10)
        return { isValid: false, errorMsg: 'Số điện thoại quá ngắn. Vui lòng nhập đủ chữ số.' };
      if (digits.length > 11)
        return { isValid: false, errorMsg: 'Số điện thoại quá dài. Vui lòng kiểm tra lại.' };
      return { isValid: false, errorMsg: 'Số điện thoại không đúng định dạng.' };
    }
    return { isValid: true, errorMsg: '' };
  }

  function attachPhoneField(phoneEl, opts = {}) {
    if (!phoneEl) return null;
    const fb = phoneEl.nextElementSibling; // expected to show errorMsg
    const state = { isValid: false, errorMsg: '' };

    function applyState() {
      if (state.isValid) {
        phoneEl.classList.remove('is-invalid');
        phoneEl.classList.add('is-valid');
        phoneEl.removeAttribute('aria-invalid');
        // If the form was previously validated (Bootstrap .was-validated),
        // clear it so the fixed field doesn't still show invalid markup.
        const frm = phoneEl.closest('form');
        if (frm && frm.classList.contains('was-validated')) {
          frm.classList.remove('was-validated');
        }
      } else {
        phoneEl.classList.remove('is-valid');
        if (state.errorMsg) {
          phoneEl.classList.add('is-invalid');
          phoneEl.setAttribute('aria-invalid', 'true');
        } else {
          phoneEl.classList.remove('is-invalid');
          phoneEl.removeAttribute('aria-invalid');
        }
      }
      if (fb) fb.textContent = state.errorMsg || '';
    }

    function setState(isValid, errorMsg) {
      state.isValid = !!isValid;
      state.errorMsg = errorMsg || '';
      applyState();
    }

    // sanitize input to digits only while typing
    phoneEl.addEventListener('input', () => {
      const raw = phoneEl.value || '';
      const digits = normalizeDigits(raw);
      if (raw !== digits) phoneEl.value = digits;

      // validate live
      const res = validatePhoneDigits(digits);
      // Clear errorMsg immediately when valid
      if (res.isValid) setState(true, '');
      else setState(false, res.errorMsg);
    });

    // On blur do a final validation (same logic)
    phoneEl.addEventListener('blur', () => {
      const digits = normalizeDigits(phoneEl.value || '');
      const res = validatePhoneDigits(digits);
      setState(res.isValid, res.errorMsg);
    });

    // prevent form submit when invalid
    const form = phoneEl.closest('form');
    if (form) {
      form.addEventListener('submit', (e) => {
        const digits = normalizeDigits(phoneEl.value || '');
        const res = validatePhoneDigits(digits);
        setState(res.isValid, res.errorMsg);
        if (!res.isValid) {
          e.preventDefault();
          e.stopPropagation();
          phoneEl.focus();
        }
      });
    }

    // return API for tests/other code
    // apply initial state to clear any pre-existing UI
    applyState();

    return {
      el: phoneEl,
      getState: () => ({ ...state }),
      setError: (msg) => setState(false, msg),
      clear: () => setState(false, ''),
    };
  }

  // Auto-attach for elements with id="phone"
  function attachAllPhoneFields() {
    try {
      const els = document.querySelectorAll('#phone');
      els.forEach((el) => {
        try {
          const api = attachPhoneField(el);
          // expose validator API on element for external checks
          if (api) el._phoneValidator = api;
        } catch (err) {
          /* continue */
        }
      });
    } catch (e) {
      console.error('phone-validation attach error', e);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attachAllPhoneFields);
  } else {
    // already loaded
    attachAllPhoneFields();
  }

  // expose to global
  window.attachPhoneField = attachPhoneField;
})();
