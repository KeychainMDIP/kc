import React, { useState } from "react";
import {
    Box,
    Button,
    IconButton,
    MenuItem,
    Select,
    TextField,
    Tooltip,
    Typography,
} from "@mui/material";
import WarningModal from "../../shared/WarningModal";
import {
    Article,
    Block,
    ContentCopy,
    Delete,
    Edit,
    Groups,
    Image,
    Lock,
    ManageSearch,
    PermIdentity,
    Poll,
    Schema,
    SwapHoriz,
    Token,
} from "@mui/icons-material";
import { useWalletContext } from "../../shared/contexts/WalletProvider";
import { useCredentialsContext } from "../../shared/contexts/CredentialsProvider";
import { useUIContext } from "../../shared/contexts/UIContext";
import { requestBrowserRefresh } from "../../shared/sharedScripts";
import TextInputModal from "../../shared/TextInputModal";

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
    type NameKind =
          | "all"
          | "agent"
          | "vault"
          | "group"
          | "schema"
          | "image"
          | "document"
          | "other";
    const [filter, setFilter] = useState<NameKind>("all");
    const {
        isBrowser,
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
        pollList,
        schemaList,
        setAliasDID,
        setAliasName,
        vaultList,
    } = useCredentialsContext();
    const {
        handleCopyDID,
        openBrowserWindow,
        refreshNames,
    } = useUIContext();

    async function clearFields() {
        await setAliasName("");
        await setAliasDID("");
    }

    async function addName() {
        if (!keymaster) {
            return;
        }
        try {
            await keymaster.addName(aliasName, aliasDID);
            await clearFields();
            await refreshNames();
            requestBrowserRefresh(isBrowser);
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
            requestBrowserRefresh(isBrowser);
        } catch (error: any) {
            setError(error);
        }
        setRemoveOpen(false);
        setRemoveName("");
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
            icon: <Token style={iconStyle} />, kind: "other"
        };
    }

    return (
        <Box>
            <WarningModal
                title="Remove DID"
                warningText={`Are you sure you want to remove '${removeName}'?`}
                isOpen={removeOpen}
                onClose={() => setRemoveOpen(false)}
                onSubmit={confirmRemove}
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
                    onClick={() => openBrowserWindow({ title: aliasName, did: aliasDID })}
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

            <Box className="flex-box" sx={{ my: 1 }}>
                <Select
                    size="small"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value as NameKind)}
                    sx={{ width: 200 }}
                >
                    <MenuItem value="all">All</MenuItem>
                    <MenuItem value="agent">Agents</MenuItem>
                    <MenuItem value="document">Documents</MenuItem>
                    <MenuItem value="group">Groups</MenuItem>
                    <MenuItem value="image">Images</MenuItem>
                    <MenuItem value="poll">Polls</MenuItem>
                    <MenuItem value="schema">Schemas</MenuItem>
                    <MenuItem value="vault">Vaults</MenuItem>
                    <MenuItem value="other">Other</MenuItem>
                </Select>
            </Box>

            {nameList &&
                Object.entries(nameList)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .filter(([name]) => {
                        const { kind } = getNameIcon(name);
                        return filter === "all" || kind === filter;
                    })
                    .map(
                        ([name, did]: [string, string], index) => (
                            <Box
                                key={index}
                                display="flex"
                                alignItems="center"
                                justifyContent="space-between"
                                width="100%"
                                mb={1}
                            >
                                <Typography
                                    noWrap
                                    sx={{
                                        flex: 1,
                                        maxWidth: 300,
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        whiteSpace: "nowrap",
                                    }}
                                >
                                    {getNameIcon(name).icon}
                                    {name}
                                </Typography>
                                <Box display="flex" alignItems="center">
                                    <Tooltip title="Copy">
                                        <IconButton
                                            onClick={() => handleCopyDID(did)}
                                            size="small"
                                        >
                                            <ContentCopy fontSize="small" />
                                        </IconButton>
                                    </Tooltip>
                                    <Tooltip title="Resolve">
                                        <IconButton
                                            onClick={() =>
                                                openBrowserWindow({ title: name, did })
                                            }
                                            size="small"
                                        >
                                            <ManageSearch fontSize="small" />
                                        </IconButton>
                                    </Tooltip>
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
