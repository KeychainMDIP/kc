import React, { useEffect, useState } from "react";
import {
    Autocomplete,
    Box,
    Button,
    IconButton,
    MenuItem,
    Select,
    Tab,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Tabs,
    TextField, Tooltip,
    Typography,
} from "@mui/material";
import {
    ContentCopy,
    Inbox,
    MarkunreadMailbox,
    Send,
} from "@mui/icons-material";
import {DmailItem, DmailMessage} from '@mdip/keymaster/types';
import { useWalletContext } from "../../shared/contexts/WalletProvider";
import { useCredentialsContext } from "../../shared/contexts/CredentialsProvider";
import { useUIContext } from "../../shared/contexts/UIContext";

const DmailTab: React.FC = () => {
    const {
        keymaster,
        registries,
        setError,
        setSuccess,
    } = useWalletContext();
    const { agentList } = useCredentialsContext();
    const { handleCopyDID } = useUIContext();
    const [activeTab, setActiveTab] = useState<"inbox" | "receive" | "send">("inbox");
    const [registry, setRegistry] = useState<string>("hyperswarm");
    const [dmailList, setDmailList] = useState<Record<string, DmailItem>>({});
    const [selected, setSelected] = useState<DmailItem | null>(null);
    const [importDid, setImportDid] = useState<string>("");
    const [sendTo, setSendTo] = useState<string>("");
    const [sendSubject, setSendSubject] = useState<string>("");
    const [sendBody, setSendBody] = useState<string>("");
    const [dmailDid, setDmailDid] = useState<string>("");

    useEffect(() => {
        refreshInbox();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [keymaster]);

    async function refreshInbox() {
        if (!keymaster) {
            return;
        }
        try {
            const msgs = await keymaster.listDmail();
            setDmailList(msgs || {});
        } catch (err: any) {
            setError(err);
        }
    }

    async function handleImport() {
        if (!keymaster) {
            return;
        }
        try {
            const ok = await keymaster.importDmail(importDid);
            if (ok) {
                setSuccess("Dmail import successful");
                await refreshInbox();
                setImportDid("");
            } else {
                setError("Dmail import failed");
            }
        } catch (err: any) {
            setError(err);
        }
    }

    async function handleCreate() {
        if (!keymaster) {
            return;
        }
        try {
            const dmail: DmailMessage = {
                to: [sendTo],
                cc: [],
                subject: sendSubject,
                body: sendBody,
            };
            const did = await keymaster.createDmail(dmail, { registry });
            setDmailDid(did);
            setSuccess(`Draft created ${did}`);
        } catch (err: any) {
            setError(err);
        }
    }

    async function handleUpdate() {
        if (!keymaster || !dmailDid) {
            return;
        }
        try {
            const dmail: DmailMessage = {
                to: [sendTo],
                cc: [],
                subject: sendSubject,
                body: sendBody,
            };
            const ok = await keymaster.updateDmail(dmailDid, dmail);
            if (ok) {
                setSuccess("Dmail updated");
            } else {
                setError("Failed to update dmail");
            }
        } catch (err: any) {
            setError(err);
        }
    }

    async function handleSend() {
        if (!keymaster || !dmailDid) {
            return;
        }
        try {
            const ok = await keymaster.sendDmail(dmailDid);
            if (ok) {
                setSuccess("Dmail sent");
                setSendTo("");
                setSendSubject("");
                setSendBody("");
                setDmailDid("");
                await refreshInbox();
            } else {
                setError("Dmail send failed");
            }
        } catch (err: any) {
            setError(err);
        }
    }

    const renderInbox = () => (
        <Box display="flex" flexDirection="column" mt={1}>
            <Box>
                <TableContainer sx={{ maxHeight: 600 }}>
                    <Table size="small" stickyHeader>
                        <TableHead>
                            <TableRow>
                                <TableCell>Sender</TableCell>
                                <TableCell>Subject</TableCell>
                                <TableCell>Date</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {Object.entries(dmailList).map(([did, item]) => (
                                <TableRow
                                    key={did}
                                    hover
                                    selected={selected === item}
                                    onClick={() => setSelected(item)}
                                    sx={{ cursor: "pointer" }}
                                >
                                    <TableCell>{item.sender}</TableCell>
                                    <TableCell>{item.message.subject}</TableCell>
                                    <TableCell>{new Date(item.date).toLocaleString()}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </TableContainer>
            </Box>

            <Box flex={1}>
                {selected ? (
                    <Box sx={{ p: 2 }}>
                        <Box display="flex" alignItems="center" mb={1}>
                            <Typography variant="subtitle2" sx={{ mr: 1 }}>
                                To:
                            </Typography>
                            <Typography variant="body2" sx={{ wordBreak: "break-all" }}>
                                {selected.to.join(", ")}
                            </Typography>
                        </Box>
                        <Box display="flex" alignItems="center" mb={1}>
                            <Typography variant="subtitle2" sx={{ mr: 1 }}>
                                Subject:
                            </Typography>
                            <Typography variant="body2" sx={{ wordBreak: "break-all" }}>
                                {selected.message.subject}
                            </Typography>
                        </Box>
                        <TextField
                            value={selected.message.body}
                            multiline
                            minRows={10}
                            maxRows={30}
                            fullWidth
                            slotProps={{
                                input: {
                                    readOnly: true,
                                },
                            }}
                        />
                    </Box>
                ) : (
                    <Typography sx={{ p: 2 }}>No Dmail selected</Typography>
                )}
            </Box>
        </Box>
    );

    const renderReceive = () => (
        <Box mt={2}>
            <TableContainer>
                <Table size="small">
                    <TableBody>
                        <TableRow>
                            <TableCell>
                                <TextField
                                    label="Dmail DID"
                                    fullWidth
                                    value={importDid}
                                    onChange={(e) => setImportDid(e.target.value.trim())}
                                    slotProps={{
                                        htmlInput: {
                                            maxLength: 80,
                                        },
                                    }}
                                />
                            </TableCell>
                            <TableCell>
                                <Button
                                    variant="contained"
                                    onClick={handleImport}
                                    disabled={!importDid}
                                >
                                    Import
                                </Button>
                            </TableCell>
                        </TableRow>
                    </TableBody>
                </Table>
            </TableContainer>
        </Box>
    );

    const renderSend = () => (
        <Box mt={2}>
            <Box display="flex" flexDirection="column" gap={2}>
                <Autocomplete
                    freeSolo
                    options={agentList || []}
                    value={sendTo}
                    onInputChange={(_, v) => setSendTo(v.trim())}
                    renderInput={(params) => (
                        <TextField {...params} label="Recipient (name or DID)" fullWidth />
                    )}
                />

                <TextField
                    label="Subject"
                    fullWidth
                    value={sendSubject}
                    onChange={(e) => setSendSubject(e.target.value)}
                />

                <TextField
                    label="Message body"
                    multiline
                    minRows={8}
                    fullWidth
                    value={sendBody}
                    onChange={(e) => setSendBody(e.target.value)}
                />

                <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
                    <Select
                        size="small"
                        value={registry}
                        onChange={(e) => setRegistry(e.target.value)}
                        sx={{ minWidth: 150 }}
                    >
                        {registries.map((r) => (
                            <MenuItem key={r} value={r}>
                                {r}
                            </MenuItem>
                        ))}
                    </Select>

                    <Button
                        variant="contained"
                        onClick={handleCreate}
                        disabled={!sendTo || !sendBody || !sendSubject}
                    >
                        Create
                    </Button>

                    <Button variant="contained" onClick={handleUpdate} disabled={!dmailDid}>
                        Update
                    </Button>

                    <Button variant="contained" onClick={handleSend} disabled={!dmailDid}>
                        Send
                    </Button>
                </Box>

                {dmailDid && (
                    <Box display="flex" alignItems="center" gap={1}>
                        <Typography sx={{ fontFamily: 'monospace' }}>{dmailDid}</Typography>
                        <Tooltip title="Copy DID">
                            <IconButton
                                onClick={() => handleCopyDID(dmailDid)}
                                size="small"
                                sx={{ px: 0.5 }}
                            >
                                <ContentCopy fontSize="small" />
                            </IconButton>
                        </Tooltip>
                    </Box>
                )}
            </Box>
        </Box>
    );

    return (
        <Box>
            <Tabs
                value={activeTab}
                onChange={(_, v) => setActiveTab(v)}
                indicatorColor="primary"
                textColor="primary"
                variant="scrollable"
                scrollButtons="auto"
            >
                <Tab label="Inbox" value="inbox" icon={<Inbox />} />
                <Tab label="Receive" value="receive" icon={<MarkunreadMailbox />} />
                <Tab label="Send" value="send" icon={<Send />} />
            </Tabs>

            {activeTab === "inbox" && renderInbox()}
            {activeTab === "receive" && renderReceive()}
            {activeTab === "send" && renderSend()}
        </Box>
    );
};

export default DmailTab;
