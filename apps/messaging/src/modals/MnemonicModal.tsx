import React, { MouseEvent, useEffect, useState } from "react";
import { Button, Text, Input, SimpleGrid, Dialog, HStack, IconButton } from "@chakra-ui/react";
import { LuCopy, LuEye, LuEyeOff } from "react-icons/lu";
import { useSnackbar } from "../contexts/SnackbarProvider";

interface MnemonicModalProps {
    isOpen: boolean;
    onSubmit?: (mnemonic: string) => void;
    onClose: () => void;
    errorText: string,
    mnemonic?: string,
}

const MnemonicModal: React.FC<MnemonicModalProps> = ({ isOpen, onSubmit, onClose, errorText, mnemonic }) => {
    const [words, setWords] = useState<string[]>(Array(12).fill(""));
    const [showWord, setShowWord] = useState<boolean[]>(Array(12).fill(false));
    const { setSuccess } = useSnackbar();

    const canConfirm = words.every((w) => w.trim().length > 0);

    const handleWordChange = (index: number, value: string) => {
        setWords((prev) => {
            const next = [...prev];
            next[index] = value;
            return next;
        });
    };

    const handleSubmit = (event: MouseEvent<HTMLButtonElement>) => {
        if (!onSubmit) {
            return;
        }
        event.preventDefault();
        const mnemonic = words.map((w) => w.trim()).join(" ");
        onSubmit(mnemonic);
    };

    useEffect(() => {
        if (!isOpen) {
            setWords(Array(12).fill(""));
            setShowWord(Array(12).fill(false));
            return;
        }
        if (mnemonic) {
            const parts = mnemonic.trim().split(/\s+/);
            const next = Array(12).fill("");
            for (let i = 0; i < Math.min(12, parts.length); i++) {
                next[i] = parts[i];
            }
            setWords(next);
            setShowWord(Array(12).fill(false));
        }
    }, [isOpen, mnemonic]);

    const toggleReveal = (index: number) => {
        setShowWord((prev) => {
            const next = [...prev];
            next[index] = !next[index];
            return next;
        });
    };

    const handleCopy = async () => {
        if (!mnemonic) {
            return;
        }
        try {
            await navigator.clipboard.writeText(mnemonic);
            setSuccess("Mnemonic copied");
        } catch {}
    };

    return (
        <Dialog.Root open={isOpen}>
            <Dialog.Backdrop />
            <Dialog.Content>
                <Dialog.Header>
                    <Dialog.Title textAlign="center" flex="1">{mnemonic ? "Your Mnemonic" : "Import Mnemonic"}</Dialog.Title>
                    <Dialog.CloseTrigger />
                </Dialog.Header>
                <Dialog.Body>
                    {errorText && (
                        <Text color="red.500" mb={2}>{errorText}</Text>
                    )}
                    <Text textAlign="center" mb={3} opacity={0.9}>
                        {mnemonic ? "Tap the eye to reveal each word or copy the full phrase" : "Enter your 12-word mnemonic"}
                    </Text>
                    <SimpleGrid columns={2} columnGap={3} rowGap={2}>
                        {words.map((value, idx) => (
                            <HStack key={idx} gap={2}>
                                <Text
                                    as="span"
                                    fontSize="xs"
                                    color="gray.500"
                                    minW="20px"
                                    textAlign="right"
                                >
                                    {idx + 1}.
                                </Text>
                                <Input
                                    flex="1"
                                    value={value}
                                    onChange={(e) => handleWordChange(idx, e.target.value)}
                                    placeholder={`Word ${idx + 1}`}
                                    autoComplete="off"
                                    inputMode="text"
                                    type={mnemonic ? (showWord[idx] ? "text" : "password") : "text"}
                                    readOnly={!!mnemonic}
                                />
                                {mnemonic && (
                                    <IconButton
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => toggleReveal(idx)}
                                    >
                                        {showWord[idx] ? <LuEyeOff /> : <LuEye />}
                                    </IconButton>
                                )}
                            </HStack>
                        ))}
                    </SimpleGrid>
                </Dialog.Body>
                <Dialog.Footer>
                    {!mnemonic && onSubmit &&
                        <Button onClick={handleSubmit} colorScheme="blue" disabled={!canConfirm}>
                            Confirm
                        </Button>
                    }
                    {mnemonic && (
                        <Button onClick={handleCopy}>
                            Copy <LuCopy />
                        </Button>
                    )}
                    <Button variant="outline" onClick={onClose}>
                        {mnemonic ? "Close" : "Cancel"}
                    </Button>
                </Dialog.Footer>
            </Dialog.Content>
        </Dialog.Root>
    );
};

export default MnemonicModal;
