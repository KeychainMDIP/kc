import { useState } from "react";
import { Box, Button, Flex, Heading, IconButton } from "@chakra-ui/react";
import { LuArrowLeft } from "react-icons/lu";
import { useColorMode } from "../../contexts/ColorModeProvider";
import WarningModal from "../../modals/WarningModal";
import MnemonicModal from "../../modals/MnemonicModal";
import { useWalletContext } from "../../contexts/WalletProvider";
import { useSnackbar } from "../../contexts/SnackbarProvider";

export interface WalletSettingsProps {
    isOpen: boolean;
    onClose: () => void;
}

export default function Wallet({ isOpen, onClose }: WalletSettingsProps) {
    const { colorMode } = useColorMode();
    const { keymaster, wipeWallet } = useWalletContext();
    const { setError, setSuccess } = useSnackbar();

    const [resetOpen, setResetOpen] = useState(false);
    const [backupOpen, setBackupOpen] = useState(false);
    const [mnemonicOpen, setMnemonicOpen] = useState(false);
    const [mnemonic, setMnemonic] = useState<string>("");

    if (!isOpen) {
        return;
    }

    const handleConfirmReset = async () => {
        onClose();
        setResetOpen(false);
        wipeWallet();
    };

    const handleRevealMnemonic = async () => {
        if (!keymaster) {
            return;
        }
        try {
            const m = await keymaster.decryptMnemonic();
            setMnemonic(m);
            setMnemonicOpen(true);
        } catch (e: any) {
            setError(e);
        }
    };

    async function handleConfirmBackup() {
        if (!keymaster) return;
        try {
            await keymaster.backupWallet();
            setSuccess("Wallet backup created");
        } catch (error: any) {
            setError(error);
        } finally {
            setBackupOpen(false);
        }
    }

    return (
        <>
            <WarningModal
                isOpen={backupOpen}
                title="Backup Wallet"
                warningText={
                    "This will create an encrypted backup of your wallet. If you later restore your wallet from your mnemonic this backup will automatically be restored."
                }
                onSubmit={handleConfirmBackup}
                onClose={() => setBackupOpen(false)}
            />

            <WarningModal
                isOpen={resetOpen}
                title="Reset Wallet"
                warningText="This will wipe the wallet and all data associated with it. This action cannot be undone."
                onSubmit={handleConfirmReset}
                onClose={() => setResetOpen(false)}
            />

            <MnemonicModal
                isOpen={mnemonicOpen}
                onClose={() => {
                    setMnemonicOpen(false);
                    setMnemonic("");
                }}
                errorText={""}
                mnemonic={mnemonic}
            />

            <Box
                position="absolute"
                top="0"
                left="0"
                right="0"
                bottom="46px"
                zIndex={1300}
                bg={colorMode === "dark" ? "gray.900" : "white"}
                display="flex"
                flexDirection="column"
            >
                <Flex as="header" align="center" gap={3} px={2}>
                    <IconButton variant="ghost" onClick={onClose}>
                        <LuArrowLeft />
                    </IconButton>
                    <Heading size="sm">Wallet</Heading>
                </Flex>

                <Box as="main" flex="1" overflowY="auto" px={4}>
                    <Box py={3}>
                        <Button width="100%" onClick={() => setBackupOpen(true)}>
                            Backup
                        </Button>
                    </Box>

                    <Box py={3}>
                        <Button width="100%" onClick={handleRevealMnemonic}>
                            Reveal Mnemonic
                        </Button>
                    </Box>

                    <Box py={3}>
                        <Button width="100%" onClick={() => setResetOpen(true)}>
                            Wipe Wallet
                        </Button>
                    </Box>
                </Box>
            </Box>
        </>
    );
}
