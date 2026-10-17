// three.js r128 is loaded from the CDN (keeps the main bundle small). If the
// CDN is unreachable we fall back to the bundled copy from node_modules.
let pending = null;

function fromCdn() {
  return new Promise((resolve, reject) => {
    const finish = () => (window.THREE ? resolve(window.THREE) : reject(new Error('Three.js failed to load')));
    let script = document.getElementById('three-r128');
    if (!script) {
      script = document.createElement('script');
      script.id = 'three-r128';
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
      script.async = true;
      script.onload = finish;
      script.onerror = () => reject(new Error('Three.js failed to load'));
      document.head.appendChild(script);
      return;
    }
    script.addEventListener('load', finish);
    script.addEventListener('error', () => reject(new Error('Three.js failed to load')));
  });
}

export function loadThree() {
  if (window.THREE) return Promise.resolve(window.THREE);
  if (!pending) {
    pending = fromCdn()
      .catch(() => import('three').then((mod) => {
        const THREE = { ...mod };
        window.THREE = THREE;
        return THREE;
      }))
      .catch((error) => {
        pending = null;
        throw error;
      });
  }
  return pending;
}
