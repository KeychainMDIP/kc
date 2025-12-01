import React, {ChangeEvent, useEffect, useState} from "react";
import {
    Autocomplete,
    Box,
    Button,
    Checkbox,
    FormControlLabel,
    IconButton,
    InputAdornment,
    Menu,
    MenuItem,
    ListItemIcon,
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
    Create,
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
    ArrowBack,
    ChevronLeft,
    ChevronRight,
    ArrowDropDown,
} from "@mui/icons-material";
import {DmailItem, DmailMessage} from '@mdip/keymaster/types';
import { useWalletContext } from "../contexts/WalletProvider";
import { useVariablesContext } from "../contexts/VariablesProvider";
import { useUIContext } from "../contexts/UIContext";
import { useSnackbar } from "../contexts/SnackbarProvider";
import TextInputModal from "../modals/TextInputModal";
import WarningModal from "../modals/WarningModal";
import CopyResolveDID from "./CopyResolveDID";
import CopyDID from "./CopyDID";
import DmailSearchModal, { AdvancedSearchParams } from "../modals/DmailSearchModal";
import DisplayDID from "./DisplayDID";
import { MdipDocument } from "@mdip/gatekeeper/types";
import VersionNavigator from "./VersionNavigator";

const DmailTab: React.FC = () => {
    const [registry, setRegistry] = useState<string>("hyperswarm");
    const [selected, setSelected] = useState<DmailItem & { did: string } | null>(null);
    const [selectedView, setSelectedView] = useState<(DmailItem & { did: string }) | null>(null);
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
    const [advancedOpen,  setAdvancedOpen]  = useState<boolean>(false);
    const [advParams, setAdvParams] = useState<AdvancedSearchParams | null>(null);
    const [forwardSourceDid, setForwardSourceDid] = useState<string | null>(null);
    const [ephemeral, setEphemeral] = useState<boolean>(false);
    const [expiresAt, setExpiresAt] = useState<string>("");
    const [dmailReference, setDmailReference] = useState<string>("");
    const [page, setPage] = useState<number>(0);
    const pageSize = 20;
    const [selectedSet, setSelectedSet] = useState<Set<string>>(new Set());
    const [bulkMenuAnchor, setBulkMenuAnchor] = useState<null | HTMLElement>(null);
    const [docVersion, setDocVersion] = useState<number>(1);
    const [docVersionMax, setDocVersionMax] = useState<number>(1);
    const [docAtVersion, setDocAtVersion] = useState<MdipDocument | null>(null);
    const [createdAt, setCreatedAt] = useState<string | null>(null);
    const { keymaster } = useWalletContext();
    const { setError, setSuccess } = useSnackbar();
    const {
        currentId,
        agentList,
        dmailList,
        registries,
    } = useVariablesContext();
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
    type Folder = "inbox" | "outbox" | "drafts" | "archive" | "trash" | "all" | "send";

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
        setSelectedView(null);
        await fileTags(did, [...tags, TAG.archived]);
    };

    const unarchive = async () => {
        if (!selected) {
            return;
        }
        const { did, tags = [] } = selected;
        setSelected(null);
        setSelectedView(null);
        await fileTags(did, tags.filter(t => t !== TAG.archived));
    };

    const del = async () => {
        if (!selected) {
            return;
        }
        const { did, tags = [] } = selected;
        setSelected(null);
        setSelectedView(null);
        await fileTags(did, [...tags, TAG.deleted]);
    };

    const undelete = async () => {
        if (!selected) {
            return;
        }
        const { did, tags = [] } = selected;
        setSelected(null);
        setSelectedView(null);
        await fileTags(did, tags.filter(t => t !== TAG.deleted));
    };

    useEffect(() => {
        refreshInbox();

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [keymaster, currentId]);

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
        let base: Record<string, DmailItem> = {};

        if (activeTab === "send") {
            return base;
        }

        if (activeTab === "all") {
            base = dmailList;
        } else {
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
                    {
                        const isSelfAddressed = !!currentId && itm.sender === currentId && (itm.to?.includes(currentId) || itm.cc?.includes(currentId));
                        if ((has(TAG.sent) || isSelfAddressed) && not(TAG.archived) && not(TAG.deleted) && not(TAG.draft)) {
                            out[did] = itm;
                        }
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
            base = out;
        }

        const q = searchQuery.trim().toLowerCase();
        const passesSimple = (itm: DmailItem) => {
            if (!q) return true;
            const body = itm.message.body.toLowerCase();
            const subj = itm.message.subject.toLowerCase();
            const from = itm.sender.toLowerCase();
            const tocc = [...itm.to, ...(itm.cc ?? [])].join(", ").toLowerCase();
            return body.includes(q) || subj.includes(q) || from.includes(q) || tocc.includes(q);
        };

        const passesAdvanced = (itm: DmailItem) => {
            if (!advParams) return true;
            const p = advParams;
            if (p.from && !itm.sender.toLowerCase().includes(p.from.toLowerCase())) {
                return false;
            }
            if (p.to) {
                const tocc = [...itm.to, ...(itm.cc ?? [])].join(", ").toLowerCase();
                if (!tocc.includes(p.to.toLowerCase())) {
                    return false;
                }
            }
            if (p.subject && !itm.message.subject.toLowerCase().includes(p.subject.toLowerCase())) {
                return false;
            }
            if (p.body && !itm.message.body.toLowerCase().includes(p.body.toLowerCase())) {
                return false;
            }
            if (p.hasAttach && (!itm.attachments || Object.keys(itm.attachments).length === 0)) {
                return false;
            }
            if (p.dateFrom || p.dateTo) {
                try {
                    const t = new Date(itm.date).getTime();
                    if (Number.isNaN(t)) return false;
                    if (p.dateFrom) {
                        const fromTs = new Date(`${p.dateFrom}T00:00:00`).getTime();
                        if (t < fromTs) return false;
                    }
                    if (p.dateTo) {
                        const toTs = new Date(`${p.dateTo}T23:59:59.999`).getTime();
                        if (t > toTs) return false;
                    }
                } catch {
                    return false;
                }
            }
            return true;
        };

        const out: Record<string, DmailItem> = {};
        for (const [did, itm] of Object.entries(base)) {
            if (passesSimple(itm) && passesAdvanced(itm)) {
                out[did] = itm;
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
            const blob = new Blob([buffer as any]);
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
        setSearchQuery(term);
        setPage(0);
    }

    function runAdvancedSearch(p: AdvancedSearchParams) {
        setAdvParams(p);
        setAdvancedOpen(false);
        setPage(0);
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

    useEffect(() => {
        if (activeTab === "send") {
            return;
        }
        const total = Object.keys(filteredList()).length;
        const maxPage = total === 0 ? 0 : Math.floor((total - 1) / pageSize);
        if (page > maxPage) {
            setPage(0);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeTab, dmailList, searchQuery, advParams]);

    function addDmailContact(senderDid: string) {
        if (!setOpenBrowser || !senderDid.startsWith('did:')) {
            return;
        }
        setOpenBrowser({
            title: "",
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
        const next = { ...item, did };
        setSelected(next);
        setSelectedView(next);
    }

    function shortDateOrTime(iso: string) {
        const d = new Date(iso);
        const today = new Date();
        return d.toDateString() === today.toDateString()
            ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
            : d.toLocaleDateString();
    }

    const cat: Folder = activeTab;

    function getVisibleIds(): string[] {
        const list = filteredList();
        const entries = Object.entries(list)
            .sort(([, a], [, b]) => new Date(b.date).getTime() - new Date(a.date).getTime());
        const startIdx = page * pageSize;
        const endIdx = Math.min(entries.length, startIdx + pageSize);
        return entries.slice(startIdx, endIdx).map(([did]) => did);
    }

    function paginationMeta() {
        if (activeTab === "send") {
            return { total: 0, start: 0, end: 0, atStart: true, atEnd: true };
        }
        const total = Object.keys(filteredList()).length;
        const start = total === 0 ? 0 : page * pageSize + 1;
        const end = Math.min(total, (page + 1) * pageSize);
        return { total, start, end, atStart: page === 0, atEnd: end >= total };
    }

    async function bulkDeleteSelected() {
        if (!keymaster || selectedSet.size === 0) return;
        try {
            const ids = Array.from(selectedSet);
            await Promise.allSettled(ids.map((did) => {
                const tags = dmailList[did]?.tags ?? [];
                const newTags = Array.from(new Set([...tags, TAG.deleted]));
                return keymaster.fileDmail(did, newTags);
            }));
            setSelectedSet(new Set());
            await refreshInbox();
        } catch (error: any) {
            setError(error);
        }
    }

    async function bulkRestoreSelected() {
        if (!keymaster || selectedSet.size === 0) return;
        try {
            const ids = Array.from(selectedSet);
            await Promise.allSettled(ids.map((did) => {
                const tags = dmailList[did]?.tags ?? [];
                const newTags = tags.filter((t) => t !== TAG.deleted);
                return keymaster.fileDmail(did, newTags);
            }));
            setSelectedSet(new Set());
            await refreshInbox();
        } catch (error: any) {
            setError(error);
        }
    }

    useEffect(() => {
        setDocVersion(1);
        setDocVersionMax(1);
        setDocAtVersion(null);
        setCreatedAt(null);

        const fetchVersions = async () => {
            if (!keymaster || !selected?.did) {
                return;
            }
            try {
                let docs = await keymaster.resolveDID(selected.did);
                const max = parseInt(docs.didDocumentMetadata?.version ?? "1", 10);
                const adjustedMax = max > 1 ? max - 1 : 1;

                setDocVersion(adjustedMax);
                setDocVersionMax(adjustedMax);
                setDocAtVersion(docs);

                const latestMsg = await keymaster.getDmailMessage(selected.did);
                const latestAtt = await keymaster.listDmailAttachments(selected.did);
                if (latestMsg) {
                    setSelectedView({
                        ...selected,
                        message: latestMsg,
                        attachments: latestAtt
                    });
                }

                if (max > 1) {
                    docs = await keymaster.resolveDID(selected.did, { atVersion: 2 });
                }

                const created =
                    docs?.didDocumentMetadata?.created ||
                    docs?.didDocumentMetadata?.updated ||
                    null;
                setCreatedAt(created);
            } catch (err: any) {
                setError(err);
            }
        };

        if (selected) {
            fetchVersions();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selected, keymaster]);

    async function handleVersionChange(v: number) {
        if (!keymaster || !selected?.did) {
            return;
        }
        setDocVersion(v);

        try {
            const apiVersion = v + 1;

            const docs = await keymaster.resolveDID(selected.did, { atVersion: apiVersion });
            setDocAtVersion(docs);

            const [msg, atts] = await Promise.all([
                keymaster.getDmailMessage(selected.did, { atVersion: apiVersion }),
                keymaster.listDmailAttachments(selected.did, { atVersion: apiVersion }),
            ]);

            if (msg) {
                setSelectedView({
                    ...selected,
                    message: msg,
                    attachments: atts
                });
            }
        } catch (err: any) {
            console.error('Error in handleVersionChange:', err);
            setError(err);
        }
    }

    const messageSubject = selectedView?.message.subject ?? selected?.message.subject;
    const messageTo = selectedView?.message.to ?? selected?.message.to;
    const messageCC = selectedView?.message.cc ?? selected?.message.cc;
    const messageBody = selectedView?.message.body ?? selected?.message.body;
    const messageReference = selectedView?.message.reference ?? selected?.message.reference;
    const messageAttachments = selectedView?.attachments ?? selected?.attachments;

    const renderInbox = () => {
        const list = filteredList();
        const entries = Object.entries(list)
            .sort(([, a], [, b]) => new Date(b.date).getTime() - new Date(a.date).getTime());
        const startIdx = page * pageSize;
        const endIdx = Math.min(entries.length, startIdx + pageSize);

        const emptyText: Record<Folder, string> = {
            inbox:   "Your inbox is empty.",
            outbox:  "No sent mail yet.",
            drafts:  "No drafts saved.",
            archive: "No archived mail.",
            trash:   "Trash is empty.",
            all:     "No messages to show.",
            send:    "",
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
                    <Typography sx={{ mt: 1 }}>{emptyText[activeTab]}</Typography>
                </Box>
            );
        }

        return (
            <Box display="flex" flexDirection="column" mt={1}>
                {!selected && (
                    <Box>
                        {entries.slice(startIdx, endIdx).map(([did, item]) => {
                            const unread = item.tags?.includes(TAG.unread);
                            return (
                                <Box
                                    key={did}
                                    onClick={() => {
                                        const next = { ...item, did };
                                        setSelected(next);
                                        setSelectedView(next);
                                        markAsRead(did, item.tags);
                                    }}
                                    sx={{
                                        px: 1,
                                        borderRadius: 1,
                                        cursor: "pointer",
                                        bgcolor: "transparent",
                                        "&:hover": { bgcolor: "action.hover" },
                                    }}
                                >
                                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                                        <Checkbox
                                            size="small"
                                            checked={selectedSet.has(did)}
                                            onClick={(e) => e.stopPropagation()}
                                            onChange={(e) => {
                                                const checked = e.target.checked;
                                                setSelectedSet(prev => {
                                                    const next = new Set(prev);
                                                    if (checked) next.add(did); else next.delete(did);
                                                    return next;
                                                });
                                            }}
                                        />
                                        <Typography
                                            sx={{
                                                width: 150,
                                                minWidth: 150,
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
                                                flex: 1,
                                                minWidth: 0,
                                                overflow: "hidden",
                                                textOverflow: "ellipsis",
                                                whiteSpace: "nowrap",
                                                fontWeight: unread ? 600 : 400,
                                            }}
                                        >
                                            {item.message.subject}
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
                                </Box>
                            );
                        })}
                    </Box>
                )}

                <Box flex={1}>
                    {selected && (
                        <Box>
                            <Box sx={{display: "flex", alignItems: "center", justifyContent: "space-between"}}>
                                <Box>
                                    <Tooltip title="Back">
                                        <IconButton onClick={() => {
                                            setSelected(null);
                                            setSelectedView(null);
                                        }}><ArrowBack/></IconButton>
                                    </Tooltip>
                                </Box>
                                <Box sx={{gap: 0.5, display: "flex", flexDirection: "row"}}>
                                    {cat === "inbox" && (
                                        <Box>
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
                                        <Box>
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
                                        <Box>
                                            <Tooltip title="Unarchive">
                                                <IconButton onClick={unarchive}><Unarchive/></IconButton>
                                            </Tooltip>
                                            <Tooltip title="Delete">
                                                <IconButton onClick={del}><Delete/></IconButton>
                                            </Tooltip>
                                        </Box>
                                    )}

                                    {cat === "trash" && (
                                        <Box>
                                            <Tooltip title="Restore">
                                                <IconButton onClick={undelete}><RestoreFromTrash/></IconButton>
                                            </Tooltip>
                                        </Box>
                                    )}
                                </Box>
                            </Box>

                            <DisplayDID did={selected.did} />

                            {docVersionMax > 1 && (
                                <Box sx={{ mb: 1 }}>
                                    <VersionNavigator
                                        version={docVersion}
                                        maxVersion={docVersionMax}
                                        onVersionChange={handleVersionChange}
                                    />
                                </Box>
                            )}

                            <Box display="flex" alignItems="center" mb={1}>
                                <Typography variant="subtitle2" sx={{mr: 1}}>
                                    To:
                                </Typography>
                                <Typography variant="body2" sx={{wordBreak: "break-all"}}>
                                    {messageTo?.join(", ")}
                                </Typography>
                            </Box>

                            <Box display="flex" alignItems="center" mb={1}>
                                <Typography variant="subtitle2" sx={{mr: 1}}>
                                    Cc:
                                </Typography>
                                <Typography variant="body2" sx={{wordBreak: "break-all"}}>
                                    {messageCC?.join(", ")}
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
                                    Created:
                                </Typography>
                                <Typography variant="body2" sx={{wordBreak: "break-all"}}>
                                    {createdAt ? new Date(createdAt).toLocaleString() : ""}
                                </Typography>
                            </Box>

                            {docVersionMax > 1 && docAtVersion?.didDocumentMetadata?.updated && (
                                <Box display="flex" alignItems="center" mb={1}>
                                    <Typography variant="subtitle2" sx={{ mr: 1 }}>
                                        Updated:
                                    </Typography>
                                    <Typography variant="body2" sx={{ wordBreak: "break-all" }}>
                                        {new Date(docAtVersion.didDocumentMetadata.updated).toLocaleString()}
                                    </Typography>
                                </Box>
                            )}

                            <Box display="flex" alignItems="center" mb={1}>
                                <Typography variant="subtitle2" sx={{mr: 1}}>
                                    Subject:
                                </Typography>
                                <Typography variant="body2" sx={{wordBreak: "break-all"}}>
                                    {messageSubject}
                                </Typography>
                            </Box>

                            {messageReference && (
                                <Box display="flex" alignItems="center" mb={1}>
                                    <Typography variant="subtitle2" sx={{mr: 1}}>
                                        Reference:
                                    </Typography>
                                    <Typography variant="body2">
                                        {messageReference}
                                    </Typography>
                                    <CopyResolveDID did={messageReference}/>
                                    <Tooltip title="Open referenced message">
                                        <IconButton
                                            size="small"
                                            onClick={() => openReferencedMessage(messageReference)}
                                        >
                                            <Link/>
                                        </IconButton>
                                    </Tooltip>
                                </Box>
                            )}

                            {messageAttachments && Object.keys(messageAttachments).length > 0 && (
                                <Box mb={2}>
                                    <Typography variant="subtitle2">Attachments:</Typography>
                                    {Object.entries(messageAttachments).map(([name, item]: [string, any]) => (
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
                                value={messageBody}
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
                        slotProps={{
                            inputLabel: { shrink: true },
                        }}
                    />

                </Box>
                <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">

                    <Button
                        variant="contained"
                        onClick={handleCreate}
                        disabled={(!sendToList.length && !sendTo) || !sendSubject || !sendBody}
                    >
                        Create
                    </Button>

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
                    <Box display="flex" alignItems="center" gap={1} sx={{ mt: 1 }}>
                        <Typography sx={{ fontFamily: 'monospace' }}>{dmailDid}</Typography>
                        <CopyDID did={dmailDid} />
                    </Box>
                )}
            </Box>
        </Box>
    );

    const meta = paginationMeta();

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

            <Box sx={{ mt: 1, mb: 1, display: "flex", alignItems: "center", gap: 1 }}>
                {activeTab !== "send" && (
                    <Box sx={{ display: "flex", alignItems: "center" }}>
                        {(() => {
                            const vis = getVisibleIds();
                            const allSel = vis.length > 0 && vis.every((id) => selectedSet.has(id));
                            const anySel = vis.some((id) => selectedSet.has(id));
                            const onToggle = () => {
                                if (anySel) {
                                    setSelectedSet((prev) => {
                                        const next = new Set(prev);
                                        vis.forEach((id) => next.delete(id));
                                        return next;
                                    });
                                } else {
                                    setSelectedSet((prev) => {
                                        const next = new Set(prev);
                                        vis.forEach((id) => next.add(id));
                                        return next;
                                    });
                                }
                            };
                            return (
                                <Box>
                                    <Checkbox
                                        size="small"
                                        checked={allSel}
                                        indeterminate={!allSel && anySel}
                                        onChange={onToggle}
                                    />
                                    <IconButton
                                        size="small"
                                        onClick={(e) => setBulkMenuAnchor(e.currentTarget)}
                                    >
                                        <ArrowDropDown />
                                    </IconButton>
                                    <Menu
                                        anchorEl={bulkMenuAnchor}
                                        open={Boolean(bulkMenuAnchor)}
                                        onClose={() => setBulkMenuAnchor(null)}
                                    >
                                        {activeTab === "trash" ? (
                                            <MenuItem
                                                disabled={selectedSet.size === 0}
                                                onClick={() => {
                                                    setBulkMenuAnchor(null);
                                                    bulkRestoreSelected();
                                                }}
                                            >
                                                <ListItemIcon>
                                                    <RestoreFromTrash fontSize="small" />
                                                </ListItemIcon>
                                                Restore
                                            </MenuItem>
                                        ) : (
                                            <MenuItem
                                                disabled={selectedSet.size === 0}
                                                onClick={() => {
                                                    setBulkMenuAnchor(null);
                                                    bulkDeleteSelected();
                                                }}
                                            >
                                                <ListItemIcon>
                                                    <Delete fontSize="small" />
                                                </ListItemIcon>
                                                Delete
                                            </MenuItem>
                                        )}
                                    </Menu>
                                </Box>
                            );
                        })()}
                    </Box>
                )}

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
                    slotProps={{
                        input: {
                            endAdornment: (
                                <InputAdornment position="end">
                                    <Tooltip title="Advanced search">
                                        <IconButton onClick={() => setAdvancedOpen(true)}>
                                            <Tune />
                                        </IconButton>
                                    </Tooltip>
                                </InputAdornment>
                            ),
                        }
                    }}
                />


                <Box sx={{ ml: "auto", display: "flex", alignItems: "center", gap: 0.5 }}>
                    <Typography variant="body2" sx={{ mr: 0.5 }}>
                        {meta.start} - {meta.end} of {meta.total}
                    </Typography>
                    <Tooltip title="Previous">
                        <span>
                            <IconButton size="small" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={meta.atStart}>
                                <ChevronLeft />
                            </IconButton>
                        </span>
                    </Tooltip>
                    <Tooltip title="Next">
                        <span>
                            <IconButton size="small" onClick={() => setPage(p => p + 1)} disabled={meta.atEnd}>
                                <ChevronRight />
                            </IconButton>
                        </span>
                    </Tooltip>
                </Box>
            </Box>

            <Tabs
                value={activeTab}
                onChange={(_, v) => {
                    setSelected(null);
                    setSelectedView(null);
                    setActiveTab(v);
                    setPage(0);
                    setSelectedSet(new Set());
                }}
                indicatorColor="primary"
                textColor="primary"
                variant="scrollable"
                scrollButtons="auto"
            >
                <Tab label="Compose" value="send"    icon={<Create />} />
                <Tab label="Inbox"   value="inbox"   icon={<Inbox />} />
                <Tab label="Sent"    value="outbox"  icon={<Outbox />} />
                <Tab label="Drafts"  value="drafts"  icon={<Drafts />} />
                <Tab label="Archive" value="archive" icon={<Archive />} />
                <Tab label="Trash"   value="trash"   icon={<Delete />} />
                <Tab label="All"     value="all"     icon={<AllInbox />} />
            </Tabs>

            {activeTab !== "send" && renderInbox()}
            {activeTab === "send" && renderSend()}
        </Box>
    );
};

export default DmailTab;
