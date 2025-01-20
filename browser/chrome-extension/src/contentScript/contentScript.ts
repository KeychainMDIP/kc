document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLAnchorElement)) return;

    const href = target.getAttribute("href") || "";

    if (href.startsWith("mdip://")) {
        event.preventDefault();
        const parsedURL = new URL(href.replace("mdip://", "https://mdip/"));
        const tab = parsedURL.pathname.slice(1);
        if (tab === "auth") {
            const challenge = parsedURL.searchParams.get("challenge");
            if (!challenge) return;
            chrome.runtime.sendMessage({
                action: "OPEN_AUTH_TAB",
                challenge,
            });
        }
    }
});
