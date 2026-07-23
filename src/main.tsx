import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root missing from index.html');

// StrictMode double-mounts effects in dev. The engine is built to survive it —
// every listener hangs off one AbortController and the WebGL context is
// disposed on teardown — so leave it on rather than papering over the churn.
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
