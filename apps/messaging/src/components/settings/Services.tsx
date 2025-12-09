import { useEffect, useState } from "react";
import { Box, Button, Field, Flex, Heading, IconButton, Input } from "@chakra-ui/react";
import { LuArrowLeft } from "react-icons/lu";
import { useColorMode } from "../../contexts/ColorModeProvider";
import { useWalletContext } from "../../contexts/WalletProvider";
import { useSnackbar } from "../../contexts/SnackbarProvider";
import {
    DEFAULT_GATEKEEPER_URL,
    DEFAULT_SEARCH_SERVER_URL,
    GATEKEEPER_KEY,
    SEARCH_SERVER_KEY,
} from "../../constants";
import {useVariablesContext} from "../../contexts/VariablesProvider";

export interface ServicesSettingsProps {
    isOpen: boolean;
    onClose: () => void;
}

export default function Services({ isOpen, onClose }: ServicesSettingsProps) {
    const { colorMode } = useColorMode();
    const { initialiseServices, initialiseWallet } = useWalletContext();
    const { setError, setSuccess } = useSnackbar();
    const { refreshAll } = useVariablesContext();

    const [gatekeeperUrl, setGatekeeperUrl] = useState<string>(DEFAULT_GATEKEEPER_URL);
    const [searchServerUrl, setSearchServerUrl] = useState<string>(DEFAULT_SEARCH_SERVER_URL);

    useEffect(() => {
        if (!isOpen) {
            return;
        }
        try {
            const gatekeeper = localStorage.getItem(GATEKEEPER_KEY) || DEFAULT_GATEKEEPER_URL;
            const search = localStorage.getItem(SEARCH_SERVER_KEY) || DEFAULT_SEARCH_SERVER_URL;
            setGatekeeperUrl(gatekeeper);
            setSearchServerUrl(search);
        } catch {}
    }, [isOpen]);

    if (!isOpen) {
        return;
    }

    async function handleSave() {
        const gatekeeper = gatekeeperUrl.trim();
        const search = searchServerUrl.trim();
        if (!gatekeeper || !search) {
            setError("Both Gatekeeper URL and Search Server URL are required");
            return;
        }

        try {
            localStorage.setItem(GATEKEEPER_KEY, gatekeeper);
            localStorage.setItem(SEARCH_SERVER_KEY, search);
            await initialiseServices();
            await initialiseWallet();
            setSuccess("Services updated");
            await refreshAll();
        } catch (e: any) {
            setError(e);
        }
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
                <Heading size="sm">Services</Heading>
            </Flex>

            <Box as="main" flex="1" overflowY="auto" px={4}>
                <Field.Root mb={3}>
                    <Field.Label htmlFor="gatekeeper-url">Gatekeeper URL</Field.Label>
                    <Input
                        id="gatekeeper-url"
                        type="text"
                        value={gatekeeperUrl}
                        onChange={(e) => setGatekeeperUrl(e.target.value)}
                        placeholder={DEFAULT_GATEKEEPER_URL}
                    />
                </Field.Root>

                <Field.Root mb={3}>
                    <Field.Label htmlFor="search-server-url">Search Server URL</Field.Label>
                    <Input
                        id="search-server-url"
                        type="text"
                        value={searchServerUrl}
                        onChange={(e) => setSearchServerUrl(e.target.value)}
                        placeholder={DEFAULT_SEARCH_SERVER_URL}
                    />
                </Field.Root>

                <Box py={3}>
                    <Button width="100%" colorPalette="blue" onClick={handleSave}>
                        Save
                    </Button>
                </Box>
            </Box>
        </Box>
    );
}
