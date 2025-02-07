import React from "react";
import ReactDOM from "react-dom/client";
import BrowserContent from "./BrowserContent";
import ContextProviders from "../shared/contexts/ContextProviders";
import "../shared/extension.css";

const BrowserUI = () => {
    return (
        <ContextProviders isBrowser>
            <BrowserContent />
        </ContextProviders>
    );
};

const rootElement = document.createElement("div");
document.body.appendChild(rootElement);
const root = ReactDOM.createRoot(rootElement);
root.render(<BrowserUI />);
