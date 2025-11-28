import { useState } from "react";
import {Box, HStack, Text, Button, Flex, IconButton, Heading} from "@chakra-ui/react";
import { ColorModeButton, useColorMode } from "../contexts/ColorModeProvider";
import WarningModal from "../modals/WarningModal";
import MnemonicModal from "../modals/MnemonicModal";
import { useWalletContext } from "../contexts/WalletProvider";
import { useSnackbar } from "../contexts/SnackbarProvider";
import {LuArrowLeft} from "react-icons/lu";

export interface SettingsProps {
    isOpen: boolean;
    onClose: () => void;
}

export default function Settings({ isOpen, onClose }: SettingsProps) {
    const { keymaster, wipeWallet } = useWalletContext();
    const { setError } = useSnackbar();
    const { colorMode } = useColorMode();

    const [resetOpen, setResetOpen] = useState(false);
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
            const mnemonic = await keymaster.decryptMnemonic();
            setMnemonic(mnemonic);
            setMnemonicOpen(true);
        } catch (e: any) {
            setError(e);
        }
    };

    return (
        <>
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
                zIndex={1200}
                bg={colorMode === "dark" ? "gray.900" : "white"}
                display="flex"
                flexDirection="column"
            >
                <Flex as="header" align="center" gap={3} px={2}>
                    <IconButton variant="ghost" onClick={onClose}>
                        <LuArrowLeft />
                    </IconButton>
                    <Heading size="sm">Settings</Heading>
                </Flex>

                <Box as="main" flex="1" overflowY="auto" px={4}>
                    <HStack justify="space-between" py={3}>
                        <HStack gap={3}>
                            <Text>Dark Mode</Text>
                        </HStack>
                        <ColorModeButton />
                    </HStack>

                    <Box py={3}>
                        <Button width="100%" onClick={handleRevealMnemonic}>
                            Reveal Mnemonic
                        </Button>
                    </Box>

                    <Box py={3}>
                        <Button
                            width="100%"
                            colorScheme="red"
                            color="white"
                            onClick={() => setResetOpen(true)}
                        >
                            Wipe Wallet
                        </Button>
                    </Box>
                </Box>
            </Box>
        </>
    );
}
