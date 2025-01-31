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
    await createOffscreen();
});

async function createOffscreen() {
    if (await chrome.offscreen.hasDocument()) {
        return;
    }
    await chrome.offscreen.createDocument({
        url: "offscreen.html",
        reasons: [chrome.offscreen.Reason.WORKERS],
        justification: "Communicate with the extension",
    });
}

chrome.runtime.onStartup.addListener(async () => {
    await createOffscreen();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "REQUEST_POPUP_OPEN") {
        chrome.action.openPopup(() => {
            chrome.runtime.sendMessage({
                action: "SHOW_POPUP_AUTH",
                challenge: message.challenge,
            });
        });
        sendResponse({ success: true });
    }

    return true;
});
