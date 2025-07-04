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
    Send,
} from "@mui/icons-material";
import {DmailItem, DmailMessage} from '@mdip/keymaster/types';
import { useWalletContext } from "../../shared/contexts/WalletProvider";
import { useCredentialsContext } from "../../shared/contexts/CredentialsProvider";
import { useUIContext } from "../../shared/contexts/UIContext";
import TextInputModal from "../../shared/TextInputModal";

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
    const [sendTo, setSendTo] = useState<string>("");
    const [sendSubject, setSendSubject] = useState<string>("");
    const [sendBody, setSendBody] = useState<string>("");
    const [dmailDid, setDmailDid] = useState<string>("");
    const [importModalOpen, setImportModalOpen] = useState(false);

    useEffect(() => {
        refreshInbox();

        const interval = setInterval(() => {
            refreshInbox();
        }, 30000);

        return () => clearInterval(interval);

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [keymaster]);

    async function refreshInbox() {
        if (!keymaster) {
            return;
        }
        try {
            const msgs = await keymaster.listDmail();
            if (JSON.stringify(msgs) !== JSON.stringify(dmailList)) {
                setDmailList(msgs || {});
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
                setSuccess("DMail sent");
                await refreshInbox();
            } else {
                setError("DMail send failed");
            }
        } catch (err: any) {
            setError(err);
        }
    }

    async function handleRefresh() {
        if (!keymaster) {
            return;
        }
        try {
            await keymaster.refreshNotices();
            await refreshInbox();
            setSuccess("Refreshed");
        } catch (err: any) {
            setError(err);
        }
    }

    async function handleImportModalSubmit(did: string) {
        setImportModalOpen(false);
        if (!did.trim() || !keymaster) {
            return;
        }
        try {
            const ok = await keymaster.importDmail(did.trim());
            if (ok) {
                setSuccess("DMail import successful");
                await refreshInbox();
            } else {
                setError("DMail import failed");
            }
        } catch (err: any) {
            setError(err);
        }
    }

    const renderInbox = () => (
        <Box display="flex" flexDirection="column" mt={1}>
            <Box sx={{ mt: 1, mb: 1, display: "flex", gap: 1 }}>
                <Button variant="outlined" onClick={handleRefresh}>
                    Refresh
                </Button>

                <Button variant="outlined" onClick={() => setImportModalOpen(true)}>
                    Import DID
                </Button>
            </Box>
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
                    <Typography sx={{ p: 2 }}>No DMail selected</Typography>
                )}
            </Box>
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
            <TextInputModal
                isOpen={importModalOpen}
                title="Import DMail"
                description="Paste the DMail DID to import"
                label="DID"
                confirmText="Import"
                onSubmit={handleImportModalSubmit}
                onClose={() => setImportModalOpen(false)}
            />

            <Tabs
                value={activeTab}
                onChange={(_, v) => setActiveTab(v)}
                indicatorColor="primary"
                textColor="primary"
                variant="scrollable"
                scrollButtons="auto"
            >
                <Tab label="Inbox" value="inbox" icon={<Inbox />} />
                <Tab label="Send" value="send" icon={<Send />} />
            </Tabs>

            {activeTab === "inbox" && renderInbox()}
            {activeTab === "send" && renderSend()}
        </Box>
    );
};

export default DmailTab;
