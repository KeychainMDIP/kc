import { Box, Flex, Heading, IconButton, HStack, Text } from "@chakra-ui/react";
import { LuArrowLeft } from "react-icons/lu";
import { ColorModeButton, useColorMode } from "../../contexts/ColorModeProvider";
import SlideInRight from "../transitions/SlideInRight";

export interface AppearanceProps {
    isOpen: boolean;
    onClose: () => void;
}

export default function Appearance({ isOpen, onClose }: AppearanceProps) {
    const { colorMode } = useColorMode();

    return (
        <SlideInRight isOpen={isOpen} bg={colorMode === "dark" ? "gray.900" : "white"} zIndex={1300}>
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
        </SlideInRight>
    );
}
