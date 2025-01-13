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
