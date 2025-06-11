let passphrase: string | null = null;
const extensionState: Record<string, any> = {};

chrome.runtime.onMessage.addListener((message, _, sendResponse) => {
    if (message.action === "OPEN_AUTH_TAB") {
        chrome.runtime.sendMessage({
            action: "REQUEST_POPUP_AUTH",
            challenge: message.challenge,
        });
        sendResponse({ success: true });
    } else if (message.action === "OPEN_CREDENTIAL_TAB") {
        chrome.runtime.sendMessage({
            action: "REQUEST_POPUP_CREDENTIAL",
            credential: message.credential,
        });
        sendResponse({ success: true });
    } else if (message.action === "STORE_PASSPHRASE") {
        passphrase = message.passphrase;
        sendResponse({ success: true });
    } else if (message.action === "GET_PASSPHRASE") {
        sendResponse({ passphrase });
    } else if (message.action === "CLEAR_PASSPHRASE") {
        passphrase = null;
        sendResponse({ success: true });
    } else if (message.action === "STORE_STATE") {
        extensionState[message.key] = message.value;
        sendResponse({ success: true });
    } else if (message.action === "GET_ALL_STATE") {
        sendResponse({ extensionState });
    } else if (message.action === "GET_STATE") {
        const val = extensionState[message.key];
        sendResponse({ value: val });
    } else if (message.action === "CLEAR_ALL_STATE") {
        for (const key in extensionState) {
            delete extensionState[key];
        }
        sendResponse({ success: true });
    } else if (message.action === "CLEAR_STATE") {
        delete extensionState[message.key];
        sendResponse({ success: true });
    }

    return true;
});
