import { useEffect, useState } from "react";
import { useVariablesContext } from "./contexts/VariablesProvider";
import { useWalletContext } from "./contexts/WalletProvider";
import TextInputModal from "./modals/TextInputModal";
import HomePage from "./components/HomePage";
import ChatWindow from "./components/ChatWindow";
import { useSnackbar } from "./contexts/SnackbarProvider";
import { useSafeArea } from "./contexts/SafeAreaContext";
import {MESSAGING_PROFILE} from "./constants";

function BrowserContent() {
    const [isWelcomeOpen, setIsWelcomeOpen] = useState(false);
    const { setError, setSuccess } = useSnackbar();
    const {
        currentId,
        refreshInbox,
        refreshCurrentID,
        refreshAll,
    } = useVariablesContext();
    const {
        keymaster,
        registry,
    } = useWalletContext();


    const insets = useSafeArea();


    useEffect(() => {
        const check = async () => {
            if (!keymaster) {
                return;
            }

            try {
                const cid = await keymaster.getCurrentId();
                if (cid) {
                    await refreshAll();
                    await refreshInbox();
                } else {
                    setIsWelcomeOpen(true);
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
            const did = await keymaster.createId(trimmed, { registry });
            const doc = await keymaster.resolveDID(did);
            (doc.didDocumentData as Record<string, any>) = {[MESSAGING_PROFILE]: { name: trimmed }};

            await keymaster.updateDID(doc);

            await refreshCurrentID();
            setIsWelcomeOpen(false);
            setSuccess(`Welcome, ${trimmed}!`);
        } catch (error: any) {
            setError(error);
        }
    };

    return (
        <div
            style={{
                position: "absolute",
                top: insets.top,
                bottom: insets.bottom,
                left: insets.left,
                right: insets.right,
                overflow: "hidden"
            }}>

            <TextInputModal
                isOpen={isWelcomeOpen}
                title="Welcome to MDIP Messaging"
                description="Please enter your name"
                confirmText="Create"
                onSubmit={handleCreateIdentity}
            />

            {currentId && (
                <>
                    <div style={{ height: "100%" }}>
                        <HomePage />
                    </div>
                    <ChatWindow />
                </>
            )}
        </div>
    );
}

export default BrowserContent;
