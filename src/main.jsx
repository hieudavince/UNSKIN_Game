import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

const root = ReactDOM.createRoot(document.getElementById('root'));
const route = import.meta.env.DEV ? new URLSearchParams(window.location.search).get('preview') : null;

if (route) {
  // DEV-only screenshot/preview routes (stripped from production builds).
  import('./devPreview').then(({ default: DevPreview }) => {
    root.render(<DevPreview route={route} />);
  });
} else {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
