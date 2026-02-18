import React, {
    createContext,
    Dispatch,
    ReactNode,
    SetStateAction,
    useContext,
    useEffect,
    useRef,
    useState,
} from "react";

import GatekeeperClient from "@mdip/gatekeeper/client";
import Keymaster from "@mdip/keymaster";
import SearchClient from "@mdip/keymaster/search";
import CipherWeb from "@mdip/cipher/web";
import WalletChrome from "@mdip/keymaster/wallet/chrome";
import { isLegacyV0, isV1WithEnc } from '@mdip/keymaster/wallet/typeGuards';
import { StoredWallet, WalletBase } from "@mdip/keymaster/types";
import PassphraseModal from "../modals/PassphraseModal";
import WarningModal from "../modals/WarningModal";
import MnemonicModal from "../modals/MnemonicModal";
import { encMnemonic } from '@mdip/keymaster/encryption';
import WalletJsonMemory from "@mdip/keymaster/wallet/json-memory";

const gatekeeper = new GatekeeperClient();
const cipher = new CipherWeb();

interface WalletContextValue {
    pendingMnemonic: string;
    setPendingMnemonic: Dispatch<SetStateAction<string>>;
    pendingWallet: unknown;
    setPendingWallet: Dispatch<SetStateAction<unknown>>;
    initialiseServices: () => Promise<void>;
    initialiseWallet: () => Promise<void>;
    handleWalletUploadFile: (uploaded: unknown) => Promise<void>;
    isBrowser: boolean;
    reloadBrowserWallet: () => Promise<void>;
    refreshFlag: number;
    keymaster: Keymaster | null;
}

const WalletContext = createContext<WalletContextValue | null>(null);

let search: SearchClient | undefined;

const INCORRECT_PASSPHRASE = "Incorrect passphrase";

export function WalletProvider({ children, isBrowser }: { children: ReactNode, isBrowser: boolean }) {
    const [passphraseErrorText, setPassphraseErrorText] = useState<string>("");
    const [pendingMnemonic, setPendingMnemonic] = useState<string>("");
    const [pendingWallet, setPendingWallet] = useState<unknown>(null);
    const [modalAction, setModalAction] = useState<null | "decrypt" | "set-passphrase">(null);
    const [uploadAction, setUploadAction] = useState<null | "upload-plain-v0" | "upload-enc-v1">(null);
    const [isReady, setIsReady] = useState<boolean>(false);
    const [showResetConfirm, setShowResetConfirm] = useState<boolean>(false);
    const [showResetSetup, setShowResetSetup] = useState<boolean>(false);
    const [showRecoverMnemonic, setShowRecoverMnemonic] = useState(false);
    const [mnemonicErrorText, setMnemonicErrorText] = useState("");
    const [recoveredMnemonic, setRecoveredMnemonic] = useState("");
    const [showRecoverSetup, setShowRecoverSetup] = useState(false);
    const [refreshFlag, setRefreshFlag] = useState<number>(0);

    const keymasterRef = useRef<Keymaster | null>(null);

    const walletChrome = new WalletChrome();

    useEffect(() => {
        const initWallet = async () => {
            await initialiseServices();
            await initialiseWallet();
        }

        initWallet();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    async function initialiseWallet() {
        const walletData = await walletChrome.loadWallet();

        let response = await chrome.runtime.sendMessage({
            action: "GET_PASSPHRASE",
        });
        const pass = response?.passphrase || "";

        if (!pendingMnemonic && pass) {
            let res = await rebuildKeymaster(pass);
            if (res) {
                return;
            }
            setPassphraseErrorText("");
            await chrome.runtime.sendMessage({ action: "CLEAR_PASSPHRASE" });
        }

        if (!walletData || pendingMnemonic || isLegacyV0(walletData)) {
            // eslint-disable-next-line sonarjs/no-duplicate-string
            setModalAction('set-passphrase');
        } else {
            setModalAction('decrypt');
        }
    }

    async function initialiseServices() {
        const { gatekeeperUrl, searchServerUrl } = await chrome.storage.sync.get([
            "gatekeeperUrl",
            "searchServerUrl"
        ]);
        await gatekeeper.connect({ url: gatekeeperUrl as string });
        search = await SearchClient.create({ url: searchServerUrl as string });
    }

    const buildKeymaster = async (wallet: WalletBase, passphrase: string) => {
        const instance = new Keymaster({gatekeeper, wallet, cipher, search, passphrase});

        if (pendingMnemonic) {
            await instance.newWallet(pendingMnemonic, true);
            await instance.recoverWallet();
        } else {
            try {
                // check pass & convert to v1 if needed
                await instance.loadWallet();
            } catch {
                setPassphraseErrorText(INCORRECT_PASSPHRASE);
                return false;
            }
        }

        setModalAction(null);
        setPendingWallet(null);
        setPendingMnemonic("");
        setUploadAction(null);
        setPassphraseErrorText("");
        keymasterRef.current = instance;
        setRefreshFlag(r => r + 1);
        setIsReady(true);
        await chrome.runtime.sendMessage({
            action: "STORE_PASSPHRASE",
            passphrase,
        });

        return true;
    };

    async function rebuildKeymaster(passphrase: string) {
        return await buildKeymaster(walletChrome, passphrase);
    }

    async function handlePassphraseSubmit(passphrase: string) {
        setPassphraseErrorText("");

        const walletMemory = new WalletJsonMemory();

        if (uploadAction && pendingWallet) {
            if (modalAction === 'decrypt') {
                await walletMemory.saveWallet(pendingWallet as StoredWallet, true);

                try {
                    const km = new Keymaster({ gatekeeper, wallet: walletMemory, cipher, search, passphrase });
                    // check pass
                    await km.loadWallet();
                    await walletChrome.saveWallet(pendingWallet as StoredWallet, true);
                } catch {
                    setPassphraseErrorText(INCORRECT_PASSPHRASE);
                    return;
                }
            } else { // upload-plain-v0
                await walletChrome.saveWallet(pendingWallet as StoredWallet, true);
            }
        }

        await rebuildKeymaster(passphrase);
    }

    async function handlePassphraseClose() {
        setPendingWallet(null);
        setPendingMnemonic("");
        setPassphraseErrorText("");

        const walletData = await walletChrome.loadWallet();
        if (walletData) {
            setModalAction(null);
        }
    }

    async function reloadBrowserWallet() {
        if (!isBrowser) {
            return;
        }

        let response = await chrome.runtime.sendMessage({
            action: "GET_PASSPHRASE",
        });
        const pass = response?.passphrase || "";
        if (!pass) {
            return;
        }

        await rebuildKeymaster(pass);
    }

    async function handleWalletUploadFile(uploaded: unknown) {
        setPendingWallet(uploaded);

        if (isLegacyV0(uploaded)) {
            setUploadAction('upload-plain-v0');
            setModalAction('set-passphrase');
        } else if (isV1WithEnc(uploaded)) {
            setUploadAction('upload-enc-v1');
            setModalAction('decrypt');
        } else {
            window.alert('Unsupported wallet type');
        }
    }

    function handleStartReset() {
        setPassphraseErrorText("");
        setShowResetConfirm(true);
    }

    function handleStartRecover() {
        setMnemonicErrorText("");
        setShowRecoverMnemonic(true);
        setPassphraseErrorText("");

        // only nullify modalAction if we are uploading a wallet, otherwise
        // leave passphrase modal open in case the user cancels
        if (uploadAction !== null) {
            setModalAction(null);
        }
    }

    function handleConfirmReset() {
        setShowResetConfirm(false);
        setShowResetSetup(true);
    }

    function handleCancelReset() {
        setShowResetConfirm(false);
    }

    async function handleResetPassphraseSubmit(newPassphrase: string) {
        try {
            const walletWeb = new WalletChrome();
            const km = new Keymaster({ gatekeeper, wallet: walletWeb, cipher, search, passphrase: newPassphrase });
            await km.newWallet(undefined, true);
            setShowResetSetup(false);
            await rebuildKeymaster(newPassphrase);
        } catch {
            setPassphraseErrorText('Failed to reset wallet. Try again.');
        }
    }

    async function handleRecoverMnemonicSubmit(mnemonic: string) {
        setMnemonicErrorText("");
        try {
            const walletWeb = new WalletChrome();
            let stored = pendingWallet && isV1WithEnc(pendingWallet)
                ? pendingWallet
                : await walletWeb.loadWallet();

            if (!isV1WithEnc(stored)) {
                setMnemonicErrorText('Recovery not available for this wallet type.');
                return;
            }

            const hdkey = cipher.generateHDKey(mnemonic);
            const { publicJwk, privateJwk } = cipher.generateJwk(hdkey.privateKey!);
            cipher.decryptMessage(publicJwk, privateJwk, stored.enc);

            setRecoveredMnemonic(mnemonic);
            setShowRecoverMnemonic(false);
            setShowRecoverSetup(true);
        } catch {
            setMnemonicErrorText('Mnemonic is incorrect. Try again.');
        }
    }

    async function handleRecoverPassphraseSubmit(newPassphrase: string) {
        if (!recoveredMnemonic) {
            return;
        }
        try {
            const walletWeb = new WalletChrome();
            const base = pendingWallet && isV1WithEnc(pendingWallet)
                ? pendingWallet
                : await walletWeb.loadWallet();

            if (!isV1WithEnc(base)) {
                setPassphraseErrorText('Recovery not available for this wallet type.');
                return;
            }

            const mnemonicEnc = await encMnemonic(recoveredMnemonic, newPassphrase);
            const updated = {
                version: base.version,
                seed: { mnemonicEnc },
                enc: base.enc
            };

            await walletWeb.saveWallet(updated, true);
            setRecoveredMnemonic("");
            setShowRecoverSetup(false);
            await rebuildKeymaster(newPassphrase);
        } catch {
            setPassphraseErrorText('Failed to update passphrase. Try again.');
        }
    }

    const value: WalletContextValue = {
        pendingMnemonic,
        setPendingMnemonic,
        pendingWallet,
        setPendingWallet,
        initialiseServices,
        initialiseWallet,
        handleWalletUploadFile,
        reloadBrowserWallet,
        refreshFlag,
        isBrowser,
        keymaster: keymasterRef.current,
    };

    return (
        <>
            <PassphraseModal
                isOpen={modalAction !== null && !showResetSetup && !showRecoverSetup}
                title={modalAction === 'set-passphrase'
                    ? 'Set a Passphrase' : 'Enter Your Wallet Passphrase'}
                errorText={passphraseErrorText}
                onSubmit={handlePassphraseSubmit}
                onClose={handlePassphraseClose}
                encrypt={modalAction === 'set-passphrase'}
                showCancel={pendingWallet !== null}
                upload={uploadAction !== null}
                onStartReset={handleStartReset}
                onStartRecover={
                    modalAction === 'decrypt' &&
                    (uploadAction === null || uploadAction === 'upload-enc-v1')
                        ? handleStartRecover
                        : undefined
                }
            />

            <MnemonicModal
                isOpen={showRecoverMnemonic}
                errorText={mnemonicErrorText}
                onSubmit={handleRecoverMnemonicSubmit}
                onClose={() => setShowRecoverMnemonic(false)}
            />

            <WarningModal
                isOpen={showResetConfirm}
                title="Overwrite wallet with a new one?"
                warningText="This will delete your current wallet data in this browser and create a brand new one."
                onSubmit={handleConfirmReset}
                onClose={handleCancelReset}
            />

            <PassphraseModal
                isOpen={showResetSetup}
                title="Set a Passphrase"
                errorText={passphraseErrorText}
                onSubmit={handleResetPassphraseSubmit}
                onClose={() => setShowResetSetup(false)}
                encrypt={true}
                showCancel={true}
            />

            <PassphraseModal
                isOpen={showRecoverSetup}
                title="Set a New Passphrase"
                errorText={passphraseErrorText}
                onSubmit={handleRecoverPassphraseSubmit}
                onClose={() => setShowRecoverSetup(false)}
                encrypt={true}
                showCancel={true}
            />

            {isReady && (
                <WalletContext.Provider value={value}>
                    {children}
                </WalletContext.Provider>
            )}
        </>
    );
}

export function useWalletContext() {
    const context = useContext(WalletContext);
    if (!context) {
        throw new Error("Failed to get context from WalletContext.Provider");
    }
    return context;
}
