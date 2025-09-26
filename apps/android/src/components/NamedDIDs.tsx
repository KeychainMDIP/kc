import React, { useEffect, useMemo, useState } from "react";
import {
    Box,
    Button,
    Checkbox,
    IconButton,
    ListItemIcon,
    Menu,
    MenuItem,
    Select,
    TextField,
    Tooltip,
    Typography,
} from "@mui/material";
import WarningModal from "./WarningModal";
import {
    ArrowDropDown,
    Article,
    Block,
    Delete,
    Edit,
    Groups,
    Image,
    Lock,
    PermIdentity,
    Poll,
    QuestionMark,
    Schema,
    SwapHoriz,
} from "@mui/icons-material";
import { useWalletContext } from "../contexts/WalletProvider";
import { useCredentialsContext } from "../contexts/CredentialsProvider";
import { useUIContext } from "../contexts/UIContext";
import TextInputModal from "./TextInputModal";
import CopyResolveDID from "./CopyResolveDID";

function NamedDIDs() {
    const [removeOpen, setRemoveOpen] = useState<boolean>(false);
    const [removeName, setRemoveName] = useState<string>("");
    const [renameOpen, setRenameOpen] = useState<boolean>(false);
    const [renameOldName, setRenameOldName] = useState<string>("");
    const [renameDID, setRenameDID] = useState<string>("");
    const [revokeOpen, setRevokeOpen] = useState<boolean>(false);
    const [revokeName, setRevokeName] = useState<string>("");
    const [transferOpen, setTransferOpen] = useState<boolean>(false);
    const [transferName, setTransferName] = useState<string>("");
    const [bulkOpen, setBulkOpen] = useState<boolean>(false);
    const [bulkMenuAnchor, setBulkMenuAnchor] = useState<null | HTMLElement>(null);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [lastIndex, setLastIndex] = useState<number | null>(null);
    type NameKind =
          | "all"
          | "agent"
          | "vault"
          | "group"
          | "schema"
          | "image"
          | "document"
          | "unknown";
    const [filter, setFilter] = useState<NameKind>("all");
    type RegistryFilter = "all" | "unresolved" | string;
    const [registryFilter, setRegistryFilter] = useState<RegistryFilter>("all");
    const {
        keymaster,
        setError,
    } = useWalletContext();
    const {
        agentList,
        aliasName,
        aliasDID,
        documentList,
        groupList,
        imageList,
        nameList,
        nameRegistry,
        pollList,
        schemaList,
        setAliasDID,
        setAliasName,
        unresolvedList,
        vaultList,
    } = useCredentialsContext();
    const {
        openBrowser,
        setOpenBrowser,
        refreshNames,
    } = useUIContext();

    const registryOptions = useMemo(() => {
        const regs = new Set<string>();
        Object.values(nameRegistry || {}).forEach((r) => {
            if (r) regs.add(r);
        });
        return Array.from(regs).sort();
    }, [nameRegistry]);

    useEffect(() => {
        if (
            registryFilter !== "all" &&
            registryFilter !== "unresolved" &&
            !registryOptions.includes(registryFilter)
        ) {
            setRegistryFilter("all");
        }
    }, [registryOptions, registryFilter]);

    const mergedEntries = useMemo(() => {
        if (!nameList && !unresolvedList) {
            return [] as Array<[string, string]>;
        }
        return Object.entries({ ...nameList, ...unresolvedList })
            .sort(([a], [b]) => a.localeCompare(b))
            .filter(([name]) => {
                const { kind } = getNameIcon(name);
                const passesKind = (filter === "all" || kind === filter);

                const reg = nameRegistry[name];
                const regTag: RegistryFilter = reg ?? "unresolved";
                const passesRegistry = (registryFilter === "all" || regTag === registryFilter);

                return passesKind && passesRegistry;
            });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [nameList, nameRegistry, unresolvedList, filter, registryFilter]);

    useEffect(() => {
        if (!openBrowser) {
            return;
        }
        const { did, tab } = openBrowser;

        if (tab !== "names") {
            return;
        }

        if (did) {
            setAliasDID(did);
        }
    }, [openBrowser, setAliasDID]);

    const allVisibleNames = mergedEntries.map(([name]) => name);
    const allSelectedOnPage = allVisibleNames.every((n) => selected.has(n));
    const someSelectedOnPage = allVisibleNames.some((n) => selected.has(n))

    async function clearFields() {
        setAliasName("");
        setAliasDID("");
    }

    async function addName() {
        if (!keymaster) {
            return;
        }
        try {
            await keymaster.addName(aliasName, aliasDID);
            await clearFields();
            await refreshNames();
        } catch (error: any) {
            setError(error);
        }
    }

    const confirmRemove = async () => {
        if (!keymaster) {
            return;
        }
        try {
            await keymaster.removeName(removeName);
            await refreshNames();
        } catch (error: any) {
            setError(error);
        }
        setRemoveOpen(false);
        setRemoveName("");
    };

    const confirmBulkRemove = async () => {
        if (!keymaster || selected.size === 0) {
            setBulkOpen(false);
            return;
        }
        try {
            const names = Array.from(selected);
            await Promise.allSettled(names.map((n) => keymaster.removeName(n)));
            await refreshNames();
        } catch (error: any) {
            setError(error);
        }
        setSelected(new Set());
        setBulkOpen(false);
    };

    const openRenameModal = (oldName: string, did: string) => {
        setRenameOldName(oldName);
        setRenameDID(did);
        setRenameOpen(true);
    };

    const handleRenameSubmit = async (newName: string) => {
        setRenameOpen(false);
        if (!newName || newName === renameOldName || !keymaster) {
            return;
        }
        try {
            await keymaster.addName(newName, renameDID);
            await keymaster.removeName(renameOldName);
            await refreshNames();
        } catch (error: any) {
            setError(error);
        }
    };

    const confirmRevoke = async () => {
        if (!keymaster) {
            return;
        }
        try {
            await keymaster.revokeDID(revokeName);
            await refreshNames();
        } catch (error: any) {
            setError(error);
        }
        setRevokeOpen(false);
        setRevokeName("");
    };

    const handleTransferSubmit = async (newController: string) => {
        setTransferOpen(false);
        if (!newController || !keymaster) {
            return;
        }
        try {
            await keymaster.transferAsset(transferName, newController.trim());
            await refreshNames();
        } catch (error: any) {
            setError(error);
        }
    };

    function getNameIcon(name: string) {
        const iconStyle = { verticalAlign: "middle", marginRight: 4 };
        if (agentList?.includes(name)) {
            return {
                icon: <PermIdentity style={iconStyle}/>, kind: "agent"
            };
        }
        if (vaultList?.includes(name)) {
            return {
                icon: <Lock style={iconStyle}/>, kind: "vault"
            };
        }
        if (groupList?.includes(name)) {
            return {
                icon: <Groups style={iconStyle}/>, kind: "group"
            };
        }
        if (schemaList?.includes(name)) {
            return {
                icon: <Schema style={iconStyle}/>, kind: "schema"
            };
        }
        if (imageList?.includes(name)) {
            return {
                icon: <Image style={iconStyle}/>, kind: "image"
            };
        }
        if (documentList?.includes(name)) {
            return {
                icon: <Article style={iconStyle}/>, kind: "document"
            };
        }
        if (pollList?.includes(name)) {
            return {
                icon: <Poll style={iconStyle}/>, kind: "poll"
            };
        }
        return {
            icon: <QuestionMark style={iconStyle} />, kind: "unknown"
        };
    }

    const toggleSelectAllVisible = () => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (someSelectedOnPage) {
                allVisibleNames.forEach((n) => next.delete(n));
            } else {
                allVisibleNames.forEach((n) => next.add(n));
            }
            return next;
        });
    };

    const handleRowCheck = (
        e: React.ChangeEvent<HTMLInputElement>,
        index: number,
        name: string
    ) => {
        const checked = e.target.checked;
        const shift = (e.nativeEvent as MouseEvent).shiftKey;


        setSelected(prev => {
            const next = new Set(prev);

            if (shift && lastIndex !== null) {
                const start = Math.min(lastIndex, index);
                const end = Math.max(lastIndex, index);
                for (let i = start; i <= end; i++) {
                    const n = mergedEntries[i][0];
                    if (checked) next.add(n);
                    else next.delete(n);
                }
            } else {
                if (checked) next.add(name);
                else next.delete(name);
            }
            return next;
        });

        setLastIndex(index);
    };

    return (
        <Box>
            <WarningModal
                title="Remove DID"
                warningText={`Are you sure you want to remove '${removeName}'?`}
                isOpen={removeOpen}
                onClose={() => setRemoveOpen(false)}
                onSubmit={confirmRemove}
            />

            <WarningModal
                title="Remove selected DIDs"
                warningText={`Delete ${selected.size} selected item(s)? This cannot be undone.`}
                isOpen={bulkOpen}
                onClose={() => setBulkOpen(false)}
                onSubmit={confirmBulkRemove}
            />

            <TextInputModal
                isOpen={renameOpen}
                title="Rename DID"
                description={`Rename '${renameOldName}' to:`}
                label="New Name"
                confirmText="Rename"
                defaultValue={renameOldName}
                onSubmit={handleRenameSubmit}
                onClose={() => setRenameOpen(false)}
            />

            <WarningModal
                title="Revoke DID"
                warningText={`Are you sure you want to revoke '${revokeName}'? This operation cannot be undone.`}
                isOpen={revokeOpen}
                onClose={() => setRevokeOpen(false)}
                onSubmit={confirmRevoke}
            />

            <TextInputModal
                isOpen={transferOpen}
                title="Transfer Asset"
                description={`Transfer ownership of '${transferName}' to name or DID.`}
                label="New Controller"
                confirmText="Transfer"
                defaultValue=""
                onSubmit={handleTransferSubmit}
                onClose={() => setTransferOpen(false)}
            />

            <Box className="flex-box mt-2">
                <TextField
                    label="Name"
                    variant="outlined"
                    value={aliasName}
                    onChange={(e) => setAliasName(e.target.value)}
                    size="small"
                    className="text-field top-left short-name"
                    style={{ flex: "0 0 150px" }}
                    slotProps={{
                        htmlInput: {
                            maxLength: 32,
                        },
                    }}
                />
                <TextField
                    label="DID"
                    variant="outlined"
                    value={aliasDID}
                    onChange={(e) => setAliasDID(e.target.value.trim())}
                    size="small"
                    className="text-field top-right"
                    slotProps={{
                        htmlInput: {
                            maxLength: 80,
                        },
                    }}
                />
            </Box>

            <Box className="flex-box">
                <Button
                    variant="contained"
                    color="primary"
                    onClick={() => {
                        setOpenBrowser({
                            did: aliasDID,
                            tab: "viewer"
                        });
                    }}
                    className="button large bottom"
                    disabled={!aliasDID}
                >
                    Resolve
                </Button>

                <Button
                    variant="contained"
                    color="primary"
                    onClick={addName}
                    className="button large bottom"
                    disabled={!aliasName || !aliasDID}
                >
                    Add
                </Button>

                <Button
                    variant="contained"
                    color="primary"
                    onClick={clearFields}
                    className="button large bottom"
                    disabled={!aliasName && !aliasDID}
                >
                    Clear
                </Button>
            </Box>

            <Box className="flex-box" sx={{ my: 1, alignItems: "center", gap: 1 }}>
                <Box sx={{ display: "flex", alignItems: "center" }}>
                    <Checkbox
                        checked={allSelectedOnPage}
                        indeterminate={!allSelectedOnPage && someSelectedOnPage}
                        onChange={toggleSelectAllVisible}
                        size="small"
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
                        <MenuItem
                            disabled={selected.size === 0}
                            onClick={() => {
                                setBulkMenuAnchor(null);
                                setBulkOpen(true);
                            }}
                        >
                            <ListItemIcon>
                                <Delete fontSize="small" />
                            </ListItemIcon>
                            Delete
                        </MenuItem>
                    </Menu>
                </Box>

                <Select
                    size="small"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value as NameKind)}
                    sx={{ width: 200 }}
                >
                    <MenuItem value="all">Type: All</MenuItem>
                    <MenuItem value="agent">Agents</MenuItem>
                    <MenuItem value="document">Documents</MenuItem>
                    <MenuItem value="group">Groups</MenuItem>
                    <MenuItem value="image">Images</MenuItem>
                    <MenuItem value="poll">Polls</MenuItem>
                    <MenuItem value="schema">Schemas</MenuItem>
                    <MenuItem value="vault">Vaults</MenuItem>
                    <MenuItem value="unknown">Unknown</MenuItem>
                </Select>

                <Select
                    size="small"
                    value={registryFilter}
                    onChange={(e) => setRegistryFilter(e.target.value)}
                    sx={{ width: 200 }}
                >
                    <MenuItem value="all">Registry: All</MenuItem>

                    {registryOptions.map((r) => (
                        <MenuItem key={r} value={r}>
                            {r}
                        </MenuItem>
                    ))}

                    <MenuItem value="unresolved">Unresolved</MenuItem>
                </Select>
            </Box>

            {mergedEntries.map(
                ([name, did]: [string, string], index) => (
                    <Box
                        key={index}
                        display="flex"
                        alignItems="center"
                        justifyContent="space-between"
                        width="100%"
                        mb={1}
                    >
                        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flex: 1, minWidth: 0 }}>
                            <Checkbox
                                size="small"
                                checked={selected.has(name)}
                                onChange={(e) => handleRowCheck(e, index, name)}
                            />
                            <Typography
                                noWrap
                                sx={{
                                    flex: 1,
                                    maxWidth: 300,
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                    color: getNameIcon(name).kind === "unknown" ? "red" : "text.primary",
                                }}
                            >
                                {getNameIcon(name).icon}
                                {name}
                            </Typography>
                        </Box>
                        <Box display="flex" alignItems="center">
                            <CopyResolveDID did={did} />
                            <Tooltip title="Rename">
                                <IconButton
                                    onClick={() => openRenameModal(name, did)}
                                    size="small"
                                >
                                    <Edit />
                                </IconButton>
                            </Tooltip>
                            <Tooltip title="Transfer">
                                <IconButton
                                    onClick={() => {
                                        setTransferName(name);
                                        setTransferOpen(true);
                                    }}
                                    size="small"
                                >
                                    <SwapHoriz />
                                </IconButton>
                            </Tooltip>
                            <Tooltip title="Revoke">
                                <IconButton
                                    onClick={() => {
                                        setRevokeName(name);
                                        setRevokeOpen(true);
                                    }}
                                    size="small"
                                >
                                    <Block />
                                </IconButton>
                            </Tooltip>
                            <Tooltip title="Delete">
                                <IconButton
                                    onClick={() => {
                                        setRemoveName(name);
                                        setRemoveOpen(true);
                                    }}
                                    size="small"
                                >
                                    <Delete />
                                </IconButton>
                            </Tooltip>
                        </Box>
                    </Box>
                ),
            )}
        </Box>
    );
}

export default NamedDIDs;
