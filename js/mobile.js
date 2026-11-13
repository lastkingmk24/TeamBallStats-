/* Optional install and offline support. The app still works without either. */
(function () {
  'use strict';
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function (error) {
        console.warn('[TeamBallStats] Offline app registration failed:', error);
      });
    });
  }

  var installPrompt = null;
  var buttons = document.querySelectorAll('.install-app');
  function showButtons(show) {
    buttons.forEach(function (button) { button.hidden = !show; });
  }
  window.addEventListener('beforeinstallprompt', function (event) {
    event.preventDefault();
    installPrompt = event;
    showButtons(true);
  });
  buttons.forEach(function (button) {
    button.addEventListener('click', function () {
      if (!installPrompt) return;
      var prompt = installPrompt;
      installPrompt = null;
      showButtons(false);
      prompt.prompt();
    });
  });
  window.addEventListener('appinstalled', function () {
    installPrompt = null;
    showButtons(false);
  });
})();
