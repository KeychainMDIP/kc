import React from "react";
import ReactDOM from "react-dom/client";
import { PopupProvider } from "./PopupContext";
import PopupContent from "./PopupContent";
import "./popup.css";

const PopupUI = () => {
    return (
        <PopupProvider>
            <PopupContent />
        </PopupProvider>
    );
};

const rootElement = document.createElement("div");
document.body.appendChild(rootElement);
const root = ReactDOM.createRoot(rootElement);
root.render(<PopupUI />);
