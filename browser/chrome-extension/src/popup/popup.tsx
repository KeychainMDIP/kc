import React from "react";
import ReactDOM from "react-dom/client";
import { UIProvider } from "../shared/UIContext";
import PopupContent from "./PopupContent";
import "../shared/extension.css";

const PopupUI = () => {
    return (
        <UIProvider>
            <PopupContent />
        </UIProvider>
    );
};

const rootElement = document.createElement("div");
rootElement.className = "popup-div";
document.body.appendChild(rootElement);
const root = ReactDOM.createRoot(rootElement);
root.render(<PopupUI />);
