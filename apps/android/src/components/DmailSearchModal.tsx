import React, { useState } from "react";
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    TextField,
    Button,
    FormControlLabel,
    Checkbox,
} from "@mui/material";

export interface AdvancedSearchParams {
    from: string;
    to: string;
    subject: string;
    body: string;
    hasAttach: boolean;
}

interface Props {
    open: boolean;
    onClose: () => void;
    onSearch: (p: AdvancedSearchParams) => void;
}

const DmailSearchModal: React.FC<Props> = ({ open, onClose, onSearch }) => {
    const [from, setFrom] = useState<string>("");
    const [to, setTo] = useState<string>("");
    const [subject, setSubject] = useState<string>("");
    const [body, setBody] = useState<string>("");
    const [hasAtt, setHasAtt] = useState<boolean>(false);

    return (
        <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
            <DialogTitle>Advanced Search</DialogTitle>

            <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <TextField label="From" value={from} onChange={e => setFrom(e.target.value)}    fullWidth />
                <TextField label="To / CC" value={to} onChange={e => setTo(e.target.value)}      fullWidth />
                <TextField label="Subject" value={subject} onChange={e => setSubject(e.target.value)} fullWidth />
                <TextField
                    label="Body"
                    multiline
                    minRows={3}
                    fullWidth
                    value={body}
                    onChange={e => setBody(e.target.value)}
                />
                <FormControlLabel
                    control={<Checkbox checked={hasAtt} onChange={e => setHasAtt(e.target.checked)} />}
                    label="Has attachments"
                />
            </DialogContent>

            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                <Button
                    variant="contained"
                    onClick={() => onSearch({ from, to, subject, body, hasAttach: hasAtt })}
                >
                    Search
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default DmailSearchModal;
