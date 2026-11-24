import React from "react";
import { Button, Dialog, Stack, Text } from "@chakra-ui/react";

interface OnboardingModalProps {
    isOpen: boolean;
    onNew: () => void;
    onImport: () => void;
}

const OnboardingModal: React.FC<OnboardingModalProps> = ({ isOpen, onNew, onImport }) => {
    return (
        <Dialog.Root open={isOpen}>
            <Dialog.Backdrop />
            <Dialog.Content>
                <Dialog.Header>
                    <Dialog.Title textAlign="center" flex="1">Welcome</Dialog.Title>
                    <Dialog.CloseTrigger />
                </Dialog.Header>
                <Dialog.Body>
                    <Stack gap={3} align="stretch">
                        <Text opacity={0.9} textAlign="center">Choose how you want to get started</Text>
                        <Button variant="ghost" size="lg" onClick={onNew}>New Wallet</Button>
                        <Button variant="ghost" size="lg" onClick={onImport}>Import Wallet</Button>
                    </Stack>
                </Dialog.Body>
            </Dialog.Content>
        </Dialog.Root>
    );
};

export default OnboardingModal;
