import React from "react";
import ReactDOM from "react-dom/client";
import ContextProviders from "../shared/contexts/ContextProviders";
import PopupContent from "./PopupContent";
import "../shared/extension.css";

const PopupUI = () => {
    return (
        <ContextProviders isBrowser={false}>
            <PopupContent />
        </ContextProviders>
    );
};

const rootElement = document.createElement("div");
rootElement.className = "popup-div";
document.body.appendChild(rootElement);
const root = ReactDOM.createRoot(rootElement);
root.render(<PopupUI />);
