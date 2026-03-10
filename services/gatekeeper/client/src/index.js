import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App.jsx';
import { BrowserRouter } from "react-router-dom";

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
    React.createElement(
        React.StrictMode,
        null,
        React.createElement(
            BrowserRouter,
            null,
            React.createElement(App)
        )
    )
);
