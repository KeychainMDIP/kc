import ReactDOM from "react-dom/client";
import BrowserContent from "./BrowserContent";
import { ContextProviders } from "./contexts/ContextProviders";
import "./utils/polyfills";
import { BarcodeScanner } from '@capacitor-mlkit/barcode-scanning';
import { Toaster } from "./modals/Toaster";

import "@chatscope/chat-ui-kit-styles/dist/default/styles.min.css";
import "./styles/chatscope.dark.css";

(async () => {
    try {
        const has = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable();
        if (!has) {
            await BarcodeScanner.installGoogleBarcodeScannerModule();
        }
    } catch {}
})();

const BrowserUI = () => {
    return (
        <ContextProviders>
            <Toaster />
            <BrowserContent />
        </ContextProviders>
    );
};

const root = ReactDOM.createRoot(document.getElementById("root")!);
root.render(<BrowserUI />);
