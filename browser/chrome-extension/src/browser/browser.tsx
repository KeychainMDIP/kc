import React from "react";
import ReactDOM from "react-dom/client";
import BrowserContent from "./BrowserContent";
import { UIProvider } from "../shared/UIContext";
import "./browser.css";

const BrowserUI = () => {
    return (
        <UIProvider>
            <BrowserContent />
        </UIProvider>
    );
};

const rootElement = document.createElement("div");
document.body.appendChild(rootElement);
const root = ReactDOM.createRoot(rootElement);
root.render(<BrowserUI />);
