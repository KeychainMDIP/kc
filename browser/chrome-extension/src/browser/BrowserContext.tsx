import React, {
    createContext,
    ReactNode,
    useContext,
    useEffect,
    useState,
} from "react";

import GatekeeperClient from "@mdip/gatekeeper/client";
import Keymaster from "@mdip/keymaster";
import CipherWeb from "@mdip/cipher/web";
import WalletChrome from "@mdip/keymaster/wallet/chrome";
import WalletWebEncrypted from "@mdip/keymaster/wallet/web-enc";
import WalletCache from "@mdip/keymaster/wallet/cache";
import { Alert, AlertColor, Box, Snackbar } from "@mui/material";

const gatekeeper = new GatekeeperClient();
const cipher = new CipherWeb();

interface BrowserContextValue {
    setError(error: string): void;
    keymaster: Keymaster | null;
}

const BrowserContext = createContext<BrowserContextValue | null>(null);

export function BrowserProvider({ children }: { children: ReactNode }) {
    const [keymaster, setKeymaster] = useState<Keymaster | null>(null);

    interface SnackbarState {
        open: boolean;
        message: string;
        severity: AlertColor;
    }

    const [snackbar, setSnackbar] = useState<SnackbarState>({
        open: false,
        message: "",
        severity: "warning",
    });

    const setError = (error: string) => {
        setSnackbar({
            open: true,
            message: error,
            severity: "error",
        });
    };

    useEffect(() => {
        const init = async () => {
            const { gatekeeperUrl } = await chrome.storage.sync.get([
                "gatekeeperUrl",
            ]);
            await gatekeeper.connect({ url: gatekeeperUrl });

            let pass: string;
            let response = await chrome.runtime.sendMessage({
                action: "GET_PASSPHRASE",
            });
            if (response && response.passphrase) {
                pass = response.passphrase;
            } else {
                setError("Unable to get passphrase.");
                return;
            }

            const wallet_chrome = new WalletChrome();
            const wallet_enc = new WalletWebEncrypted(wallet_chrome, pass);
            const wallet_cache = new WalletCache(wallet_enc);

            try {
                await wallet_cache.loadWallet();
            } catch (e) {
                setError("Invalid passphrase.");
                return;
            }

            const keymaster = new Keymaster({
                gatekeeper,
                wallet: wallet_cache,
                cipher,
            });

            setKeymaster(keymaster);
        };
        init();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleSnackbarClose = () => {
        setSnackbar((prev) => ({ ...prev, open: false }));
    };

    const value: BrowserContextValue = {
        setError,
        keymaster,
    };

    return (
        <Box>
            <Snackbar
                open={snackbar.open}
                autoHideDuration={5000}
                onClose={handleSnackbarClose}
                anchorOrigin={{ vertical: "top", horizontal: "center" }}
            >
                <Alert
                    onClose={handleSnackbarClose}
                    severity={snackbar.severity}
                    sx={{ width: "100%" }}
                >
                    {snackbar.message}
                </Alert>
            </Snackbar>

            <BrowserContext.Provider value={value}>
                {children}
            </BrowserContext.Provider>
        </Box>
    );
}

export function useBrowserContext() {
    const context = useContext(BrowserContext);
    if (!context) {
        throw new Error("Failed to get context from BrowserContext.Provider");
    }
    return context;
}
