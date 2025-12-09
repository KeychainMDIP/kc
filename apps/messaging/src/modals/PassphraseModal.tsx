import React, { FormEvent, useState, useEffect } from "react";
import { Button, Input, Text, Field, Dialog } from "@chakra-ui/react";

interface PassphraseModalProps {
    isOpen: boolean,
    title: string,
    errorText: string,
    onSubmit: (passphrase: string) => void,
    onClose: () => void,
    encrypt: boolean,
}

const PassphraseModal: React.FC<PassphraseModalProps> = (
    {
        isOpen,
        title,
        errorText,
        onSubmit,
        onClose,
        encrypt
    }) => {
    const [passphrase, setPassphrase] = useState("");
    const [confirmPassphrase, setConfirmPassphrase] = useState("");
    const [localError, setLocalError] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const combinedError = localError || errorText || "";

    useEffect(() => {
        if (!isOpen) {
            setPassphrase("");
            setConfirmPassphrase("");
            setLocalError("");
        }
    }, [isOpen]);

    async function handleSubmit(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();
        if (submitting) {
            return;
        }

        setSubmitting(true);
        await new Promise(requestAnimationFrame);

        try {
            onSubmit(passphrase);
            setPassphrase("");
            setConfirmPassphrase("");
            setLocalError("");
        } finally {
            setSubmitting(false);
        }
    }

    const handleClose = () => {
        if (submitting) {
            return;
        }
        onClose();
    };

    function checkPassphraseMismatch(newPass: string, newConfirm: string) {
        if (!encrypt) {
            return;
        }
        if (!newPass || !newConfirm) {
            setLocalError("");
            return;
        }
        if (newPass !== newConfirm) {
            setLocalError("Passphrases do not match");
        } else {
            setLocalError("");
        }
    }

    function handlePassphraseChange(newValue: string) {
        setPassphrase(newValue);
        checkPassphraseMismatch(newValue, confirmPassphrase);
    }

    function handleConfirmChange(newValue: string) {
        setConfirmPassphrase(newValue);
        checkPassphraseMismatch(passphrase, newValue);
    }

    const isSubmitDisabled = () => {
        if (!passphrase) {
            return true;
        }
        if (encrypt) {
            if (!confirmPassphrase) {
                return true;
            }
            if (passphrase !== confirmPassphrase) {
                return true;
            }
        }
        return false;
    };

    const handleOpenChange = (e: { open: boolean }) => {
        if (!e.open) {
            handleClose();
        }
    };

    return (
        <Dialog.Root open={isOpen} onOpenChange={handleOpenChange}>
            <Dialog.Backdrop />
            <Dialog.Content>
                <Dialog.Header>
                    <Dialog.Title textAlign="center" flex="1">{title}</Dialog.Title>
                    <Dialog.CloseTrigger />
                </Dialog.Header>
                <Dialog.Body>
                    {combinedError && (
                        <Text color="red.500" mb={2}>{combinedError}</Text>
                    )}
                    <form onSubmit={handleSubmit} id="passphrase-form">
                        <Field.Root>
                            <Field.Label htmlFor="passphrase-field">Passphrase</Field.Label>
                            <Input
                                id="passphrase-field"
                                type="password"
                                value={passphrase}
                                onChange={(e) => handlePassphraseChange(e.target.value)}
                                required
                                disabled={submitting}
                            />
                        </Field.Root>

                        {encrypt && (
                            <Field.Root mt={3}>
                                <Field.Label htmlFor="confirm-passphrase-field">Confirm Passphrase</Field.Label>
                                <Input
                                    id="confirm-passphrase-field"
                                    type="password"
                                    value={confirmPassphrase}
                                    onChange={(e) => handleConfirmChange(e.target.value)}
                                    required
                                    disabled={submitting}
                                />
                            </Field.Root>
                        )}
                    </form>
                </Dialog.Body>
                <Dialog.Footer>
                    <Button
                        colorPalette="blue"
                        type="submit"
                        form="passphrase-form"
                        disabled={isSubmitDisabled()}
                    >
                        Submit
                    </Button>
                    {encrypt && (
                        <Button
                            variant="outline"
                            onClick={handleClose}
                            disabled={submitting}
                        >
                            Cancel
                        </Button>
                    )}
                </Dialog.Footer>
            </Dialog.Content>
        </Dialog.Root>
    );
};

export default PassphraseModal;
