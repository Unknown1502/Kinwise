import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

// Never let a stray promise rejection surface as an uncaught error in the demo.
window.addEventListener('unhandledrejection', (e) => {
  console.warn('[echo-sim] unhandled rejection', e.reason);
  e.preventDefault();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
