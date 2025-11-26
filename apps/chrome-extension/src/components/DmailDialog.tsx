import React, { useEffect, useState } from "react";
import {
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    TextField,
} from "@mui/material";
import { DmailMessage } from '@mdip/keymaster/types';

interface DmailDialogProps {
    open: boolean;
    onClose: () => void;
    dmail: DmailMessage | null;
}

function DmailDialog({ open, onClose, dmail } : DmailDialogProps) {
    const [toList, setToList] = useState<string[]>([]);
    const [ccList, setCcList] = useState<string[]>([]);
    const [subject, setSubject] = useState<string>('');
    const [body, setBody] = useState<string>('');

    useEffect(() => {
        setToList(dmail?.to || []);
        setCcList(dmail?.cc || []);
        setSubject(dmail?.subject || '');
        setBody(dmail?.body || '');
    }, [dmail, open]);

    const handleClose = () => {
        setToList([]);
        setCcList([]);
        setSubject('');
        setBody('')
        onClose();
    };

    return (
        <Dialog open={open} onClose={handleClose}>
            <DialogTitle>Dmail</DialogTitle>
            <DialogContent>
                <TextField
                    autoFocus
                    margin="dense"
                    label="To"
                    fullWidth
                    value={toList.join(', ')}
                    slotProps={{
                        input: {
                            readOnly: true,
                        },
                    }}
                />
                <TextField
                    autoFocus
                    margin="dense"
                    label="cc"
                    fullWidth
                    value={ccList.join(', ')}
                    slotProps={{
                        input: {
                            readOnly: true,
                        },
                    }}
                />
                <TextField
                    margin="dense"
                    label="Subject"
                    fullWidth
                    value={subject}
                    slotProps={{
                        input: {
                            readOnly: true,
                        },
                    }}
                />
                <TextField
                    margin="dense"
                    label="Body"
                    fullWidth
                    multiline
                    minRows={10}
                    maxRows={30}
                    value={body}
                    slotProps={{
                        input: {
                            readOnly: true,
                        },
                    }}
                />
            </DialogContent>
            <DialogActions>
                <Button onClick={handleClose} variant="contained" color="primary">Close</Button>
            </DialogActions>
        </Dialog>
    );
}

export default DmailDialog;
