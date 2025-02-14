import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { ContextProviders } from "../shared/contexts/ContextProviders";
import PopupContent from "./PopupContent";
import "../shared/extension.css";

const PopupUI = () => {
    const [pendingAuth, setPendingAuth] = useState<string>("");

    useEffect(() => {
        const handleMessage = (message, _, sendResponse) => {
            if (message.action === "SHOW_POPUP_AUTH") {
                setPendingAuth(message.challenge);
                sendResponse({ success: true });
            }
        };
        chrome.runtime.onMessage.addListener(handleMessage);

        return () => {
            chrome.runtime.onMessage.removeListener(handleMessage);
        };
    }, []);

    return (
        <ContextProviders pendingAuth={pendingAuth} isBrowser={false}>
            <PopupContent />
        </ContextProviders>
    );
};

const rootElement = document.createElement("div");
document.body.appendChild(rootElement);
const root = ReactDOM.createRoot(rootElement);
root.render(<PopupUI />);
