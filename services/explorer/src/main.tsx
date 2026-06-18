import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.js';
import { BrowserRouter } from 'react-router-dom';
import { ContextProviders } from './contexts/ContextProviders.js';
import './static/index.css';

const rootElement = document.getElementById('root') as HTMLElement;
const root = ReactDOM.createRoot(rootElement);

root.render(
    <React.StrictMode>
        <BrowserRouter>
            <ContextProviders>
                <App />
            </ContextProviders>
        </BrowserRouter>
    </React.StrictMode>
);
