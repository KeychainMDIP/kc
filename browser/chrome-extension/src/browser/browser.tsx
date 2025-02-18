import React, { useState } from "react";
import ReactDOM from "react-dom/client";
import BrowserContent from "./BrowserContent";
import { ContextProviders } from "../shared/contexts/ContextProviders";
import type { openJSONViewerOptions } from "../shared/contexts/UIContext";
import "../shared/extension.css";
import { RefreshMode } from '../shared/contexts/UIContext';

const BrowserUI = () => {
    const [jsonViewerOptions, setJsonViewerOptions] = useState<openJSONViewerOptions | null>(null);
    const [browserRefresh, setBrowserRefresh] = useState<RefreshMode>(RefreshMode.NONE);

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.type === "PING_JSON_VIEWER") {
            sendResponse({ ack: true });
        } else if (request.type === "LOAD_JSON") {
            setJsonViewerOptions(request.payload);
        } else if (request.type === "BROWSER_REFRESH") {
            setBrowserRefresh(RefreshMode.WALLET);
        } else if (request.type === "BROWSER_THEME") {
            setBrowserRefresh(RefreshMode.THEME);
        }
    });

    return (
        <ContextProviders
            isBrowser
            jsonViewerOptions={jsonViewerOptions}
            setJsonViewerOptions={setJsonViewerOptions}
            browserRefresh={browserRefresh}
            setBrowserRefresh={setBrowserRefresh}
        >
            <BrowserContent />
        </ContextProviders>
    );
};

const rootElement = document.createElement("div");
rootElement.style.width = "100%";
rootElement.style.height = "100%";
document.body.appendChild(rootElement);
const root = ReactDOM.createRoot(rootElement);
root.render(<BrowserUI />);
