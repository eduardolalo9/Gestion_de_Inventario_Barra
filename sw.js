if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js')
    .then(reg => console.log('SW registrado', reg))
    .catch(err => console.error('Error SW', err));
}
