import { useState } from "react";
import { Box, HStack, Text, Button, Flex, IconButton, Heading } from "@chakra-ui/react";
import { useColorMode } from "../../contexts/ColorModeProvider";
import { LuArrowLeft, LuChevronRight, LuWallet, LuServer, LuPalette } from "react-icons/lu";
import Wallet from "./Wallet";
import Services from "./Services";
import Appearance from "./Appearance";

export interface SettingsProps {
    isOpen: boolean;
    onClose: () => void;
}

export default function SettingsMenu({ isOpen, onClose }: SettingsProps) {
    const { colorMode } = useColorMode();

    const [isWalletOpen, setIsWalletOpen] = useState(false);
    const [isServicesOpen, setIsServicesOpen] = useState(false);
    const [isAppearanceOpen, setIsAppearanceOpen] = useState(false);

    if (!isOpen) {
        return;
    }

    return (
        <>
            <Wallet
                isOpen={isWalletOpen}
                onClose={() => setIsWalletOpen(false)}
            />

            <Services
                isOpen={isServicesOpen}
                onClose={() => setIsServicesOpen(false)}
            />

            <Appearance
                isOpen={isAppearanceOpen}
                onClose={() => setIsAppearanceOpen(false)}
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

                    <Box py={3}>
                        <Button
                            width="100%"
                            justifyContent="space-between"
                            onClick={() => setIsWalletOpen(true)}
                            variant="outline"
                        >
                            <HStack gap={3} flex="1">
                                <LuWallet />
                                <Text>Wallet</Text>
                            </HStack>
                            <LuChevronRight />
                        </Button>
                    </Box>

                    <Box py={3}>
                        <Button
                            width="100%"
                            justifyContent="space-between"
                            onClick={() => setIsServicesOpen(true)}
                            variant="outline"
                        >
                            <HStack gap={3} flex="1">
                                <LuServer />
                                <Text>Services</Text>
                            </HStack>
                            <LuChevronRight />
                        </Button>
                    </Box>

                    <Box py={3}>
                        <Button
                            width="100%"
                            justifyContent="space-between"
                            onClick={() => setIsAppearanceOpen(true)}
                            variant="outline"
                        >
                            <HStack gap={3} flex="1">
                                <LuPalette />
                                <Text>Appearance</Text>
                            </HStack>
                            <LuChevronRight />
                        </Button>
                    </Box>
                </Box>
            </Box>
        </>
    );
}
