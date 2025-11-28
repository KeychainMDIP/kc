import { useState } from "react";
import { Box, Flex, HStack, Text, IconButton, Button } from "@chakra-ui/react";
import { ColorModeButton, useColorMode } from "../contexts/ColorModeProvider";
import { Avatar } from "@chatscope/chat-ui-kit-react";
import {avatarDataUrl} from "../utils/utils";
import { LuPencil, LuQrCode } from "react-icons/lu";
import TextInputModal from "../modals/TextInputModal";
import WarningModal from "../modals/WarningModal";
import QRCodeModal from "../modals/QRCodeModal";
import MnemonicModal from "../modals/MnemonicModal";
import { useWalletContext } from "../contexts/WalletProvider";
import { useSnackbar } from "../contexts/SnackbarProvider";
import { useVariablesContext } from "../contexts/VariablesProvider";
import { truncateMiddle } from "../utils/utils";

export interface SettingsProps {
    isOpen: boolean;
    onClose: () => void;
}

export default function Settings({ isOpen, onClose }: SettingsProps) {
    const {
        currentId,
        currentDID,
        refreshCurrentID,
    } = useVariablesContext()
    const {
        keymaster,
        wipeWallet,
    } = useWalletContext();
    const { setError } = useSnackbar();
    const { colorMode } = useColorMode();

    const [renameOpen, setRenameOpen] = useState(false);
    const [qrOpen, setQrOpen] = useState(false);
    const [resetOpen, setResetOpen] = useState(false);
    const [mnemonicOpen, setMnemonicOpen] = useState(false);
    const [mnemonic, setMnemonic] = useState<string>("");

    if (!isOpen) {
        return null
    }

    const handleRenameSubmit = async (newName: string) => {
        const trimmed = newName.trim();
        setRenameOpen(false);
        if (!keymaster || !trimmed || trimmed === currentId) {
            return;
        }
        try {
            await keymaster.renameId(currentId, trimmed);
            await refreshCurrentID();
        } catch (e: any) {
            setError(e);
        }
    };

    const userAvatar = avatarDataUrl(currentDID, 64);

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
            <TextInputModal
                isOpen={renameOpen}
                title="Rename"
                description="Enter a new name"
                confirmText="Rename"
                defaultValue={currentId}
                onSubmit={handleRenameSubmit}
                onClose={() => setRenameOpen(false)}
            />

            <QRCodeModal
                isOpen={qrOpen}
                onClose={() => setQrOpen(false)}
                did={currentDID}
                name={currentId}
                userAvatar={userAvatar}
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
                zIndex={1100}
                bg={colorMode === "dark" ? "gray.900" : "white"}
                display="flex"
                flexDirection="column"
            >
                <Flex as="header" direction="column" align="center" justify="center" w="100%" px={2} py={3} gap={2} borderBottomWidth="1px" position="relative">
                    <Avatar src={userAvatar} />
                    <Text fontWeight="semibold">{currentId}</Text>
                    <Text fontSize="sm" maxW="100%" whiteSpace="nowrap">
                        {truncateMiddle(currentDID)}
                    </Text>

                    <IconButton
                        position="absolute"
                        top="8px"
                        right="8px"
                        variant="ghost"
                        size="sm"
                        onClick={() => setRenameOpen(true)}
                    >
                        <LuPencil />
                    </IconButton>

                    <IconButton
                        position="absolute"
                        top="8px"
                        left="8px"
                        variant="ghost"
                        size="sm"
                        onClick={() => setQrOpen(true)}
                    >
                        <LuQrCode />
                    </IconButton>
                </Flex>

                <Box as="main" flex="1" overflowY="auto" px={4}>
                    <HStack justify="space-between" py={3}>
                        <HStack gap={3}>
                            <Text>Dark Mode</Text>
                        </HStack>
                        <ColorModeButton />
                    </HStack>

                    <Box py={3}>
                        <Button
                            width="100%"
                            onClick={handleRevealMnemonic}
                        >
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
                            RESET WALLET
                        </Button>
                    </Box>
                </Box>
            </Box>
        </>
    )
}
