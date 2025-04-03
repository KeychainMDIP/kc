export function requestBrowserRefresh(isBrowser: boolean, theme = false) {
    if (isBrowser) {
        return;
    }
    chrome.tabs.query({ url: chrome.runtime.getURL("browser.html") + "*" }, (tabs) => {
        if (!tabs || tabs.length === 0) {
            return;
        }

        for (const tab of tabs) {
            const existingTabId = tab.id;
            if (existingTabId === undefined) {
                continue;
            }
            chrome.tabs.sendMessage(
                existingTabId,
                { type: theme ? "BROWSER_THEME" : "BROWSER_REFRESH" }
            );
        }
    });
}
