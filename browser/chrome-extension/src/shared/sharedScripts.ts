export function requestBrowserRefresh(isBrowser: boolean) {
    if (isBrowser) {
        return;
    }
    chrome.tabs.query({ url: chrome.runtime.getURL("browser.html") + "*" }, (tabs) => {
        if (!tabs || tabs.length === 0) {
            return;
        }

        for (const tab of tabs) {
            const existingTabId = tab.id;
            chrome.tabs.sendMessage(
                existingTabId,
                { type: "BROWSER_REFRESH" }
            );
        }
    });
}
