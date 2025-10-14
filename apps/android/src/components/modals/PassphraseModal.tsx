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
} from "@mui/material";
import { useThemeContext } from "../../contexts/ContextProviders";

interface PassphraseModalProps {
    isOpen: boolean,
    title: string,
    errorText: string,
    onSubmit: (passphrase: string) => void,
    encrypt: boolean,
}

const PassphraseModal: React.FC<PassphraseModalProps> = (
    {
        isOpen,
        title,
        errorText,
        onSubmit,
        encrypt
    }) => {
    const [passphrase, setPassphrase] = useState("");
    const [confirmPassphrase, setConfirmPassphrase] = useState("");
    const [localError, setLocalError] = useState("");
    const combinedError = localError || errorText || "";
    const { isTabletUp } = useThemeContext();

    if (!isOpen) {
        return null;
    }

    function handleSubmit(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();
        onSubmit(passphrase);
        handleClose();
    }

    const handleClose = () => {
        setPassphrase("");
        setConfirmPassphrase("");
        setLocalError("");
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
        if (!passphrase) return true;
        if (encrypt) {
            if (!confirmPassphrase) return true;
            if (passphrase !== confirmPassphrase) return true;
        }
        return false;
    };

    return (
        <Dialog
            open={isOpen}
            onClose={handleClose}
            maxWidth="lg"
            fullWidth
            slotProps={{
                paper: {
                    sx: {
                        width: isTabletUp ? '50%' : '100%'
                    }
                }
            }}
        >
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
                        />
                    )}
                </form>
            </DialogContent>
            <DialogActions>
                <Button
                    type="submit"
                    form="passphrase-form"
                    variant="contained"
                    color="primary"
                    disabled={isSubmitDisabled()}
                >
                    Submit
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default PassphraseModal;
