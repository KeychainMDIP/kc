import React, { useState } from "react";
import {
    Box,
    Button,
    IconButton,
    Menu,
    MenuItem,
    Tooltip,
} from "@mui/material";
import { ArrowDropDown, ContentCopy, ManageSearch } from "@mui/icons-material";
import { useWalletContext } from "./contexts/WalletProvider";
import { useUIContext } from "./contexts/UIContext";
import { requestBrowserRefresh } from './sharedScripts'

const DropDownID = () => {
    const {
        currentDID,
        currentId,
        handleCopyDID,
        idList,
        isBrowser,
        keymaster,
        openJSONViewer,
        setError,
        setSelectedId,
    } = useWalletContext();
    const {
        resetCurrentID,
    } = useUIContext();

    const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);

    const truncatedId =
        currentId?.length > 10 ? currentId.slice(0, 10) + "..." : currentId;

    async function selectId(id: string) {
        try {
            setSelectedId(id);
            await keymaster.setCurrentId(id);

            await resetCurrentID();
            requestBrowserRefresh(isBrowser);
        } catch (error) {
            setError(error.error || error.message || String(error));
        }
    }

    const handleOpenMenu = (event: React.MouseEvent<HTMLElement>) => {
        setAnchorEl(event.currentTarget);
    };

    const handleCloseMenu = () => {
        setAnchorEl(null);
    };

    async function handleSelectID(id: string) {
        handleCloseMenu();
        await selectId(id);
    }

    const multipleIds = idList && idList.length > 1;

    return (
        currentId && (
            <Box display="flex" alignItems="center" gap={0}>
                {currentDID && (
                    <>
                        <Tooltip title="Copy DID">
                            <IconButton
                                onClick={() => handleCopyDID(currentDID)}
                                size="small"
                                sx={{
                                    px: 0.5,
                                }}
                            >
                                <ContentCopy fontSize="small" />
                            </IconButton>
                        </Tooltip>
                        <Tooltip title="Resolve DID">
                            <IconButton
                                onClick={() =>
                                    openJSONViewer({ title: currentId, did: currentDID })
                                }
                                size="small"
                                sx={{
                                    px: 0.5,
                                }}
                            >
                                <ManageSearch fontSize="small" />
                            </IconButton>
                        </Tooltip>
                    </>
                )}

                {multipleIds ? (
                    <>
                        <Button
                            className="drop-down-id-button"
                            onClick={handleOpenMenu}
                            endIcon={<ArrowDropDown />}
                            sx={{
                                textTransform: "none",
                            }}
                            size="small"
                            variant="outlined"
                        >
                            {truncatedId}
                        </Button>

                        <Menu
                            anchorEl={anchorEl}
                            open={Boolean(anchorEl)}
                            onClose={handleCloseMenu}
                            anchorOrigin={{
                                vertical: "bottom",
                                horizontal: "right",
                            }}
                            transformOrigin={{
                                vertical: "top",
                                horizontal: "right",
                            }}
                        >
                            {idList.map((id) => (
                                <MenuItem
                                    key={id}
                                    onClick={() => handleSelectID(id)}
                                >
                                    {id}
                                </MenuItem>
                            ))}
                        </Menu>
                    </>
                ) : (
                    <Box className="drop-down-id-box">{truncatedId}</Box>
                )}
            </Box>
        )
    );
};

export default DropDownID;
