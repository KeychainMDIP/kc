import React, { useState, useEffect, useRef } from "react";
import BaseModal from "./BaseModal";
import { Button, Input, Text, Field } from "@chakra-ui/react";

interface TextInputModalProps {
    isOpen: boolean;
    title: string;
    description?: string;
    label?: string;
    confirmText?: string;
    defaultValue?: string;
    onSubmit: (value: string) => void;
    onClose: () => void;
}

const TextInputModal: React.FC<TextInputModalProps> = (
    {
        isOpen,
        title,
        description,
        label = "Name",
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
        <BaseModal
            isOpen={isOpen}
            title={title}
            onClose={onClose}
            initialFocusRef={inputRef as unknown as React.RefObject<HTMLElement>}
            actions={(
                <>
                    <Button variant="outline" onClick={onClose}>Cancel</Button>
                    <Button colorScheme="blue" type="submit" form="text-input-form">{confirmText}</Button>
                </>
            )}
        >
            <form id="text-input-form" onSubmit={handleConfirm}>
                {description && (
                    <Text mb={2} opacity={0.9}>{description}</Text>
                )}
                <Field.Root>
                    <Field.Label htmlFor="text-input-field">{label}</Field.Label>
                    <Input
                        id="text-input-field"
                        ref={inputRef}
                        type="text"
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                    />
                </Field.Root>
            </form>
        </BaseModal>
    );
};

export default TextInputModal;
