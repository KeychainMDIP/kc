import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserProvider } from "./BrowserContext";
import BrowserContent from "./BrowserContent";

const BrowserUI = () => {
    return (
        <BrowserProvider>
            <BrowserContent />
        </BrowserProvider>
    );
};

const rootElement = document.createElement("div");
document.body.appendChild(rootElement);
const root = ReactDOM.createRoot(rootElement);
root.render(<BrowserUI />);
