import ReactDOM from "react-dom/client";
import BrowserContent from "./BrowserContent";
import { ContextProviders } from "./contexts/ContextProviders";
import "./extension.css";
import "./utils/polyfills";
import { App } from '@capacitor/app';
import { queueDeepLink } from './utils/deepLinkQueue';

App.addListener('appUrlOpen', ({ url }) => {
    queueDeepLink(url);
    window.dispatchEvent(new Event('mdip:deepLinkQueued'));
});

(async () => {
    const launch = await App.getLaunchUrl();
    if (launch?.url) {
        queueDeepLink(launch.url);
        window.dispatchEvent(new Event('mdip:deepLinkQueued'));
    }
})();

const BrowserUI = () => {
    return (
        <ContextProviders>
            <BrowserContent />
        </ContextProviders>
    );
};

const root = ReactDOM.createRoot(document.getElementById("root")!);
root.render(<BrowserUI />);
