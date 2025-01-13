import React, { useState } from "react";
import { usePopupContext } from "../PopupContext";
import {
    Button,
    Box,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogContentText,
    DialogActions,
} from "@mui/material";

function WalletTab() {
    const { refreshAll, keymaster, openBrowserTab, setError } =
        usePopupContext();
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);

    const handleClickOpen = () => {
        if (!loading) {
            setOpen(true);
        }
    };

    const handleClose = () => {
        setOpen(false);
    };

    const handleConfirm = async () => {
        setLoading(true);
        try {
            await keymaster.newWallet(null, true);
            await refreshAll();
        } catch (error) {
            setError(error.error || error);
        } finally {
            setOpen(false);
            setLoading(false);
        }
    };

    async function showWallet() {
        try {
            const wallet = await keymaster.loadWallet();
            openBrowserTab("Wallet", "", JSON.stringify(wallet, null, 4));
        } catch (error) {
            setError(error.error || error);
        }
    }

    return (
        <Box>
            <Dialog
                open={open}
                onClose={handleClose}
                disableEnforceFocus
                disableAutoFocus
                disableScrollLock
            >
                <DialogTitle id="confirm-dialog-title">
                    {"Overwrite Wallet?"}
                </DialogTitle>
                <DialogContent>
                    <DialogContentText id="confirm-dialog-description">
                        Are you sure you want to overwrite your existing wallet
                        with a new one? This action cannot be undone.
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button
                        onClick={handleClose}
                        color="primary"
                        disabled={loading}
                    >
                        Cancel
                    </Button>
                    <Button
                        onClick={handleConfirm}
                        color="primary"
                        disabled={loading}
                        autoFocus
                    >
                        Confirm
                    </Button>
                </DialogActions>
            </Dialog>
            <Box>
                <Button
                    className="mini-margin"
                    variant="contained"
                    color="primary"
                    onClick={handleClickOpen}
                >
                    New
                </Button>

                <Button
                    className="mini-margin"
                    variant="contained"
                    color="primary"
                    onClick={showWallet}
                >
                    Show
                </Button>
            </Box>
        </Box>
    );
}

export default WalletTab;
