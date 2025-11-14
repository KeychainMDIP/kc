import { useEffect, useState } from "react";
import { useVariablesContext } from "./contexts/VariablesProvider";
import { useWalletContext } from "./contexts/WalletProvider";
import TextInputModal from "./modals/TextInputModal";
import { useSnackbar } from "./contexts/SnackbarProvider";
import HomePage from "./components/HomePage";
import ChatWindow from "./components/ChatWindow";

function BrowserContent() {
    const {
        activePeer,
        currentId,
        refreshInbox,
        refreshCurrentID,
    } = useVariablesContext();
    const {
        keymaster,
        registry,
    } = useWalletContext();

    const { setError, setSuccess } = useSnackbar();

    const [isWelcomeOpen, setIsWelcomeOpen] = useState(false);

    useEffect(() => {
        const check = async () => {
            if (!keymaster) {
                return;
            }
            try {
                const cid = await keymaster.getCurrentId();
                if (!cid) {
                    setIsWelcomeOpen(true);
                } else {
                    await refreshInbox();
                }
            } catch {}
        };
        check();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [keymaster]);

    const handleCreateIdentity = async (name: string) => {
        if (!keymaster) {
            return;
        }
        const trimmed = name.trim();
        if (!trimmed) {
            return;
        }
        try {
            await keymaster.createId(trimmed, { registry });
            await refreshCurrentID();
            setIsWelcomeOpen(false);
            setSuccess(`Welcome, ${trimmed}!`);
        } catch (error: any) {
            setError(error);
        }
    };

    return (
        <div style={{ position: "relative", height: "100vh" }}>
            <TextInputModal
                isOpen={isWelcomeOpen}
                title="Welcome to MDIP Messaging"
                description="Please enter your name."
                label="Name"
                confirmText="Create"
                onSubmit={handleCreateIdentity}
                onClose={() => setIsWelcomeOpen(false)}
            />

            {currentId && (
                <>
                    {!activePeer ? (
                        <div style={{ height: "100%" }}>
                            <HomePage />
                        </div>
                    ) : (
                        <div style={{ height: "100%" }}>
                            <ChatWindow />
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

export default BrowserContent;
