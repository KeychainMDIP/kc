import React, {ChangeEvent, useEffect, useState} from "react";
import {
    Autocomplete,
    Box,
    Button,
    Checkbox,
    FormControlLabel,
    IconButton,
    InputAdornment,
    MenuItem,
    Select,
    Tab,
    Tabs,
    TextField,
    Tooltip,
    Typography,
} from "@mui/material";
import {
    AllInbox,
    Archive,
    Clear,
    Delete,
    Drafts,
    Inbox,
    Outbox,
    Refresh,
    Search,
    Send,
    Tune,
    UploadFile,
    Reply,
    ReplyAll,
    Forward,
    Unarchive,
    RestoreFromTrash,
    Edit,
    PersonAdd,
    Link,
} from "@mui/icons-material";
import {DmailItem, DmailMessage} from '@mdip/keymaster/types';
import { useWalletContext } from "../contexts/WalletProvider";
import { useCredentialsContext } from "../contexts/CredentialsProvider";
import { useUIContext } from "../contexts/UIContext";
import TextInputModal from "./TextInputModal";
import WarningModal from "./WarningModal";
import CopyResolveDID from "./CopyResolveDID";
import CopyDID from "./CopyDID";
import DmailSearchModal, { AdvancedSearchParams } from "./DmailSearchModal";
import DisplayDID from "./DisplayDID";

const DmailTab: React.FC = () => {
    const [registry, setRegistry] = useState<string>("hyperswarm");
    const [selected, setSelected] = useState<DmailItem & { did: string } | null>(null);
    const [sendTo, setSendTo] = useState<string>("");
    const [sendSubject, setSendSubject] = useState<string>("");
    const [sendBody, setSendBody] = useState<string>("");
    const [dmailDid, setDmailDid] = useState<string>("");
    const [importModalOpen, setImportModalOpen] = useState(false);
    const [sendCc, setSendCc] = useState<string>("");
    const [sendToList, setSendToList] = useState<string[]>([]);
    const [sendCcList, setSendCcList] = useState<string[]>([]);
    const [dmailAttachments, setDmailAttachments] = useState<Record<string, any>>({});
    const [revokeOpen, setRevokeOpen] = useState<boolean>(false);
    const [searchQuery, setSearchQuery] = useState<string>("");
    const [searchResults, setSearchResults] = useState<Record<string, DmailItem>>({});
    const [advancedOpen,  setAdvancedOpen]  = useState<boolean>(false);
    const [forwardSourceDid, setForwardSourceDid] = useState<string | null>(null);
    const [ephemeral, setEphemeral] = useState<boolean>(false);
    const [expiresAt, setExpiresAt] = useState<string>("");
    const [dmailReference, setDmailReference] = useState<string>("");
    const {
        currentId,
        keymaster,
        registries,
        setError,
        setSuccess,
    } = useWalletContext();
    const {
        agentList,
        dmailList,
    } = useCredentialsContext();
    const {
        getVaultItemIcon,
        refreshInbox,
        setOpenBrowser
    } = useUIContext();

    const TAG = {
        inbox: "inbox",
        sent: "sent",
        draft: "draft",
        archived: "archived",
        deleted: "deleted",
        unread: "unread"
    };
    type Folder = "inbox" | "outbox" | "drafts" | "archive" | "trash" | "all" | "send" | "results";

    const [activeTab, setActiveTab] = useState<Folder>("inbox");

    async function fileTags(did:string,newTags:string[]) {
        if (!keymaster) {
            return;
        }
        await keymaster.fileDmail(did,newTags);
        await refreshInbox();
    }

    const archive = async () => {
        if (!selected) {
            return;
        }
        const { did, tags = [] } = selected;
        setSelected(null);
        await fileTags(did, [...tags, TAG.archived]);
    };

    const unarchive = async () => {
        if (!selected) {
            return;
        }
        const { did, tags = [] } = selected;
        setSelected(null);
        await fileTags(did, tags.filter(t => t !== TAG.archived));
    };

    const del = async () => {
        if (!selected) {
            return;
        }
        const { did, tags = [] } = selected;
        setSelected(null);
        await fileTags(did, [...tags, TAG.deleted]);
    };

    const undelete = async () => {
        if (!selected) {
            return;
        }
        const { did, tags = [] } = selected;
        setSelected(null);
        await fileTags(did, tags.filter(t => t !== TAG.deleted));
    };

    useEffect(() => {
        refreshInbox();

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [keymaster, currentId]);

    useEffect(() => {
        const scroller = document.getElementById("contentScroll");
        scroller?.scrollTo({ top: 0, behavior: "auto" });
    }, [activeTab]);

    async function handleCreate() {
        if (!keymaster) {
            return;
        }

        const dmail = getDmailInputOrError();
        if (!dmail) {
            return;
        }

        if (ephemeral) {
            if (registry !== "hyperswarm") {
                setError("Ephemeral DMail is only supported on hyperswarm");
                return;
            }
            if (!expiresAt || !isFutureDate(expiresAt)) {
                setError("Choose a future expiration date");
                return;
            }
        }

        const opts = ephemeral
            ? { registry, validUntil: new Date(expiresAt).toISOString() }
            : { registry };

        try {
            const did = await keymaster.createDmail(dmail, opts);
            setDmailDid(did);

            const pendingAtt = { ...dmailAttachments };

            if (forwardSourceDid && Object.keys(pendingAtt).length) {
                for (const name of Object.keys(pendingAtt)) {
                    const buf = await keymaster.getDmailAttachment(forwardSourceDid, name);
                    if (buf) {
                        await keymaster.addDmailAttachment(did, name, buf);
                    }
                }
            }

            setForwardSourceDid(null);
            setDmailAttachments(pendingAtt);
            refreshDmailAttachments().catch(() => undefined);
            setSuccess(`Draft created ${did}`);
        } catch (err: any) {
            setError(err);
        }
    }

    const confirmRevoke = async () => {
        if (!keymaster || !dmailDid) {
            setRevokeOpen(false);
            return;
        }
        try {
            await keymaster.removeDmail(dmailDid);
            await keymaster.revokeDID(dmailDid);
            await refreshInbox();
            clearAll();
            setSuccess("DMail revoked");
        } catch (err: any) {
            setError(err);
        }
        setRevokeOpen(false);
    };

    function getDmailInputOrError() {
        if (!sendTo && sendToList.length === 0) {
            setError("Add at least one recipient");
            return null;
        }

        if (!sendSubject) {
            setError("Please enter a subject for the Dmail");
            return null;
        }

        if (!sendBody) {
            setError("Please enter a body for the Dmail");
            return null;
        }

        const toList = [sendTo, ...sendToList].map(s => s.trim()).filter(Boolean);
        const ccList = [sendCc, ...sendCcList].map(s => s.trim()).filter(Boolean);

        return {
            to: toList,
            cc: ccList,
            subject: sendSubject,
            body: sendBody,
            reference: dmailReference || undefined,
        };
    }

    async function handleUpdate() {
        if (!keymaster || !dmailDid) {
            return;
        }

        const dmail = getDmailInputOrError();
        if (!dmail) {
            return;
        }

        try {
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

    function openCompose(prefill: Partial<DmailMessage>) {
        setActiveTab("send");
        setDmailDid("");
        setSendTo("");
        setSendCc("");
        setSendToList(prefill.to ?? []);
        setSendCcList(prefill.cc ?? []);
        setSendSubject(prefill.subject || "");
        setSendBody(prefill.body || "");
        setEphemeral(false);
        setExpiresAt("");
        setDmailReference(prefill.reference || "");
    }

    function handleForward() {
        if (!selected) {
            return;
        }
        openCompose({
            subject: `Fwd: ${selected.message.subject}`,
            body: `\n\n----- Forwarded message -----\n${selected.message.body}`,
        });
        setDmailAttachments(selected.attachments ?? {});
        setForwardSourceDid(selected.did);
    }

    function handleReply(replyAll = false) {
        if (!selected) {
            return;
        }

        const toList = [selected.sender];
        const ccList = replyAll
            ? [...selected.to, ...selected.cc].filter(did => did !== selected.sender)
            : [];

        openCompose({
            to: toList,
            cc: ccList,
            subject: `Re: ${selected.message.subject}`,
            body: `\n\n----- Original message -----\n${selected.message.body}`,
            reference: selected.did,
        });
    }

    function clearAll() {
        setSendTo("");
        setSendCc("");
        setSendToList([]);
        setSendCcList([]);
        setSendSubject("");
        setSendBody("");
        setDmailDid("");
        setDmailAttachments({});
        setForwardSourceDid(null);
        setEphemeral(false);
        setExpiresAt("");
        setDmailReference("");
    }

    function filteredList(): Record<string, DmailItem> {
        if (activeTab === "all" || activeTab === "send") {
            return dmailList;
        }

        if (activeTab === "results") {
            return searchResults;
        }

        const out: Record<string, DmailItem> = {};
        for (const [did, itm] of Object.entries(dmailList)) {
            const has = (t:string)=>itm.tags?.includes(t);
            const not = (t:string)=>!itm.tags?.includes(t);
            switch (activeTab) {
            case "inbox":
                if (has(TAG.inbox)  && not(TAG.archived) && not(TAG.deleted)) {
                    out[did] = itm;
                }
                break;
            case "outbox":
                if (has(TAG.sent) && not(TAG.archived) && not(TAG.deleted)) {
                    out[did] = itm;
                }
                break;
            case "drafts":
                if (has(TAG.draft) && not(TAG.archived) && not(TAG.deleted)) {
                    out[did] = itm;
                }
                break;
            case "archive":
                if (has(TAG.archived) && not(TAG.deleted)) {
                    out[did] = itm;
                }
                break;
            case "trash":
                if (has(TAG.deleted)) {
                    out[did] = itm;
                }
                break;
            }
        }
        return out;
    }

    useEffect(() => {
        if (dmailDid) {
            refreshDmailAttachments();
        } else {
            setDmailAttachments({});
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dmailDid]);

    async function refreshDmailAttachments() {
        if (!keymaster || !dmailDid) {
            return;
        }

        try {
            const attachments = await keymaster.listDmailAttachments(dmailDid) || {};
            setDmailAttachments(attachments);
            if (dmailList[dmailDid]) {
                dmailList[dmailDid].attachments = attachments;
            }
        } catch (error: any) {
            setError(error);
        }
    }

    async function uploadDmailAttachment(event: ChangeEvent<HTMLInputElement>) {
        if (!keymaster) {
            return;
        }

        try {
            const fileInput = event.target;
            if (!fileInput.files || fileInput.files.length === 0) {
                return;
            }

            const file = fileInput.files[0];
            fileInput.value = "";

            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    if (!e.target || !e.target.result) {
                        setError("Unexpected file reader result");
                        return;
                    }
                    const arrayBuffer = e.target.result;
                    let buffer: Buffer;
                    if (arrayBuffer instanceof ArrayBuffer) {
                        buffer = Buffer.from(arrayBuffer);
                    } else {
                        setError("Unexpected file reader result type");
                        return;
                    }

                    const ok = await keymaster.addDmailAttachment(dmailDid, file.name, buffer);

                    if (ok) {
                        setSuccess(`Attachment uploaded successfully: ${file.name}`);
                        await refreshDmailAttachments();
                    } else {
                        setError(`Error uploading file: ${file.name}`);
                    }
                } catch (error) {
                    setError(`Error uploading file: ${error}`);
                }
            };

            reader.onerror = (error) => {
                setError(`Error uploading file: ${error}`);
            };

            reader.readAsArrayBuffer(file);
        } catch (error) {
            setError(`Error uploading file: ${error}`);
        }
    }

    async function removeDmailAttachment(name: string) {
        if (!keymaster || !dmailDid) {
            return;
        }

        try {
            await keymaster.removeDmailAttachment(dmailDid, name);
            await refreshDmailAttachments();
        } catch (error: any) {
            setError(error);
        }
    }

    async function editDmail(selected: DmailItem & { did: string }) {
        setSendTo("");
        setSendCc("");
        setSendToList(selected.to);
        setSendCcList(selected.cc);
        setSendSubject(selected.message.subject);
        setSendBody(selected.message.body);
        setDmailDid(selected.did);
        setDmailReference(selected.message.reference || "");
        await refreshDmailAttachments();
        setActiveTab("send");
    }

    async function downloadDmailAttachment(name: string) {
        if (!keymaster || !selected?.did) {
            return;
        }

        try {
            const buffer = await keymaster.getDmailAttachment(selected.did, name);

            if (!buffer) {
                setError(`Attachment ${name} not found in DMail ${selected.did}`);
                return;
            }

            // Create a Blob from the buffer
            const blob = new Blob([buffer]);
            // Create a temporary link to trigger the download
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = name; // Use the item name as the filename
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(link.href);
        } catch (error: any) {
            setError(error);
        }
    }

    async function markAsRead(did: string, tags: string[] = []) {
        if (!keymaster || !tags.includes(TAG.unread)) {
            return;
        }
        await fileTags(did, tags.filter(t => t !== TAG.unread));
        await refreshInbox();
    }

    function runSimpleSearch(term: string) {
        const q = term.trim().toLowerCase();
        const res: Record<string, DmailItem> = {};

        if (!q) {
            setSearchResults(res);
            return;
        }

        Object.entries(dmailList).forEach(([did, itm]) => {
            const body = itm.message.body.toLowerCase();
            const subj = itm.message.subject.toLowerCase();
            const from = itm.sender.toLowerCase();
            const tocc = [...itm.to, ...(itm.cc ?? [])].join(", ").toLowerCase();

            if (body.includes(q) || subj.includes(q) || from.includes(q) || tocc.includes(q)) {
                res[did] = itm;
            }
        });

        setSearchResults(res);
        setActiveTab("results");
    }

    function runAdvancedSearch(p: AdvancedSearchParams) {
        const res: Record<string, DmailItem> = {};

        Object.entries(dmailList).forEach(([did, itm]) => {
            if (p.from && !itm.sender.toLowerCase().includes(p.from.toLowerCase())) {
                return;
            }
            if (p.to) {
                const tocc = [...itm.to, ...(itm.cc ?? [])].join(", ").toLowerCase();
                if (!tocc.includes(p.to.toLowerCase())) {
                    return;
                }
            }
            if (p.subject && !itm.message.subject.toLowerCase().includes(p.subject.toLowerCase())) {
                return;
            }
            if (p.body && !itm.message.body.toLowerCase().includes(p.body.toLowerCase())) {
                return;
            }
            if (p.hasAttach && (!itm.attachments || Object.keys(itm.attachments).length === 0)) {
                return;
            }

            res[did] = itm;
        });

        setSearchResults(res);
        setAdvancedOpen(false);
        setActiveTab("results");
    }

    function isFutureDate(isoLocal: string) {
        const d = new Date(isoLocal);
        return !Number.isNaN(d.getTime()) && d.getTime() > Date.now();
    }

    useEffect(() => {
        if (registry !== "hyperswarm") {
            setEphemeral(false);
            setExpiresAt("");
        }
    }, [registry]);

    function addDmailContact(senderDid: string) {
        if (!senderDid.startsWith('did:')) {
            return;
        }
        setOpenBrowser({
            did: senderDid,
            tab: "names",
        });
    }

    function openReferencedMessage(did: string) {
        const item = dmailList[did];
        if (!item) {
            setError(`Referenced message not found: ${did}`);
            return;
        }
        setSelected({ ...item, did });
    }

    function shortDateOrTime(iso: string) {
        const d = new Date(iso);
        const today = new Date();
        return d.toDateString() === today.toDateString()
            ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
            : d.toLocaleDateString();
    }

    function classifyFolder(item: DmailItem): Folder {
        const tags = item.tags ?? [];

        if (tags.includes(TAG.deleted)) {
            return "trash";
        }
        if (tags.includes(TAG.archived)) {
            return "archive";
        }
        if (tags.includes(TAG.draft)) {
            return "drafts";
        }
        if (tags.includes(TAG.sent)) {
            return "outbox";
        }
        if (tags.includes(TAG.inbox)) {
            return "inbox";
        }

        return "all";
    }

    const cat: Folder = activeTab === "results" && selected ? classifyFolder(selected) : activeTab;

    const renderInbox = () => {
        const list = filteredList();
        const entries = Object.entries(list)
            .sort(([, a], [, b]) => new Date(b.date).getTime() - new Date(a.date).getTime());

        const emptyText: Record<Folder, string> = {
            inbox:   "Your inbox is empty.",
            outbox:  "No sent mail yet.",
            drafts:  "No drafts saved.",
            archive: "No archived mail.",
            trash:   "Trash is empty.",
            all:     "No messages to show.",
            send:    "",
            results: "No results found.",
        };

        if (entries.length === 0) {
            return (
                <Box display="flex" flexDirection="column" alignItems="center" justifyContent="center" py={6} sx={{ color: "text.secondary" }}>
                    {activeTab === "inbox" && <Inbox fontSize="large" />}
                    {activeTab === "outbox" && <Outbox fontSize="large" />}
                    {activeTab === "drafts" && <Drafts fontSize="large" />}
                    {activeTab === "archive" && <Archive fontSize="large" />}
                    {activeTab === "trash" && <Delete fontSize="large" />}
                    {activeTab === "all" && <AllInbox fontSize="large" />}
                    {activeTab === "results" && <Search fontSize="large" />}
                    <Typography sx={{ mt: 1 }}>{emptyText[activeTab]}</Typography>
                </Box>
            );
        }

        return (
            <Box display="flex" flexDirection="column" mt={1}>
                <Box>
                    {entries.map(([did, item]) => {
                        const unread = item.tags?.includes(TAG.unread);
                        const isSelected = selected?.did === did;
                        return (
                            <Box
                                key={did}
                                onClick={() => {
                                    setSelected({ ...item, did });
                                    markAsRead(did, item.tags);
                                }}
                                sx={{
                                    px: 1,
                                    py: 1,
                                    borderRadius: 1,
                                    cursor: "pointer",
                                    bgcolor: isSelected ? "action.selected" : "transparent",
                                    "&:hover": { bgcolor: "action.hover" },
                                }}
                            >
                                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                                    <Typography
                                        sx={{
                                            flex: 1,
                                            minWidth: 0,
                                            overflow: "hidden",
                                            textOverflow: "ellipsis",
                                            whiteSpace: "nowrap",
                                            fontWeight: unread ? 600 : 400,
                                        }}
                                    >
                                        {item.sender}
                                    </Typography>
                                    <Typography
                                        sx={{
                                            ml: 1,
                                            whiteSpace: "nowrap",
                                            color: "text.secondary",
                                            fontWeight: unread ? 600 : 400,
                                        }}
                                    >
                                        {shortDateOrTime(item.date)}
                                    </Typography>
                                </Box>

                                <Typography
                                    sx={{
                                        mt: 0.25,
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        whiteSpace: "nowrap",
                                        fontWeight: unread ? 600 : 400,
                                    }}
                                >
                                    {item.message.subject}
                                </Typography>
                            </Box>
                        );
                    })}
                </Box>

                <Box flex={1}>
                    {selected && (
                        <Box sx={{mt: 2}}>
                            <DisplayDID did={selected.did} />

                            <Box sx={{my: 1}}>
                                {cat === "inbox" && (
                                    <Box sx={{gap: 0.5, display: "flex", flexDirection: "row"}}>
                                        <Tooltip title="Forward">
                                            <IconButton onClick={handleForward}><Forward/></IconButton>
                                        </Tooltip>
                                        <Tooltip title="Reply">
                                            <IconButton onClick={() => handleReply(false)}><Reply/></IconButton>
                                        </Tooltip>
                                        <Tooltip title="Reply all">
                                            <IconButton onClick={() => handleReply(true)}><ReplyAll/></IconButton>
                                        </Tooltip>
                                        <Tooltip title="Archive">
                                            <IconButton onClick={archive}><Archive/></IconButton>
                                        </Tooltip>
                                        <Tooltip title="Delete">
                                            <IconButton onClick={del}><Delete/></IconButton>
                                        </Tooltip>
                                    </Box>
                                )}

                                {(cat === "outbox" || cat === "drafts") && (
                                    <Box sx={{gap: 0.5, display: "flex", flexDirection: "row"}}>
                                        <Tooltip title="Edit">
                                            <IconButton onClick={() => editDmail(selected)}><Edit/></IconButton>
                                        </Tooltip>
                                        <Tooltip title="Archive">
                                            <IconButton onClick={archive}><Archive/></IconButton>
                                        </Tooltip>
                                        <Tooltip title="Delete">
                                            <IconButton onClick={del}><Delete/></IconButton>
                                        </Tooltip>
                                    </Box>
                                )}

                                {cat === "archive" && (
                                    <Box sx={{gap: 0.5, display: "flex", flexDirection: "row"}}>
                                        <Tooltip title="Unarchive">
                                            <IconButton onClick={unarchive}><Unarchive/></IconButton>
                                        </Tooltip>
                                        <Tooltip title="Delete">
                                            <IconButton onClick={del}><Delete/></IconButton>
                                        </Tooltip>
                                    </Box>
                                )}

                                {cat === "trash" && (
                                    <Box sx={{gap: 0.5, display: "flex", flexDirection: "row"}}>
                                        <Tooltip title="Restore">
                                            <IconButton onClick={undelete}><RestoreFromTrash/></IconButton>
                                        </Tooltip>
                                    </Box>
                                )}
                            </Box>

                            <Box display="flex" alignItems="center" mb={1}>
                                <Typography variant="subtitle2" sx={{mr: 1}}>
                                    To:
                                </Typography>
                                <Typography variant="body2" sx={{wordBreak: "break-all"}}>
                                    {selected.to.join(", ")}
                                </Typography>
                            </Box>

                            <Box display="flex" alignItems="center" mb={1}>
                                <Typography variant="subtitle2" sx={{mr: 1}}>
                                    Cc:
                                </Typography>
                                <Typography variant="body2" sx={{wordBreak: "break-all"}}>
                                    {selected.cc?.join(", ")}
                                </Typography>
                            </Box>

                            <Box display="flex" alignItems="center" mb={1}>
                                <Typography variant="subtitle2" sx={{mr: 1}}>
                                    From:
                                </Typography>
                                <Typography variant="body2" sx={{wordBreak: "break-all"}}>
                                    {selected.sender}
                                </Typography>
                                {selected.sender.startsWith('did:') && (
                                    <Tooltip title="Add contact">
                                        <IconButton
                                            size="small"
                                            sx={{ml: 1}}
                                            onClick={() => addDmailContact(selected.sender)}
                                        >
                                            <PersonAdd/>
                                        </IconButton>
                                    </Tooltip>
                                )}
                            </Box>

                            <Box display="flex" alignItems="center" mb={1}>
                                <Typography variant="subtitle2" sx={{mr: 1}}>
                                    Date:
                                </Typography>
                                <Typography variant="body2" sx={{wordBreak: "break-all"}}>
                                    {new Date(selected.date).toLocaleString()}
                                </Typography>
                            </Box>

                            <Box display="flex" alignItems="center" mb={1}>
                                <Typography variant="subtitle2" sx={{mr: 1}}>
                                    Subject:
                                </Typography>
                                <Typography variant="body2" sx={{wordBreak: "break-all"}}>
                                    {selected.message.subject}
                                </Typography>
                            </Box>

                            {selected.message.reference && (
                                <Box display="flex" alignItems="center" mb={1}>
                                    <Typography variant="subtitle2" sx={{mr: 1}}>
                                        Reference:
                                    </Typography>
                                    <Typography variant="body2">
                                        {selected.message.reference}
                                    </Typography>
                                    <CopyResolveDID did={selected.message.reference}/>
                                    <Tooltip title="Open referenced message">
                                        <IconButton
                                            size="small"
                                            onClick={() => openReferencedMessage(selected.message.reference!)}
                                        >
                                            <Link/>
                                        </IconButton>
                                    </Tooltip>
                                </Box>
                            )}

                            {selected.attachments && Object.keys(selected.attachments).length > 0 && (
                                <Box mb={2}>
                                    <Typography variant="subtitle2">Attachments:</Typography>
                                    {Object.entries(selected.attachments).map(([name, item]: [string, any]) => (
                                        <Box key={name} display="flex" alignItems="center" gap={1} mt={0.5}>
                                            {getVaultItemIcon(name, item)}
                                            <Typography>{name}</Typography>
                                            <Typography>{item.bytes} bytes</Typography>
                                            <Button
                                                size="small"
                                                variant="outlined"
                                                onClick={() => downloadDmailAttachment(name)}
                                            >
                                                Download
                                            </Button>
                                        </Box>
                                    ))}
                                </Box>
                            )}

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
                    )}
                </Box>
            </Box>
        )
    };

    const renderSend = () => (
        <Box mt={2}>
            <Box display="flex" flexDirection="column" gap={2}>
                <Box display="flex" gap={1}>
                    <Autocomplete
                        freeSolo
                        options={agentList || []}
                        value={sendTo}
                        sx={{ flex: 1, minWidth: 300 }}
                        onInputChange={(_, v) => setSendTo(v.trim())}
                        renderInput={(params) => (
                            <TextField {...params} label="Recipient (name or DID)" />
                        )}
                    />

                    <Button
                        variant="outlined"
                        disabled={!sendTo}
                        onClick={() => {
                            if (sendTo && !sendToList.includes(sendTo)) {
                                setSendToList([...sendToList, sendTo]);
                            }
                            setSendTo("");
                        }}
                    >
                        Add
                    </Button>
                </Box>

                {sendToList.map((r) => (
                    <Box key={r} display="flex" alignItems="center" gap={1}>
                        <IconButton size="small" onClick={() => setSendToList(sendToList.filter(x => x !== r))}>
                            <Clear fontSize="small" />
                        </IconButton>
                        <Typography>{r}</Typography>
                    </Box>
                ))}

                <Box display="flex" gap={1}>
                    <Autocomplete
                        freeSolo
                        options={agentList || []}
                        value={sendCc}
                        sx={{ flex: 1, minWidth: 300 }}
                        onInputChange={(_, v) => setSendCc(v.trim())}
                        renderInput={(params) => (
                            <TextField {...params} label="CC (optional)" />
                        )}
                    />

                    <Button
                        variant="outlined"
                        disabled={!sendCc}
                        onClick={() => {
                            if (sendCc && !sendCcList.includes(sendCc)) {
                                setSendCcList([...sendCcList, sendCc]);
                            }
                            setSendCc("");
                        }}
                    >
                        Add
                    </Button>
                </Box>

                {sendCcList.map((r) => (
                    <Box key={r} display="flex" alignItems="center" gap={1}>
                        <IconButton size="small" onClick={() => setSendCcList(sendCcList.filter(x => x !== r))}>
                            <Clear fontSize="small" />
                        </IconButton>
                        <Typography>{r}</Typography>
                    </Box>
                ))}

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

                    <FormControlLabel
                        control={
                            <Checkbox
                                checked={ephemeral}
                                onChange={(e) => setEphemeral(e.target.checked)}
                                disabled={registry !== "hyperswarm"}
                            />
                        }
                        label="Ephemeral"
                    />

                    <TextField
                        size="small"
                        label="Expires"
                        type="datetime-local"
                        value={expiresAt}
                        onChange={(e) => setExpiresAt(e.target.value)}
                        disabled={!ephemeral || registry !== "hyperswarm"}
                        sx={{ minWidth: 200 }}
                    />
                </Box>

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
                        disabled={(!sendToList.length && !sendTo) || !sendSubject || !sendBody}
                    >
                        Create
                    </Button>
                </Box>

                <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">

                    <Button variant="contained" onClick={handleUpdate} disabled={!dmailDid}>
                        Update
                    </Button>

                    <Button variant="contained" onClick={handleSend} disabled={!dmailDid}>
                        Send
                    </Button>

                    <Button variant="contained" color="primary" onClick={() => setRevokeOpen(true)} disabled={!dmailDid}>
                        Revoke
                    </Button>

                    <Button
                        variant="outlined"
                        color="secondary"
                        onClick={clearAll}
                        disabled={!(sendToList.length || sendCcList.length || sendCc || sendTo || sendSubject || sendBody)}
                    >
                        Clear
                    </Button>
                </Box>

                <Box display="flex" flexDirection="column" gap={1}>
                    <Button
                        variant="outlined"
                        component="label"
                        sx={{ width: 200 }}
                        disabled={!dmailDid}
                        onClick={() => dmailDid && document.getElementById("attachmentUpload")!.click()}
                    >
                        Add attachment
                    </Button>

                    <input
                        hidden
                        type="file"
                        onChange={uploadDmailAttachment}
                        id="attachmentUpload"
                    />

                    {Object.keys(dmailAttachments).length > 0 && (
                        <Box>
                            {Object.entries(dmailAttachments).map(([name, item]) => (
                                <Box key={name} display="flex" alignItems="center" gap={1} mt={0.5}>
                                    {getVaultItemIcon(name, item)}
                                    <Typography>{name}</Typography>
                                    <Button
                                        size="small"
                                        color="error"
                                        variant="outlined"
                                        disabled={!dmailDid}
                                        onClick={() => dmailDid && removeDmailAttachment(name)}
                                    >
                                        Remove
                                    </Button>
                                </Box>
                            ))}
                        </Box>
                    )}
                </Box>

                {dmailDid && (
                    <Box display="flex" alignItems="center" gap={1} sx={{ maxWidth: "100%" }}>
                        <CopyDID did={dmailDid} />
                        <Typography sx={{
                            fontFamily: "monospace",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            flex: 1,
                            minWidth: 0,
                        }}>
                            {dmailDid}
                        </Typography>
                    </Box>
                )}
            </Box>
        </Box>
    );

    return (
        <Box>
            <WarningModal
                isOpen={revokeOpen}
                title="Revoke DMail"
                warningText="Are you sure you want to revoke this DMail?"
                onSubmit={confirmRevoke}
                onClose={() => setRevokeOpen(false)}
            />

            <TextInputModal
                isOpen={importModalOpen}
                title="Import DMail"
                description="Paste the DMail DID to import"
                label="DID"
                confirmText="Import"
                onSubmit={handleImportModalSubmit}
                onClose={() => setImportModalOpen(false)}
            />

            <DmailSearchModal
                open={advancedOpen}
                onClose={() => setAdvancedOpen(false)}
                onSearch={runAdvancedSearch}
            />

            <Box
                sx={{
                    position: "sticky",
                    top: 0,
                    zIndex: (t) => t.zIndex.appBar,
                    bgcolor: "background.paper",
                    pt: 1,
                    pb: 1,
                }}
            >
                <Box sx={{ mt: 1, mb: 1, display: "flex", alignItems: "center", gap: 1 }}>
                    <Tooltip title="Refresh">
                        <IconButton onClick={handleRefresh}>
                            <Refresh />
                        </IconButton>
                    </Tooltip>

                    <Tooltip title="Import DMail">
                        <IconButton onClick={() => setImportModalOpen(true)}>
                            <UploadFile />
                        </IconButton>
                    </Tooltip>

                    <TextField
                        variant="outlined"
                        size="small"
                        placeholder="Search…"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") {
                                runSimpleSearch(searchQuery);
                            }
                        }}
                        InputProps={{
                            endAdornment: (
                                <InputAdornment position="end">
                                    <Tooltip title="Advanced search">
                                        <IconButton onClick={() => setAdvancedOpen(true)}>
                                            <Tune />
                                        </IconButton>
                                    </Tooltip>
                                </InputAdornment>
                            )
                        }}
                    />
                </Box>

                <Tabs
                    value={activeTab}
                    onChange={(_, v) => {
                        setSelected(null);
                        setActiveTab(v);
                    }}
                    indicatorColor="primary"
                    textColor="primary"
                    variant="scrollable"
                    scrollButtons="auto"
                >
                    <Tab label="Compose" value="send"    icon={<Send />} />
                    <Tab label="Inbox"   value="inbox"   icon={<Inbox />} />
                    <Tab label="Outbox"  value="outbox"  icon={<Outbox />} />
                    <Tab label="Drafts"  value="drafts"  icon={<Drafts />} />
                    <Tab label="Archive" value="archive" icon={<Archive />} />
                    <Tab label="Trash"   value="trash"   icon={<Delete />} />
                    <Tab label="All"     value="all"     icon={<AllInbox />} />
                    {Object.keys(searchResults).length > 0 && (
                        <Tab label="Results" value="results" icon={<Search />} />
                    )}
                </Tabs>
            </Box>

            {activeTab !== "send" && renderInbox()}
            {activeTab === "send" && renderSend()}
        </Box>
    );
};

export default DmailTab;
