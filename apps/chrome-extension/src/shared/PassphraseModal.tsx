import React, { FormEvent, useState } from "react";
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    TextField,
    Button,
    Typography,
    Box,
    CircularProgress,
} from "@mui/material";

interface PassphraseModalProps {
    isOpen: boolean,
    title: string,
    errorText: string,
    onSubmit: (passphrase: string) => void,
    onClose?: () => void,
    encrypt: boolean,
    showCancel?: boolean,
}

const PassphraseModal: React.FC<PassphraseModalProps> = (
    {
        isOpen,
        title,
        errorText,
        onSubmit,
        onClose,
        encrypt,
        showCancel = false
    }) => {
    const [passphrase, setPassphrase] = useState("");
    const [confirmPassphrase, setConfirmPassphrase] = useState("");
    const [localError, setLocalError] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const combinedError = localError || errorText || "";

    if (!isOpen) {
        return null;
    }

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
        } finally {
            setSubmitting(false);
        }
    }

    const handleClose = () => {
        if (submitting) {
            return;
        }
        setPassphrase("");
        setConfirmPassphrase("");
        setLocalError("");
        if (onClose) {
            onClose();
        }
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
        if (submitting) {
            return true;
        }
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

    return (
        <Dialog open={isOpen} onClose={handleClose}>
            <DialogTitle>{title}</DialogTitle>
            <DialogContent>
                {combinedError && (
                    <Box mb={2}>
                        <Typography color="error">{combinedError}</Typography>
                    </Box>
                )}
                <form onSubmit={handleSubmit} id="passphrase-form">
                    <TextField
                        label="Passphrase"
                        type="password"
                        value={passphrase}
                        onChange={(e) => handlePassphraseChange(e.target.value)}
                        required
                        autoFocus
                        fullWidth
                        variant="outlined"
                        margin="dense"
                        disabled={submitting}
                    />

                    {encrypt && (
                        <TextField
                            label="Confirm Passphrase"
                            type="password"
                            value={confirmPassphrase}
                            onChange={(e) =>
                                handleConfirmChange(e.target.value)
                            }
                            required
                            fullWidth
                            variant="outlined"
                            margin="dense"
                            disabled={submitting}
                        />
                    )}
                </form>
            </DialogContent>
            <DialogActions>
                {showCancel && (
                    <Button
                        onClick={handleClose}
                        variant="contained"
                        color="secondary"
                        disabled={submitting}
                    >
                        Cancel
                    </Button>
                )}
                <Button
                    type="submit"
                    form="passphrase-form"
                    variant="contained"
                    color="primary"
                    disabled={isSubmitDisabled()}
                    startIcon={submitting ? <CircularProgress size={18} /> : null}
                >
                    {submitting ? "Working" : "Submit"}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default PassphraseModal;
