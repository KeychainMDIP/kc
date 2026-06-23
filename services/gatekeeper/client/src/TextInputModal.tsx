import React, { useState, useEffect } from "react";
import type { FormEvent } from "react";
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    DialogContentText,
    TextField,
} from "@mui/material";

type TextInputModalProps = {
    isOpen: boolean;
    title: string;
    description?: string;
    label?: string;
    confirmText?: string;
    defaultValue?: string;
    onSubmit: (value: string) => void | Promise<void>;
    onClose: () => void;
};

const TextInputModal = (
    {
        isOpen,
        title,
        description = "",
        label = "Name",
        confirmText = "Confirm",
        defaultValue = "",
        onSubmit,
        onClose,
    }: TextInputModalProps) => {
    const [value, setValue] = useState<string>(defaultValue);

    useEffect(() => {
        if (isOpen) {
            setValue(defaultValue);
        }
    }, [isOpen, defaultValue]);

    const handleConfirm = (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        onSubmit(value.trim());
    };

    return (
        <Dialog open={isOpen} onClose={onClose}>
            <form onSubmit={handleConfirm}>
                <DialogTitle>{title}</DialogTitle>
                <DialogContent>
                    {description && (
                        <DialogContentText>{description}</DialogContentText>
                    )}
                    <TextField
                        autoFocus
                        margin="dense"
                        label={label}
                        type="text"
                        fullWidth
                        variant="outlined"
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={onClose} color="primary">
                        Cancel
                    </Button>
                    <Button type="submit" variant="contained" color="primary">
                        {confirmText}
                    </Button>
                </DialogActions>
            </form>
        </Dialog>
    );
};

export default TextInputModal;
