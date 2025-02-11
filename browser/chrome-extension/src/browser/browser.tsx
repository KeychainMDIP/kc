import React, { useState } from "react";
import ReactDOM from "react-dom/client";
import BrowserContent from "./BrowserContent";
import ContextProviders from "../shared/contexts/ContextProviders";
import type { openJSONViewerOptions } from "../shared/contexts/WalletProvider"
import "../shared/extension.css";

const BrowserUI = () => {
    const [jsonViewerOptions, setJsonViewerOptions] = useState<openJSONViewerOptions | null>(null);
    const [requestRefresh, setRequestRefresh] = useState<number>(0);

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.type === "PING_JSON_VIEWER") {
            sendResponse({ ack: true });
        } else if (request.type === "LOAD_JSON") {
            setJsonViewerOptions(request.payload);
        } else if (request.type === "REQUEST_REFRESH") {
            setRequestRefresh(r => r + 1);
        }
    });

    return (
        <ContextProviders isBrowser jsonViewerOptions={jsonViewerOptions} requestRefresh={requestRefresh}>
            <BrowserContent />
        </ContextProviders>
    );
};

const rootElement = document.createElement("div");
document.body.appendChild(rootElement);
const root = ReactDOM.createRoot(rootElement);
root.render(<BrowserUI />);
