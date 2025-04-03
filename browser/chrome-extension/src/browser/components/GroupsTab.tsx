import React, { useState } from "react";
import { Box, Button, IconButton, MenuItem, Select, TextField, Tooltip, Typography } from "@mui/material";
import { useWalletContext } from "../../shared/contexts/WalletProvider";
import { useCredentialsContext } from "../../shared/contexts/CredentialsProvider";
import { useUIContext } from "../../shared/contexts/UIContext";
import { ContentCopy } from "@mui/icons-material";
import WarningModal from "../../shared/WarningModal";
import JsonViewer from "./JsonViewer";
import DisplayDID from "../../shared/DisplayDID";
import { Group } from '@mdip/keymaster/types'

const GroupsTab = () => {
    const {
        keymaster,
        registries,
        setError,
    } = useWalletContext();
    const {
        groupList,
        nameList,
    } = useCredentialsContext();
    const {
        refreshNames,
        handleCopyDID,
        setOpenBrowser,
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
            setError(error.error || error.message || String(error));
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
            setError(error.error || error.message || String(error));
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
            setError(error.error || error.message || String(error));
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
            setError(error.error || error.message || String(error));
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
            setError(error.error || error.message || String(error));
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

    return (
        <Box>
            <Box display="flex" flexDirection="column">
                <WarningModal
                    title="Overwrite wallet"
                    warningText={`Remove member from ${selectedGroupName}?`}
                    isOpen={open}
                    onClose={handleClose}
                    onSubmit={removeMember}
                />

                <Box className="flex-box mt-2">
                    <TextField
                        label="Group Name"
                        style={{ width: '300px' }}
                        className="text-field single-line"
                        size="small"
                        value={groupName}
                        onChange={(e) => setGroupName(e.target.value)}
                        slotProps={{
                            htmlInput: {
                                maxLength: 80,
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
                            className="select-small-left"
                            onChange={(event) => {
                                const selectedName = event.target.value;
                                setSelectedGroupName(selectedName);
                                populateCopyButton(selectedName);
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
                        <Button
                            variant="contained"
                            color="primary"
                            onClick={() => refreshGroup(selectedGroupName)}
                            disabled={!selectedGroupName}
                            className="button-right"
                        >
                            Edit Group
                        </Button>
                        {groupDID &&
                            <Tooltip title="Copy Group DID">
                                <IconButton
                                    onClick={() => handleCopyDID(groupDID)}
                                    size="small"
                                    sx={{
                                        px: 0.5,
                                        ml: 1,
                                    }}
                                >
                                    <ContentCopy fontSize="small" />
                                </IconButton>
                            </Tooltip>
                        }
                    </Box>
                }
                {selectedGroup &&
                    <Box display="flex" flexDirection="column">
                        <Typography variant="h5" component="h5" sx={{ my: 2 }}>
                            {`Editing ${selectedGroup.name}`}
                        </Typography>
                        <Box display="flex" flexDirection="row" sx={{ mb: 2 }}>
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
