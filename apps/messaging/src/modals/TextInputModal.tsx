import React, { useState, useEffect, useRef } from "react";
import { Button, Input, Text, Field, Dialog } from "@chakra-ui/react";

interface TextInputModalProps {
    isOpen: boolean;
    title: string;
    description?: string;
    confirmText?: string;
    defaultValue?: string;
    onSubmit: (value: string) => void;
    onClose?: () => void;
}

const TextInputModal: React.FC<TextInputModalProps> = (
    {
        isOpen,
        title,
        description,
        confirmText = "Confirm",
        defaultValue = "",
        onSubmit,
        onClose,
    }) => {
    const [value, setValue] = useState(defaultValue);
    const inputRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        if (isOpen) {
            setValue(defaultValue);
        }
    }, [isOpen, defaultValue]);

    const handleConfirm = (e: React.FormEvent) => {
        e.preventDefault();
        onSubmit(value.trim());
    };

    return (
        <Dialog.Root open={isOpen}>
            <Dialog.Backdrop />
            <Dialog.Content>
                <Dialog.Header>
                    <Dialog.Title textAlign="center" flex="1">{title}</Dialog.Title>
                    <Dialog.CloseTrigger />
                </Dialog.Header>
                <Dialog.Body>
                    <form id="text-input-form" onSubmit={handleConfirm}>
                        {description && (
                            <Text mb={2} textAlign="center" opacity={0.9}>{description}</Text>
                        )}
                        <Field.Root>
                            <Input
                                id="text-input-field"
                                ref={inputRef}
                                type="text"
                                value={value}
                                onChange={(e) => setValue(e.target.value)}
                            />
                        </Field.Root>
                    </form>
                </Dialog.Body>
                <Dialog.Footer>
                    {onClose && (
                        <Button variant="outline" onClick={onClose}>Cancel</Button>
                    )}
                    <Button colorScheme="blue" type="submit" form="text-input-form">{confirmText}</Button>
                </Dialog.Footer>
            </Dialog.Content>
        </Dialog.Root>
    );
};

export default TextInputModal;
