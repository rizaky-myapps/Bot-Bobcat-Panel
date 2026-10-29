// Appliqué dans <head> pour éviter un flash de thème.
(function () {
  try {
    var theme = localStorage.getItem('bobcat-theme');
    if (theme === 'light' || theme === 'dark') document.documentElement.setAttribute('data-theme', theme);
  } catch (e) {
    /* stockage indisponible */
  }
})();
