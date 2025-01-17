const DEFAULT_GATEKEEPER_URL = "http://localhost:4224";

chrome.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === chrome.runtime.OnInstalledReason.INSTALL) {
        try {
            await chrome.storage.sync.set({
                gatekeeperUrl: DEFAULT_GATEKEEPER_URL,
            });
        } catch (error) {
            console.error("Error setting gatekeeperUrl:", error);
        }
    }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "OPEN_AUTH_TAB") {
        chrome.action.openPopup(() => {
            chrome.runtime.sendMessage({
                action: "SHOW_POPUP_AUTH",
                challenge: message.challenge,
            });
        });
        sendResponse({ success: true });
    }
});
