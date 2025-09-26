import { useState } from "react";
import {
    Box,
    Button,
    Divider,
    FormControl,
    IconButton,
    MenuItem,
    Select,
    TextField,
    Tooltip,
    Typography
} from "@mui/material";
import { useWalletContext } from "../contexts/WalletProvider";
import { useCredentialsContext } from "../contexts/CredentialsProvider";
import { useUIContext } from "../contexts/UIContext";
import {Delete, Edit} from "@mui/icons-material";
import WarningModal from "./WarningModal";
import { Group } from '@mdip/keymaster/types'
import TextInputModal from "./TextInputModal";
import CopyResolveDID from "./CopyResolveDID";

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
        setOpenBrowser
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
            setOpenBrowser({
                tab: "groups",
            });
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
            setOpenBrowser({
                tab: "groups",
            });
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
        <Box display="flex" flexDirection="column" sx={{ mt: 1 }}>
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

            <Box display="flex" flexDirection="column" sx={{ mb: 2, gap: 0 }}>
                <TextField
                    label="Group Name"
                    size="small"
                    sx={{
                        borderBottomLeftRadius: 0,
                        borderBottomRightRadius: 0,
                    }}
                    value={groupName}
                    onChange={(e) => setGroupName(e.target.value)}
                    slotProps={{
                        htmlInput: {
                            maxLength: 32,
                        },
                    }}
                />
                <Box display="flex" flexDirection="row" sx={{ gap: 0, width: "100%" }}>
                    <FormControl fullWidth>
                        <Select
                            value={registry}
                            size="small"
                            variant="outlined"
                            sx={{
                                borderTopLeftRadius: 0,
                                borderTopRightRadius: 0,
                                borderBottomRightRadius: 0,
                            }}
                            onChange={(event) => setRegistry(event.target.value)}
                        >
                            {registries.map((registry, index) => (
                                <MenuItem value={registry} key={index}>
                                    {registry}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>

                    <Button
                        variant="contained"
                        color="primary"
                        size="small"
                        fullWidth
                        sx={{
                            borderTopLeftRadius: 0,
                            borderTopRightRadius: 0,
                            borderBottomLeftRadius: 0,
                        }}
                        onClick={createGroup}
                        disabled={!groupName}
                    >
                        Create
                    </Button>
                </Box>
            </Box>
            {groupList &&
                <Box className="flex-box" sx={{ display: "flex", alignItems: "center", width: "100%", flexWrap: "nowrap" }}>
                    <FormControl sx={{ flex: 1, minWidth: 0 }}>
                        <Select
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
                    </FormControl>

                    <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexShrink: 0, whiteSpace: "nowrap" }}>
                        <Tooltip title="Rename">
                            <span>
                                <IconButton
                                    size="small"
                                    onClick={openRenameModal}
                                    disabled={!selectedGroupName}
                                >
                                    <Edit fontSize="small" />
                                </IconButton>
                            </span>
                        </Tooltip>

                        <CopyResolveDID did={nameList[selectedGroupName]} />
                    </Box>
                </Box>
            }
            {selectedGroup &&
                <Box display="flex" flexDirection="column" sx={{ width: "100%" }}>
                    <Box display="flex" flexDirection="row" sx={{ mb: 1, mt: 2, width: "100%" }}>
                        <TextField
                            label="DID"
                            size="small"
                            sx={{
                                '& .MuiOutlinedInput-notchedOutline': {
                                    borderTopRightRadius: 0,
                                    borderBottomRightRadius: 0,
                                },
                            }}
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
                            size="small"
                            onClick={() => {
                                setOpenBrowser({
                                    did: memberDID,
                                    tab: "viewer"
                                })
                            }}
                            disabled={!memberDID}
                            className="button-center"
                        >
                            Resolve
                        </Button>
                        <Button
                            variant="contained"
                            color="primary"
                            size="small"
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
    );
};

export default GroupsTab;
