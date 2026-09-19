import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Latin subsets only: the game's copy is all ASCII, and the full @fontsource entry points ship a
// dozen scripts (devanagari, cyrillic…) that would blow the iframe's transfer budget.
import '@fontsource/poppins/latin-500.css';
import '@fontsource/poppins/latin-700.css';
import '@fontsource/poppins/latin-700-italic.css';
import '@fontsource/poppins/latin-800.css';
import '@fontsource/poppins/latin-800-italic.css';
import '@fontsource/rubik/latin-400.css';
import '@fontsource/rubik/latin-500.css';

import { App } from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
