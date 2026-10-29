(function () {
  // Menu mobile
  document.addEventListener('click', function (e) {
    if (e.target.closest('[data-menu-toggle]')) document.body.classList.toggle('nav-open');
    else if (e.target.closest('.backdrop')) document.body.classList.remove('nav-open');
  });

  // Thème clair / sombre
  var toggle = document.querySelector('[data-theme-toggle]');
  function currentTheme() {
    var forced = document.documentElement.getAttribute('data-theme');
    if (forced) return forced;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function paintToggle() {
    if (toggle) toggle.textContent = currentTheme() === 'dark' ? '☀️' : '🌙';
  }
  if (toggle) {
    paintToggle();
    toggle.addEventListener('click', function () {
      var next = currentTheme() === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try {
        localStorage.setItem('bobcat-theme', next);
      } catch (e) {
        /* stockage indisponible */
      }
      paintToggle();
      document.dispatchEvent(new CustomEvent('themechange'));
    });
  }

  // Confirmation avant les actions destructives
  document.addEventListener('submit', function (e) {
    var form = e.target;
    var submitter = e.submitter;
    var message = (submitter && submitter.getAttribute('data-confirm')) || form.getAttribute('data-confirm');
    if (message && !window.confirm(message)) e.preventDefault();
  });

  // Rafraîchissement automatique d'un bloc (ex. tableau des temps)
  document.querySelectorAll('[data-autorefresh]').forEach(function (el) {
    var url = el.getAttribute('data-autorefresh');
    var every = Number(el.getAttribute('data-interval') || 30000);
    setInterval(function () {
      if (document.hidden) return;
      el.style.opacity = '0.7';
      fetch(url, { credentials: 'same-origin' })
        .then(function (r) {
          return r.ok ? r.text() : Promise.reject(r.status);
        })
        .then(function (html) {
          el.innerHTML = html;
        })
        .catch(function () {})
        .finally(function () {
          el.style.opacity = '';
        });
    }, every);
  });

  // Champ "véhicule personnalisé" affiché seulement si nécessaire
  document.querySelectorAll('[data-show-when]').forEach(function (el) {
    var parts = el.getAttribute('data-show-when').split('=');
    var source = document.querySelector('[name="' + parts[0] + '"]');
    if (!source) return;
    function sync() {
      el.hidden = source.value !== parts[1];
    }
    source.addEventListener('change', sync);
    sync();
  });
})();
