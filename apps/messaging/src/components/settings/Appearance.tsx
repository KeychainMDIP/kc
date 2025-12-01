import { Box, Flex, Heading, IconButton, HStack, Text } from "@chakra-ui/react";
import { LuArrowLeft } from "react-icons/lu";
import { ColorModeButton, useColorMode } from "../../contexts/ColorModeProvider";

export interface AppearanceProps {
    isOpen: boolean;
    onClose: () => void;
}

export default function Appearance({ isOpen, onClose }: AppearanceProps) {
    const { colorMode } = useColorMode();

    if (!isOpen) {
        return;
    }

    return (
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
                <Heading size="sm">Appearance</Heading>
            </Flex>

            <Box as="main" flex="1" overflowY="auto" px={4}>
                <HStack justify="space-between" py={3}>
                    <HStack gap={3}>
                        <Text>Dark Mode</Text>
                    </HStack>
                    <ColorModeButton />
                </HStack>
            </Box>
        </Box>
    );
}
