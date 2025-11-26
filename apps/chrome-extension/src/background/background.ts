import {openBrowserValues} from "../contexts/UIContext";

const DEFAULT_GATEKEEPER_URL = "http://localhost:4224";
const DEFAULT_SEARCH_SERVER_URL = "http://localhost:4002";

async function ensureDefaultSettings() {
    try {
        const { gatekeeperUrl, searchServerUrl } = await chrome.storage.sync.get([
            "gatekeeperUrl",
            "searchServerUrl",
        ]);

        const updates: Record<string, string> = {};

        if (gatekeeperUrl === undefined) {
            updates.gatekeeperUrl = DEFAULT_GATEKEEPER_URL;
        }
        if (searchServerUrl === undefined) {
            updates.searchServerUrl = DEFAULT_SEARCH_SERVER_URL;
        }

        if (Object.keys(updates).length) {
            await chrome.storage.sync.set(updates);
        }
    } catch (error) {
        console.error("Error ensuring default settings:", error);
    }
}

chrome.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === chrome.runtime.OnInstalledReason.INSTALL) {
        await ensureDefaultSettings();
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
    await ensureDefaultSettings();
    await createOffscreen();
});

chrome.runtime.onMessage.addListener((message, _, sendResponse) => {
    if (message.action === "REQUEST_POPUP_CREDENTIAL") {
        chrome.action.openPopup(() => {
            chrome.runtime.sendMessage({
                action: "SHOW_POPUP_CREDENTIAL",
                credential: message.credential,
            });
        });
        sendResponse({ success: true });
    } else if (message.action === "REQUEST_POPUP_AUTH") {
        chrome.action.openPopup(() => {
            chrome.runtime.sendMessage({
                action: "SHOW_POPUP_AUTH",
                challenge: message.challenge,
            });
        });
        sendResponse({ success: true });
    } else if (message.type === "OPEN_BROWSER_WINDOW") {
        openBrowserWindowService(message.options);
    }

    return true;
});

function openBrowserWindowService(options: openBrowserValues) {
    const tab = options.tab ?? "viewer";

    const payload = {
        ...options,
        tab
    };

    let url = `browser.html?tab=${tab}`;

    if (options.subTab) {
        url += `&subTab=${options.subTab}`;
    }

    if (!options.contents) {
        if (options.did) {
            const didEncoded = encodeURIComponent(options.did);
            url += `&did=${didEncoded}`;
        }

        if (options.title) {
            const titleEncoded = encodeURIComponent(options.title);
            url += `&title=${titleEncoded}`;
        }
    }

    const deliverPayload = (tabId: number) => {
        chrome.tabs.sendMessage(tabId, { type: "PING_BROWSER" }, (resp) => {
            if (chrome.runtime.lastError || !resp?.ack) {
                setTimeout(() => deliverPayload(tabId), 100);
                return;
            }
            chrome.tabs.sendMessage(tabId, { type: "LOAD_BROWSER_CONTENTS", payload });
            chrome.tabs.update(tabId, { active: true });
        });
    };

    const openNewBrowserTab = () => {
        chrome.tabs.create({ url }, (created) => {
            const listener = (id: number, info: chrome.tabs.TabChangeInfo) => {
                if (id === created.id && info.status === "complete") {
                    deliverPayload(id);
                    chrome.tabs.onUpdated.removeListener(listener);
                }
            };
            chrome.tabs.onUpdated.addListener(listener);
        });
    };

    chrome.tabs.query({ url: chrome.runtime.getURL("browser.html") + "*" }, (tabs) => {
        if (!tabs || tabs.length === 0 || tabs[0].id === undefined) {
            openNewBrowserTab();
            return;
        }

        const existingTabId = tabs[0].id;

        chrome.tabs.sendMessage(
            existingTabId,
            { type: "PING_BROWSER" },
            (response) => {
                if (chrome.runtime.lastError || !response?.ack) {
                    openNewBrowserTab();
                    return;
                }

                deliverPayload(existingTabId)
            }
        );
    });
}
