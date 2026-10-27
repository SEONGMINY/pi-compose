import React from 'react';
import { createRoot } from 'react-dom/client';
import { App, type Bridge } from './App';
import './terminal-workbench.css';
import './ux-overrides.css';
import './orca-workspace.css';
import './login-v2.css';

declare global { interface Window { compose: Bridge; } }

// Desktop-only composition root. App itself depends only on the Bridge interface.
createRoot(document.getElementById('root')!).render(<App bridge={window.compose} />);
