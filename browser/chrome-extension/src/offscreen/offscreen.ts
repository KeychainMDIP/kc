let passphrase: string = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "OPEN_AUTH_TAB") {
        chrome.runtime.sendMessage({
            action: "REQUEST_POPUP_OPEN",
            challenge: message.challenge,
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
    }

    return true;
});
