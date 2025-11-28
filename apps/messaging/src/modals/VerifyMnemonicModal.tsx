import React, { useEffect, useMemo, useState } from "react";
import { Button, Dialog, HStack, Input, Stack, Text } from "@chakra-ui/react";

interface VerifyMnemonicModalProps {
    isOpen: boolean;
    mnemonic: string;
    onBack: () => void;
    onSuccess: () => void;
}

function pickThreeDistinct(maxExclusive: number): number[] {
    const set = new Set<number>();
    while (set.size < 3) {
        set.add(Math.floor(Math.random() * maxExclusive));
    }
    return Array.from(set).sort((a, b) => a - b);
}

const VerifyMnemonicModal: React.FC<VerifyMnemonicModalProps> = ({ isOpen, mnemonic, onBack, onSuccess }) => {
    const allWords = useMemo(() => mnemonic.trim().split(/\s+/).slice(0, 12), [mnemonic]);
    const [indices, setIndices] = useState<number[]>([]);
    const [inputs, setInputs] = useState<string[]>(["", "", ""]);

    useEffect(() => {
        if (!isOpen) {
            setInputs(["", "", ""]);
            return;
        }
        setIndices(pickThreeDistinct(12));
        setInputs(["", "", ""]);
    }, [isOpen]);

    const handleChange = (slot: number, val: string) => {
        setInputs((prev) => {
            const next = [...prev];
            next[slot] = val;
            return next;
        });
    };

    const isMatch = useMemo(() => {
        if (indices.length !== 3 || allWords.length !== 12) return false;
        return inputs.every((val, i) =>
            val.trim().toLowerCase() === (allWords[indices[i]] || "").toLowerCase()
        );
    }, [inputs, indices, allWords]);

    return (
        <Dialog.Root open={isOpen}>
            <Dialog.Backdrop />
            <Dialog.Content>
                <Dialog.Header>
                    <Dialog.Title textAlign="center" flex="1">Verify Your Mnemonic</Dialog.Title>
                    <Dialog.CloseTrigger onClick={onBack} />
                </Dialog.Header>
                <Dialog.Body>
                    <Stack gap={3}>
                        <Text textAlign="center" opacity={0.9}>
                            Please enter the requested words from your 12 word mnemonic to confirm you've saved it.
                        </Text>
                        {indices.map((wordIndex, i) => (
                            <HStack key={i} gap={2}>
                                <Text
                                    as="span"
                                    fontSize="xs"
                                    color="gray.500"
                                    minW="40px"
                                    textAlign="right"
                                >
                                    Word {wordIndex + 1}
                                </Text>
                                <Input
                                    flex="1"
                                    value={inputs[i]}
                                    placeholder={`Enter word ${wordIndex + 1}`}
                                    onChange={(e) => handleChange(i, e.target.value)}
                                    autoComplete="off"
                                    inputMode="text"
                                />
                            </HStack>
                        ))}
                    </Stack>
                </Dialog.Body>
                <Dialog.Footer>
                    <Button variant="outline" onClick={onBack}>Back</Button>
                    <Button colorScheme="blue" onClick={onSuccess} disabled={!isMatch}>Verify</Button>
                </Dialog.Footer>
            </Dialog.Content>
        </Dialog.Root>
    );
};

export default VerifyMnemonicModal;
