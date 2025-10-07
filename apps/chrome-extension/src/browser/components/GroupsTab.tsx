import React, { useState } from "react";
import {Box, Button, Divider, IconButton, MenuItem, Select, TextField, Tooltip, Typography} from "@mui/material";
import { useWalletContext } from "../../shared/contexts/WalletProvider";
import { useCredentialsContext } from "../../shared/contexts/CredentialsProvider";
import { useUIContext } from "../../shared/contexts/UIContext";
import { useSnackbar } from "../../shared/contexts/SnackbarProvider";
import {Delete, Edit} from "@mui/icons-material";
import WarningModal from "../../shared/WarningModal";
import { Group } from '@mdip/keymaster/types'
import TextInputModal from "../../shared/TextInputModal";
import CopyResolveDID from "../../shared/CopyResolveDID";

const GroupsTab = () => {
    const {
        keymaster,
        registries,
    } = useWalletContext();
    const { setError, setSuccess } = useSnackbar();
    const {
        groupList,
        nameList,
    } = useCredentialsContext();
    const {
        refreshNames,
        setOpenBrowser,
        openBrowserWindow,
    } = useUIContext();

    const [registry, setRegistry] = useState<string>('hyperswarm');
    const [groupName, setGroupName] = useState<string>('');
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

        const name = groupName.trim();
        if (name in nameList) {
            setError(`${name} already in use`);
            return;
        }

        setGroupName('');

        try {
            const groupDID = await keymaster.createGroup(name, { registry });
            await keymaster.addName(name, groupDID);

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

        const name = newName.trim();
        if (name in nameList) {
            setError(`${name} already in use`);
            return;
        }

        try {
            await keymaster.addName(name, nameList[selectedGroupName]);
            await keymaster.removeName(selectedGroupName);
            await refreshNames();
            setSelectedGroupName(name);
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

                        <CopyResolveDID did={nameList[selectedGroupName]} />
                    </Box>
                }
                {selectedGroup &&
                    <Box display="flex" flexDirection="column">
                        <Box display="flex" flexDirection="row" sx={{ mb: 1, mt: 2 }}>
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
                                onClick={() => openBrowserWindow({ did: memberDID })}
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
                        {selectedGroup.members.map((did: string, index: number) => {
                            const alias = Object.keys(nameList).find((n) => nameList[n] === did) ?? undefined;

                            return (
                                <Box>
                                    <Box key={index} display="flex" alignItems="center" justifyContent="space-between" sx={{my: 1}}>
                                        <Typography sx={{ fontFamily: alias ? "text.primary" : "Courier, monospace" }}
                                        >
                                            {alias ?? did}
                                        </Typography>
                                        <Box display="flex" flexDirection="row">
                                            <CopyResolveDID did={did} />
                                            <Tooltip title="Delete">
                                                <IconButton
                                                    onClick={() => handleRemoveMember(did)}
                                                    size="small"
                                                >
                                                    <Delete />
                                                </IconButton>
                                            </Tooltip>
                                        </Box>
                                    </Box>
                                    <Divider />
                                </Box>
                            );
                        })}
                    </Box>
                }
            </Box>
        </Box>
    );
};

export default GroupsTab;
