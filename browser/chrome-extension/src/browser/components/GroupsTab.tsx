import React, { useState } from "react";
import { Box, Button, IconButton, MenuItem, Select, TextField, Tooltip } from "@mui/material";
import { useWalletContext } from "../../shared/contexts/WalletProvider";
import { useCredentialsContext } from "../../shared/contexts/CredentialsProvider";
import { useUIContext } from "../../shared/contexts/UIContext";
import {ContentCopy, Edit, ManageSearch} from "@mui/icons-material";
import WarningModal from "../../shared/WarningModal";
import JsonViewer from "./JsonViewer";
import DisplayDID from "../../shared/DisplayDID";
import { Group } from '@mdip/keymaster/types'
import TextInputModal from "../../shared/TextInputModal";

const GroupsTab = () => {
    const {
        keymaster,
        registries,
        setError,
        setSuccess,
    } = useWalletContext();
    const {
        groupList,
        nameList,
    } = useCredentialsContext();
    const {
        refreshNames,
        handleCopyDID,
        setOpenBrowser,
        openBrowserWindow,
    } = useUIContext();

    const [registry, setRegistry] = useState<string>('hyperswarm');
    const [groupName, setGroupName] = useState<string>('');
    const [groupDID, setGroupDID] = useState<string>('');
    const [selectedGroupName, setSelectedGroupName] = useState<string>('');
    const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
    const [memberDID, setMemberDID] = useState<string>('');
    const [jsonDID, setJsonDID] = useState<string>('');
    const [removeDID, setRemoveDID] = useState<string>('');
    const [open, setOpen] = useState<boolean>(false);
    const [renameOpen, setRenameOpen] = useState<boolean>(false);
    const [renameOldName, setRenameOldName] = useState<string>("");

    const storageKey = "jsonViewerState-groups-noSubTab";
    sessionStorage.removeItem(storageKey);

    async function createGroup() {
        if (!keymaster) {
            return;
        }
        try {
            if (Object.keys(nameList).includes(groupName)) {
                setError(`${groupName} already in use`);
                return;
            }

            const name = groupName;
            setGroupName('');

            const groupDID = await keymaster.createGroup(name, { registry });
            await keymaster.addName(groupName, groupDID);

            await refreshNames();
            setSelectedGroupName(name);
            await refreshGroup(name);
        } catch (error: any) {
            setError(error);
        }
    }

    async function refreshGroup(groupName: string) {
        if (!keymaster) {
            return;
        }
        try {
            const group = await keymaster.getGroup(groupName);
            setSelectedGroup(group);
            setMemberDID('');
            if (setOpenBrowser) {
                setOpenBrowser({
                    title: "",
                    did: "",
                    tab: "groups",
                });
            }
        } catch (error: any) {
            setError(error);
        }
    }

    function populateCopyButton(name: string) {
        setGroupDID(nameList[name]);
    }

    async function resolveMember(did: string) {
        try {
            setJsonDID(did);
            if (setOpenBrowser) {
                setOpenBrowser({
                    title: "",
                    did,
                    tab: "groups",
                });
            }
        } catch (error: any) {
            setError(error);
        }
    }

    async function addMember(did: string) {
        if (!keymaster) {
            return;
        }
        try {
            await keymaster.addGroupMember(selectedGroupName, did);
            await refreshGroup(selectedGroupName);
        } catch (error: any) {
            setError(error);
        }
    }

    async function removeMember() {
        if (!keymaster) {
            return;
        }
        try {
            await keymaster.removeGroupMember(selectedGroupName, removeDID);
            await refreshGroup(selectedGroupName);
        } catch (error: any) {
            setError(error);
        }
        if (removeDID === jsonDID) {
            setJsonDID('');
            if (setOpenBrowser) {
                setOpenBrowser({
                    title: "",
                    did: "",
                    tab: "groups",
                });
            }
        }
        setOpen(false);
        setRemoveDID("");
    }

    async function handleRemoveMember(did: string) {
        setRemoveDID(did);
        setOpen(true);
    }

    const handleClose = () => {
        setOpen(false);
        setRemoveDID("");
    };

    const openRenameModal = () => {
        setRenameOldName(selectedGroupName);
        setRenameOpen(true);
    };

    const handleRenameSubmit = async (newName: string) => {
        setRenameOpen(false);
        if (!newName || newName === selectedGroupName || !keymaster) {
            return;
        }
        try {
            await keymaster.addName(newName, groupDID);
            await keymaster.removeName(selectedGroupName);
            await refreshNames();
            setSelectedGroupName(newName);
            setRenameOldName("");
            setSuccess("Group renamed");
        } catch (error: any) {
            setError(error);
        }
    };

    return (
        <Box>
            <TextInputModal
                isOpen={renameOpen}
                title="Rename Group"
                description={`Rename '${renameOldName}' to:`}
                label="New Name"
                confirmText="Rename"
                defaultValue={renameOldName}
                onSubmit={handleRenameSubmit}
                onClose={() => setRenameOpen(false)}
            />

            <WarningModal
                title="Overwrite wallet"
                warningText={`Remove member from ${selectedGroupName}?`}
                isOpen={open}
                onClose={handleClose}
                onSubmit={removeMember}
            />

            <Box display="flex" flexDirection="column">
                <Box className="flex-box mt-2">
                    <TextField
                        label="Group Name"
                        style={{ flex: "0 0 400px" }}
                        className="text-field single-line"
                        size="small"
                        value={groupName}
                        onChange={(e) => setGroupName(e.target.value)}
                        slotProps={{
                            htmlInput: {
                                maxLength: 32,
                            },
                        }}
                    />
                    <Select
                        value={registry}
                        size="small"
                        variant="outlined"
                        className="select-small"
                        onChange={(event) => setRegistry(event.target.value)}
                    >
                        {registries.map((registry, index) => (
                            <MenuItem value={registry} key={index}>
                                {registry}
                            </MenuItem>
                        ))}
                    </Select>
                    <Button
                        variant="contained"
                        color="primary"
                        size="small"
                        className="button-right"
                        onClick={createGroup}
                        disabled={!groupName}
                    >
                        Create Group
                    </Button>
                </Box>
                {groupList &&
                    <Box className="flex-box mt-2">
                        <Select
                            sx={{ width: '300px' }}
                            value={selectedGroupName}
                            displayEmpty
                            variant="outlined"
                            size="small"
                            onChange={async (event) => {
                                const name = event.target.value;
                                setSelectedGroupName(name);
                                populateCopyButton(name);
                                await refreshGroup(name);
                            }}
                        >
                            <MenuItem value="" disabled>
                                Select group
                            </MenuItem>
                            {groupList.map((name, index) => (
                                <MenuItem value={name} key={index}>
                                    {name}
                                </MenuItem>
                            ))}
                        </Select>

                        <Tooltip title="Rename Group">
                            <span>
                                <IconButton
                                    size="small"
                                    onClick={openRenameModal}
                                    disabled={!selectedGroupName}
                                    sx={{ ml: 1 }}
                                >
                                    <Edit fontSize="small" />
                                </IconButton>
                            </span>
                        </Tooltip>

                        <Tooltip title="Copy DID">
                            <span>
                                <IconButton
                                    onClick={() => handleCopyDID(groupDID)}
                                    size="small"
                                    sx={{ ml: 1 }}
                                    disabled={!selectedGroupName}
                                >
                                    <ContentCopy fontSize="small" />
                                </IconButton>
                            </span>
                        </Tooltip>

                        <Tooltip title="Resolve DID">
                            <span>
                                <IconButton
                                    size="small"
                                    onClick={() =>
                                        openBrowserWindow({ did: groupDID })
                                    }
                                    disabled={!selectedGroupName}
                                    sx={{ ml: 1 }}
                                >
                                    <ManageSearch fontSize="small" />
                                </IconButton>
                            </span>
                        </Tooltip>
                    </Box>
                }
                {selectedGroup &&
                    <Box display="flex" flexDirection="column">
                        <Box display="flex" flexDirection="row" sx={{ mb: 2, mt: 2 }}>
                            <TextField
                                label="DID"
                                sx={{ width: '300px' }}
                                className="text-field single-line"
                                size="small"
                                value={memberDID}
                                onChange={(e) => setMemberDID(e.target.value)}
                                slotProps={{
                                    htmlInput: {
                                        maxLength: 80,
                                    },
                                }}
                            />
                            <Button
                                variant="contained"
                                color="primary"
                                onClick={() => resolveMember(memberDID)}
                                disabled={!memberDID}
                                className="button-center"
                            >
                                Resolve
                            </Button>
                            <Button
                                variant="contained"
                                color="primary"
                                onClick={() => addMember(memberDID)}
                                disabled={!memberDID}
                                className="button-right"
                            >
                                Add
                            </Button>
                        </Box>
                        {selectedGroup.members.map((did: string, index: number) => (
                            <Box key={index} display="flex" flexDirection="row" alignItems="center" sx={{ mb: 2 }}>
                                <DisplayDID did={did} />
                                <Box display="flex" flexDirection="row" sx={{ gap: 0 }}>
                                    <Button
                                        variant="contained"
                                        color="primary"
                                        onClick={() => resolveMember(did)}
                                        className="button-left"
                                    >
                                        Resolve
                                    </Button>
                                    <Button
                                        variant="contained"
                                        color="primary"
                                        onClick={() => handleRemoveMember(did)}
                                        className="button-right"
                                    >
                                        Remove
                                    </Button>
                                </Box>
                            </Box>
                        ))}
                        <JsonViewer browserTab="groups" />
                    </Box>
                }
            </Box>
        </Box>
    );
};

export default GroupsTab;
