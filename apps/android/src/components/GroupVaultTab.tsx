import {ChangeEvent, useEffect, useRef, useState} from "react";
import {
    Autocomplete,
    Box,
    Button, FormControl,
    IconButton,
    MenuItem,
    Select,
    TextField,
    Tooltip,
    Typography
} from "@mui/material";
import {
    Edit,
    Close,
} from "@mui/icons-material";
import { useWalletContext } from "../contexts/WalletProvider";
import { useCredentialsContext } from "../contexts/CredentialsProvider";
import { useUIContext } from "../contexts/UIContext";
import LoginDialog from "./LoginDialog";
import WarningModal from "./WarningModal";
import TextInputModal from "./TextInputModal";
import DmailDialog from "./DmailDialog";
import { DmailMessage } from '@mdip/keymaster/types';
import CopyResolveDID from "./CopyResolveDID";

function GroupVaultTab() {
    const [registry, setRegistry] = useState<string>('hyperswarm');
    const [selectedVaultOwned, setSelectedVaultOwned] = useState<boolean>(false);
    const [selectedVaultName, setSelectedVaultName] = useState<string>('');
    const [vaultName, setVaultName] = useState<string>('');
    const [vaultMember, setVaultMember] = useState<string>('');
    const [revealLoginOpen, setRevealLoginOpen] = useState<boolean>(false);
    const [revealLogin, setRevealLogin] = useState<{
        service: string;
        username: string;
        password: string;
    } | null>(null);
    const [revealDmailOpen, setRevealDmailOpen] = useState<boolean>(false);
    const [revealDmail, setRevealDmail] = useState<DmailMessage | null>(null);
    const [editLoginOpen, setEditLoginOpen] = useState<boolean>(false);
    const [selectedVault, setSelectedVault] = useState<{
        members: string[],
        vaultMembers: Record<string, any>,
        items: string[],
        vaultItems: Record<string, any>
    } | null>(null);
    const [warningOpen,  setWarningOpen]  = useState(false);
    const [warningTitle, setWarningTitle] = useState("");
    const [warningText,  setWarningText]  = useState("");
    const [renameOpen, setRenameOpen] = useState<boolean>(false);
    const [renameOldName, setRenameOldName] = useState<string>("");
    const warningCbRef = useRef<() => Promise<void> | void>(() => {});
    const {
        currentDID,
        keymaster,
        registries,
        setError,
        setSuccess,
    } = useWalletContext();
    const {
        agentList,
        nameList,
        vaultList,
    } = useCredentialsContext();
    const {
        getVaultItemIcon,
        refreshNames,
    } = useUIContext();

    function removeVaultMember(did: string): void {
        showWarning(
            "Remove Vault Member",
            `Remove member from ${selectedVaultName}?`,
            async () => {
                if (!keymaster) {
                    return;
                }
                try {
                    await keymaster.removeGroupVaultMember(selectedVaultName, did);
                    await refreshVault(selectedVaultName);
                } catch (err: any) {
                    setError(err);
                }
            }
        );
    }

    function removeVaultItem(name: string): void {
        showWarning(
            "Remove Vault Item",
            `Remove item ${name} from ${selectedVaultName}?`,
            async () => {
                if (!keymaster) {
                    return;
                }
                try {
                    await keymaster.removeGroupVaultItem(selectedVaultName, name);
                    await refreshVault(selectedVaultName);
                } catch (err: any) {
                    setError(err);
                }
            }
        );
    }

    async function refreshVault(vaultName: string) {
        if (!keymaster) {
            return;
        }
        try {
            const docs = await keymaster.resolveDID(vaultName);

            setSelectedVaultName(vaultName);
            setSelectedVaultOwned(docs.didDocument?.controller === currentDID);
            setVaultMember('');

            const vaultMembers = await keymaster.listGroupVaultMembers(vaultName);
            const vaultItems = await keymaster.listGroupVaultItems(vaultName);

            const members = Object.keys(vaultMembers);
            const items = Object.keys(vaultItems);

            setSelectedVault({ members, vaultMembers, items, vaultItems });
        } catch (error: any) {
            setSelectedVaultName('');
            setSelectedVaultOwned(false);
            setSelectedVault(null)
            setError(error);
        }
    }

    useEffect(() => {
        const check = async () => {
            if (!keymaster || !selectedVaultName) {
                return;
            }

            try {
                const docs = await keymaster.resolveDID(selectedVaultName);
                setSelectedVaultOwned(docs.didDocument?.controller === currentDID);
            } catch {
                setSelectedVaultOwned(false);
            }
        }

        check();

    }, [keymaster, currentDID, selectedVaultName])

    function isVaultItemFile(item: any) {
        return item.type !== 'application/json';
    }

    async function downloadVaultItem(name: string) {
        if (!keymaster) {
            return;
        }
        try {
            const buffer = await keymaster.getGroupVaultItem(selectedVaultName, name);

            if (!buffer) {
                setError(`Item ${name} not found in vault ${selectedVaultName}`);
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

    async function addVaultMember(did: string) {
        if (!keymaster) {
            return;
        }
        try {
            const result = await keymaster.addGroupVaultMember(selectedVaultName, did);
            if (result) {
                await refreshVault(selectedVaultName);
            } else {
                setError(`Cannot add vault owner as a member. The owner is a member by default.`);
            }
        } catch (error: any) {
            setError(error);
        }
    }

    async function revealVaultItem(name: string) {
        if (!keymaster) {
            return;
        }
        try {
            const buffer = await keymaster.getGroupVaultItem(selectedVaultName, name);

            if (!buffer) {
                setError(`Item ${name} not found in vault ${selectedVaultName}`);
                return;
            }

            const item = JSON.parse(buffer.toString('utf-8'));

            if (item.login) {
                const parsedFromName = name.replace(/^login:\s*/i, '');
                const service  = item.login.service || parsedFromName;
                const username = item.login.username ?? '';
                const password = item.login.password ?? '';
                setRevealLogin({ service, username, password });
                setRevealLoginOpen(true);
                return;
            }

            if (item.dmail) {
                setRevealDmail(item.dmail);
                setRevealDmailOpen(true);
                return;
            }

            setError(`Unknown item type ${name}`);
        } catch (error: any) {
            setError(error);
        }
    }

    async function createVault() {
        if (!keymaster) {
            return;
        }

        const name = vaultName.trim();
        if (name in nameList) {
            setError(`${name} already in use`);
            return;
        }

        setVaultName('');
        try {
            await keymaster.createGroupVault({ registry, name });

            await refreshNames();
            setSelectedVaultName(name);
            await refreshVault(name);
        } catch (error: any) {
            setError(error);
        }
    }

    async function addLoginVaultItem(service: string, username: string, password: string) {
        if (!keymaster) {
            return;
        }
        try {
            if (
                !service || !service.trim() ||
                !username || !username.trim() ||
                !password || !password.trim()
            ) {
                setError("Service, username, and password are required");
                return;
            }

            service = service.trim();
            username = username.trim();

            const name = `login: ${service}`;
            const login = {
                service,
                username,
                password
            };
            const buffer = Buffer.from(JSON.stringify({ login }), 'utf-8');
            const ok = await keymaster.addGroupVaultItem(selectedVaultName, name, buffer);

            setEditLoginOpen(false);

            if (ok) {
                setSuccess(`Login added successfully: ${service}`);
                await refreshVault(selectedVaultName);
            } else {
                setError(`Error adding login: ${service}`);
            }
        } catch (error: any) {
            setError(error);
        }
    }

    async function uploadVaultItem(event: ChangeEvent<HTMLInputElement>) {
        if (!keymaster) {
            return;
        }
        try {
            const fileInput = event.target;
            if (!fileInput.files || fileInput.files.length === 0) {
                return;
            }

            const file = fileInput.files[0];

            if (!file) {
                return;
            }

            fileInput.value = "";

            const reader = new FileReader();

            reader.onload = async (e) => {
                if (!e.target || !e.target.result) {
                    setError("Unexpected file reader result");
                    return;
                }
                try {
                    const arrayBuffer = e.target.result;
                    let buffer: Buffer;
                    if (arrayBuffer instanceof ArrayBuffer) {
                        buffer = Buffer.from(arrayBuffer);
                    } else {
                        setError("Unexpected file reader result type");
                        return;
                    }

                    const ok = await keymaster.addGroupVaultItem(selectedVaultName, file.name, buffer);

                    if (ok) {
                        setSuccess(`Item uploaded successfully: ${file.name}`);
                        await refreshVault(selectedVaultName);
                    } else {
                        setError(`Error uploading file: ${file.name}`);
                    }
                } catch (error: any) {
                    setError(`Error uploading file: ${error}`);
                }
            };

            reader.onerror = (error) => {
                setError(`Error uploading file: ${error}`);
            };

            reader.readAsArrayBuffer(file);
        } catch (error: any) {
            setError(`Error uploading file: ${error}`);
        }
    }

    function showWarning(
        title: string,
        text: string,
        onConfirm: () => Promise<void> | void
    ) {
        setWarningTitle(title);
        setWarningText(text);
        warningCbRef.current = onConfirm;
        setWarningOpen(true);
    }

    const MemberRow = ({ did }: { did: string }) => (
        <Box
            key={did}
            display="flex"
            alignItems="center"
            sx={{ mb: 1, width: "100%", overflow: "hidden" }}
        >
            {selectedVaultOwned &&
                <Tooltip title="Remove member">
                    <span>
                        <IconButton
                            size="small"
                            color="error"
                            onClick={() => removeVaultMember(did)}
                            sx={{ mr: 1 }}
                        >
                            <Close fontSize="small" />
                        </IconButton>
                    </span>
                </Tooltip>
            }

            <CopyResolveDID did={did} />

            <Typography
                variant="body2"
                sx={{
                    fontFamily: "Courier",
                    ml: 1,
                    flex: 1,
                    minWidth: 0,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                }}
            >
                {did}
            </Typography>
        </Box>
    );

    const ItemRow = ({ name, item }: { name: string; item: any }) => (
        <Box
            key={name}
            className="flex-box"
            display="flex"
            flexDirection="row"
            alignItems="center"
            sx={{ mb: 1 }}
        >
            <Box display="flex" alignItems="center" sx={{ flexGrow: 1 }}>
                {getVaultItemIcon(name, item)}
                <Typography variant="body2" sx={{ ml: 0.5 }}>
                    {name.startsWith('login:') ? name.substring('login:'.length) : name}
                </Typography>
            </Box>
            <Typography variant="body2" sx={{ width: 120, textAlign: "right", mr: 1 }}>
                {item.bytes} bytes
            </Typography>
            {isVaultItemFile(item) ? (
                <Button
                    variant="contained"
                    size="small"
                    color="primary"
                    onClick={() => downloadVaultItem(name)}
                    sx={{ mr: 1 }}
                >
                    Download
                </Button>
            ) : (
                <Button
                    variant="contained"
                    size="small"
                    color="primary"
                    onClick={() => revealVaultItem(name)}
                    sx={{ mr: 1 }}
                >
                    Reveal
                </Button>
            )}
            {selectedVaultOwned &&
                <Button
                    variant="contained"
                    size="small"
                    color="primary"
                    onClick={() => removeVaultItem(name)}
                >
                    Remove
                </Button>
            }
        </Box>
    );

    const openRenameModal = () => {
        setRenameOldName(selectedVaultName);
        setRenameOpen(true);
    };

    const handleRenameSubmit = async (newName: string) => {
        setRenameOpen(false);
        if (!newName || newName === selectedVaultName || !keymaster) {
            return;
        }

        const name = newName.trim();
        if (name in nameList) {
            setError(`${name} already in use`);
            return;
        }

        try {
            await keymaster.addName(name, nameList[selectedVaultName]);
            await keymaster.removeName(selectedVaultName);
            await refreshNames();
            setSelectedVaultName(name);
            setRenameOldName("");
            setSuccess("Vault renamed");
        } catch (error: any) {
            setError(error);
        }
    };

    return (
        <Box display="flex" flexDirection="column" sx={{ mt: 1 }}>
            <DmailDialog
                open={revealDmailOpen}
                onClose={() => setRevealDmailOpen(false)}
                dmail={revealDmail}
            />

            <WarningModal
                isOpen={warningOpen}
                title={warningTitle}
                warningText={warningText}
                onSubmit={async () => {
                    setWarningOpen(false);
                    await warningCbRef.current();
                }}
                onClose={() => setWarningOpen(false)}
            />

            <TextInputModal
                isOpen={renameOpen}
                title="Rename Vault"
                description={`Rename '${renameOldName}' to:`}
                label="New Name"
                confirmText="Rename"
                defaultValue={renameOldName}
                onSubmit={handleRenameSubmit}
                onClose={() => setRenameOpen(false)}
            />

            <LoginDialog
                open={editLoginOpen}
                onClose={() => setEditLoginOpen(false)}
                onOK={addLoginVaultItem}
            />

            <LoginDialog
                open={revealLoginOpen}
                onClose={() => setRevealLoginOpen(false)}
                login={revealLogin}
                readOnly
            />

            <Box display="flex" flexDirection="column" sx={{ mb: 2, gap: 0 }}>
                <TextField
                    label="Vault Name"
                    size="small"
                    sx={{
                        borderBottomLeftRadius: 0,
                        borderBottomRightRadius: 0,
                    }}
                    value={vaultName}
                    onChange={(e) => setVaultName(e.target.value)}
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
                            {registries.map((registry: string, index: number) => (
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
                        onClick={createVault}
                        disabled={!vaultName || !registry}
                    >
                        Create
                    </Button>
                </Box>
            </Box>

            {vaultList && (
                <Box className="flex-box" sx={{ display: "flex", alignItems: "center", width: "100%", flexWrap: "nowrap" }}>
                    <FormControl sx={{ flex: 1, minWidth: 0 }}>
                        <Select
                            value={selectedVaultName}
                            displayEmpty
                            size="small"
                            variant="outlined"
                            onChange={async (event) => {
                                const selectedName = event.target.value;
                                await refreshVault(selectedName);
                            }}
                        >
                            <MenuItem value="" disabled>
                                Select vault
                            </MenuItem>
                            {vaultList.map((name) => (
                                <MenuItem value={name} key={name}>
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
                                    disabled={!selectedVaultName}
                                >
                                    <Edit fontSize="small" />
                                </IconButton>
                            </span>
                        </Tooltip>

                        <CopyResolveDID did={nameList[selectedVaultName]} />
                    </Box>
                </Box>
            )}

            {selectedVault && (
                <Box display="flex" flexDirection="column">
                    <Typography variant="h5" component="h5" sx={{ my: 2 }}>
                        {`Members`}
                    </Typography>

                    {selectedVaultOwned &&
                        <Box sx={{ display: "flex", gap: 0, width: "100%", mb: 2 }}>
                            <Autocomplete
                                freeSolo
                                options={agentList || []}
                                value={vaultMember}
                                onChange={(_e, newVal) => setVaultMember(newVal || "")}
                                onInputChange={(_e, newInput) => setVaultMember(newInput)}
                                sx={{
                                    '& .MuiOutlinedInput-notchedOutline': {
                                        borderTopRightRadius: 0,
                                        borderBottomRightRadius: 0,
                                    },
                                    flex: 1,
                                    minWidth: 0
                                }}
                                renderInput={(params) => (
                                    <TextField
                                        {...params}
                                        fullWidth
                                        label="Name or DID"
                                        size="small"
                                        slotProps={{
                                            htmlInput: {
                                                ...params.inputProps,
                                                maxLength: 80,
                                            },
                                        }}
                                    />
                                )}
                            />

                            <Button
                                variant="contained"
                                color="primary"
                                size="small"
                                onClick={() => addVaultMember(vaultMember)}
                                disabled={!vaultMember}
                                sx={{
                                    borderTopLeftRadius: 0,
                                    borderBottomLeftRadius: 0
                                }}
                            >
                                Add
                            </Button>
                        </Box>
                    }

                    {selectedVault.members.map((did: string) => (
                        <MemberRow did={did} key={did} />
                    ))}

                    <Typography variant="h5" component="h5" sx={{ my: 2 }}>
                        Items
                    </Typography>

                    {selectedVaultOwned &&
                        <Box className="flex-box mt-1" sx={{ mb: 2 }}>
                            <Button
                                variant="contained"
                                color="primary"
                                size="small"
                                onClick={() => document.getElementById("vaultItemUpload")?.click()}
                                className="button-left"
                            >
                                Upload
                            </Button>
                            <input
                                type="file"
                                id="vaultItemUpload"
                                style={{ display: "none" }}
                                onChange={uploadVaultItem}
                            />
                            <Button
                                variant="contained"
                                color="primary"
                                size="small"
                                onClick={() => setEditLoginOpen(true)}
                                className="button-right"
                            >
                                Add login
                            </Button>
                        </Box>
                    }

                    {Object.entries(selectedVault.vaultItems).map(([name, item]) => (
                        <ItemRow name={name} item={item} key={name} />
                    ))}
                </Box>
            )}
        </Box>
    );
}

export default GroupVaultTab;
