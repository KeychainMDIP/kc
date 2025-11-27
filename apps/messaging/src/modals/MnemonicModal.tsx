import React, { MouseEvent, useEffect, useState } from "react";
import { Button, Text, Input, SimpleGrid, Dialog } from "@chakra-ui/react";

interface MnemonicModalProps {
    isOpen: boolean;
    onSubmit: (mnemonic: string) => void;
    onClose: () => void;
    errorText: string,
}

const MnemonicModal: React.FC<MnemonicModalProps> = ({ isOpen, onSubmit, onClose, errorText }) => {
    const [words, setWords] = useState<string[]>(Array(12).fill(""));

    const canConfirm = words.every((w) => w.trim().length > 0);

    const handleWordChange = (index: number, value: string) => {
        setWords((prev) => {
            const next = [...prev];
            next[index] = value;
            return next;
        });
    };

    const handleSubmit = (event: MouseEvent<HTMLButtonElement>) => {
        event.preventDefault();
        const mnemonic = words.map((w) => w.trim()).join(" ");
        onSubmit(mnemonic);
    };

    useEffect(() => {
        if (!isOpen) {
            setWords(Array(12).fill(""));
        }
    }, [isOpen]);

    return (
        <Dialog.Root open={isOpen}>
            <Dialog.Backdrop />
            <Dialog.Content>
                <Dialog.Header>
                    <Dialog.Title textAlign="center" flex="1">Import Mnemonic</Dialog.Title>
                    <Dialog.CloseTrigger />
                </Dialog.Header>
                <Dialog.Body>
                    {errorText && (
                        <Text color="red.500" mb={2}>{errorText}</Text>
                    )}
                    <Text textAlign="center" mb={3} opacity={0.9}>
                        Enter your 12-word mnemonic
                    </Text>
                    <SimpleGrid columns={3}>
                        {words.map((value, idx) => (
                            <Input
                                key={idx}
                                value={value}
                                onChange={(e) => handleWordChange(idx, e.target.value)}
                                placeholder={`Word ${idx + 1}`}
                                autoComplete="off"
                                inputMode="text"
                            />
                        ))}
                    </SimpleGrid>
                </Dialog.Body>
                <Dialog.Footer>
                    <Button onClick={handleSubmit} colorScheme="blue" disabled={!canConfirm}>
                        Confirm
                    </Button>
                    <Button variant="outline" onClick={onClose}>
                        Cancel
                    </Button>
                </Dialog.Footer>
            </Dialog.Content>
        </Dialog.Root>
    );
};

export default MnemonicModal;
